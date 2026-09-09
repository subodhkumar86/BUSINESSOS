import { queueMessage, signDelivery } from './notify.ts'
import { pdfReport } from './pdf.ts'
import { chainInput, chainUpdate, approvalDecision, seedDefaultChains, matchingChain } from './approvals.ts'
import { handleReturns } from './returns.ts'
import { handleShipments } from './shipments.ts'
import { financeWorkbook } from './finance-workbook.ts'
import { handleWorkflow } from './workflows.ts'
import { candidateInput, candidateUpdate, canAdvanceCandidate } from './recruitment.ts'
import { customerInput, customerUpdate, interactionInput } from './customers.ts'
import { reportingPeriod, periodState } from '../src/reporting.ts'
import {validateProductionUpdate, depreciation} from './operational-rules.ts'
import {requiredFeature, actionFeature} from './entitlements.ts'
import { webhookBinding, verifyBankSignature, normalizeBankEvent } from './bank-webhooks.ts'
import { suggestReconciliation } from './reconciliation.ts'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { createClient } from 'redis'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { Store } from './store.ts'
import {
  metrics,
  seed,
  transition,
  generateIncomeStatement,
  generateBalanceSheet,
  generateCashFlowStatement,
  generatePayslips,
} from '../src/domain.ts'
import { hydrateInventory } from '../src/inventory.ts'
import {
  userRoles,
  type User,
  type UserRole,
  type State,
  type Action,
  type Snapshot,
} from '../src/types.ts'
import {
  passwordSchema,
  passwordChangeSchema,
  storedSessionSchema,
  sessionIsCurrent,
  accessChangeAllowed,
  actionAllowed,
  type Session,
  type AccountRow,
} from './security.ts'
import {
  canReadModule,
  canWriteModule,
  moduleNames,
  seedModuleRecords,
} from './modules.ts'
const derive = promisify(scrypt),
  digest = (s: string) => createHash('sha256').update(s).digest('hex')
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message)
}
const text = z.string().trim().min(1).max(200),
  email = z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  password = passwordSchema
const register = z
  .object({
    name: text,
    organisation: text,
    email,
    password,
    sample: z.boolean().default(false),
  })
  .strict()
const login = z.object({ email, password: z.string().min(1).max(128) }).strict()
const insightQuestion = z
  .object({ question: z.string().trim().min(3).max(500) })
  .strict()
const forecastRequest = z
  .object({ metric: z.enum(['cash', 'pipeline', 'inventory']) })
  .strict()
const resetRequest = z.object({ email }).strict()
const resetConfirm = z
  .object({ token: z.string().trim().min(32).max(128), newPassword: password })
  .strict()
async function hash(value: string) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${((await derive(value, salt, 64)) as Buffer).toString('hex')}`
}
async function matches(value: string, stored: string) {
  const [salt, h] = stored.split(':')
  return timingSafeEqual(
    (await derive(value, salt, 64)) as Buffer,
    Buffer.from(h, 'hex'),
  )
}
async function rawBody(req: IncomingMessage, maxBytes = 32768): Promise<Buffer> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    fail(415, 'Send JSON data.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) fail(413, 'Request too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function body(req: IncomingMessage, maxBytes = 32768): Promise<unknown> {
  const raw = await rawBody(req, maxBytes)
  try {
    return JSON.parse(raw.toString())
  } catch {
    return fail(400, 'Invalid JSON.')
  }
}
export async function createApp(config: {
  databaseUrl: string
  redisUrl: string
  origins: string[]
  secure?: boolean
  sameSite?: 'Strict' | 'None'
  prefix?: string
  staticDir?: string
}) {
  const store = new Store(config.databaseUrl),
    redis = createClient({
      url: config.redisUrl,
      socket: { connectTimeout: 5000, reconnectStrategy: false },
    }),
    prefix = config.prefix || 'bos:'
  const cookieSameSite = config.sameSite || 'Strict'
  redis.on('error', () =>
    console.error(JSON.stringify({ event: 'redis_error' })),
  )
  try {
    await redis.connect()
    await store.checkRuntime()
  } catch (e) {
    if (redis.isOpen) await redis.quit()
    await store.close()
    throw e
  }
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy':
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Content-Security-Policy':
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      ...(config.secure
        ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
        : {}),
    })
    res.end(JSON.stringify(value))
  }
  const sendCsv = (res: ServerResponse, filename: string, content: string) => {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      ...(config.secure
        ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
        : {}),
    })
    res.end(content)
  }
  const staticRoot = config.staticDir ? resolve(config.staticDir) : undefined
  const sendStatic = async (res: ServerResponse, pathname: string) => {
    if (!staticRoot || pathname.startsWith('/api/')) return false
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    const candidate = resolve(staticRoot, relative)
    if (candidate !== staticRoot && !candidate.startsWith(staticRoot + sep))
      return false
    const fallback = resolve(staticRoot, 'index.html')
    try {
      const file = await readFile(candidate)
      const types: Record<string, string> = {
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.json': 'application/json; charset=utf-8',
      }
      res.writeHead(200, {
        'Content-Type': types[extname(candidate)] || 'application/octet-stream',
        'Cache-Control':
          candidate === fallback
            ? 'no-cache'
            : 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(file)
      return true
    } catch (error: unknown) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
        extname(candidate)
      )
        return false
      try {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        })
        res.end(await readFile(fallback))
        return true
      } catch {
        return false
      }
    }
  }
  const publicUser = (r: User): User => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
  })
  const scopedState = (state: State, role: UserRole): State => {
    if (role === 'owner' || role === 'auditor') return state
    const empty: State = {
      ...state,
      openingCash: 0,
      products: [],
      invoices: [],
      expenses: [],
      leads: [],
      employees: [],
      projects: [],
      tasks: [],
      orders: [],
      payroll: [],
      audit: [],
      journals: [],
      stockMovements: [],
    }
    if (role === 'finance_admin')
      return {
        ...empty,
        openingCash: state.openingCash,
        invoices: state.invoices,
        expenses: state.expenses,
        orders: state.orders,
        payroll: state.payroll.map((run) => ({ ...run, inputs: [] })),
        journals: state.journals,
      }
    if (role === 'hr_admin')
      return { ...empty, employees: state.employees, payroll: state.payroll }
    if (role === 'operations_manager')
      return {
        ...empty,
        products: state.products,
        orders: state.orders,
        projects: state.projects,
        tasks: state.tasks,
        stockMovements: state.stockMovements,
      }
    if (role === 'sales_crm_user')
      return { ...empty, invoices: state.invoices, leads: state.leads }
    if (role === 'department_manager')
      return { ...empty, projects: state.projects, tasks: state.tasks }
    if (role === 'employee') return { ...empty, tasks: state.tasks }
    return empty
  }
  const insight = (state: State, question: string) => {
    const current = metrics(state)
    const salaries = state.employees.reduce(
      (sum, employee) => sum + employee.amount,
      0,
    )
    const expenses = state.expenses.reduce(
      (sum, expense) => sum + expense.amount,
      0,
    )
    const q = question.toLowerCase()
    const lineage = {
      engine: 'deterministic-rules-v1',
      dataWindow: 'Current tenant workspace snapshot',
      sources: [
        {
          module: 'Finance',
          records: state.invoices.length + state.expenses.length,
        },
        { module: 'Inventory', records: state.products.length },
        { module: 'CRM', records: state.leads.length },
        { module: 'HR', records: state.employees.length },
      ],
    }
    if (/runway|burn|months/.test(q)) {
      const burn = salaries + expenses
      const months = burn ? Math.round((current.cash / burn) * 10) / 10 : null
      return {
        answer:
          months === null
            ? 'No recurring payroll or expense burn is recorded, so runway cannot be calculated.'
            : `Estimated operational runway is ${months} months at the recorded monthly burn rate.`,
        calculation: {
          cash: current.cash,
          monthlyPayroll: salaries,
          recordedExpenses: expenses,
          runwayMonths: months,
        },
        confidence: burn > 0 ? 'limited' : 'insufficient_data',
        ...lineage,
      }
    }
    if (/stock|inventory|reorder|sku/.test(q))
      return {
        answer: current.low.length
          ? `${current.low.length} products are below their configured reorder threshold.`
          : 'No products are below their configured reorder threshold.',
        calculation: {
          inventoryValue: current.stock,
          lowStockProducts: current.low.map((product) => product.id),
        },
        confidence: 'high',
        ...lineage,
      }
    if (/pipeline|sales|crm|deal/.test(q))
      return {
        answer: `Open pipeline is ${current.pipeline}; the deterministic 42% weighted scenario is ${Math.round(current.pipeline * 0.42)}.`,
        calculation: {
          openPipeline: current.pipeline,
          assumedWinRate: 0.42,
          weightedScenario: Math.round(current.pipeline * 0.42),
        },
        confidence: 'limited',
        ...lineage,
      }
    return {
      answer: `Cash is ${current.cash}, open receivables are ${current.receivables}, and recorded inventory value is ${current.stock}.`,
      calculation: {
        cash: current.cash,
        receivables: current.receivables,
        inventoryValue: current.stock,
        paidRevenue: current.revenue,
      },
      confidence: 'high',
      ...lineage,
    }
  }
  async function ensureCurrent(c: PoolClient, s: Session) {
    const actor = (
      await c.query<AccountRow>(
        'SELECT id,tenant_id,name,email,role,active,session_version FROM users WHERE id=$1 AND tenant_id=$2',
        [s.user.id, s.tenant],
      )
    ).rows[0]
    if (!sessionIsCurrent(s, actor))
      fail(401, 'Session expired. Sign in again.')
  }
  // User writes hold the workspace lock before checking capacity.
  async function ensureSeatAvailable(c: PoolClient, tenant: string) {
    const capacity = (await c.query('SELECT p.seat_limit,(SELECT count(*) FROM users u WHERE u.tenant_id=t.id AND u.active=true)::int AS used FROM tenants t JOIN subscription_plans p ON p.id=t.plan_id WHERE t.id=$1', [tenant])).rows[0]
    if (!capacity || capacity.used >= capacity.seat_limit)
      fail(409, 'Your plan has no available seats. Disable an unused account or contact your administrator.')
  }
  const snap = (s: Session) =>
    store.tenant(s.tenant, async (c) => {
      const snapshot = await store.read(c, s.tenant)
      const account = (
        await c.query<AccountRow>(
          'SELECT id,tenant_id,name,email,role,active,session_version FROM users WHERE id=$1 AND tenant_id=$2',
          [s.user.id, s.tenant],
        )
      ).rows[0]
      if (!sessionIsCurrent(s, account))
        fail(401, 'Session expired. Sign in again.')
      const plan = (await c.query('SELECT p.id,p.features,p.seat_limit FROM tenants t JOIN subscription_plans p ON p.id=t.plan_id WHERE t.id=$1', [s.tenant])).rows[0]
      return {
        ...snapshot,
        entitlements: { plan: plan.id, features: plan.features, seatLimit: plan.seat_limit },
        state: scopedState(snapshot.state, account.role),
        user: publicUser(account),
        csrf: s.csrf,
      }
    })
  async function issue(
    res: ServerResponse,
    user: User,
    tenant: string,
    sessionVersion: number,
  ) {
    const token = randomBytes(32).toString('hex'),
      s: Session = {
        user: publicUser(user),
        tenant,
        sessionVersion,
        csrf: randomBytes(32).toString('hex'),
      }
    await redis.set(prefix + 'session:' + digest(token), JSON.stringify(s), {
      EX: 28800,
    })
    res.setHeader(
      'Set-Cookie',
      `bos_session=${token}; HttpOnly; SameSite=${cookieSameSite}; Path=/api; Max-Age=28800${config.secure ? '; Secure' : ''}`,
    )
    return s
  }
  async function auth(req: IncomingMessage) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('bos_session='))
      ?.slice(12)
    if (!raw) return fail(401, 'Sign in to continue.')
    const key = prefix + 'session:' + digest(raw),
      value = await redis.get(key)
    if (!value) return fail(401, 'Session expired. Sign in again.')
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = null
    }
    const session = storedSessionSchema.safeParse(parsed)
    if (!session.success) {
      await redis.del(key)
      return fail(401, 'Session expired. Sign in again.')
    }
    const account = (
      await store.pool.query<AccountRow>(
        'SELECT id,tenant_id,name,email,role,active,session_version FROM users WHERE id=$1 AND tenant_id=$2',
        [session.data.user.id, session.data.tenant],
      )
    ).rows[0]
    if (!sessionIsCurrent(session.data, account)) {
      await redis.del(key)
      return fail(
        401,
        'Access was revoked or your session expired. Sign in again.',
      )
    }
    return { key, session: { ...session.data, user: publicUser(account) } }
  }
  const server = createServer(async (req, res) => {
    const requestId = randomUUID(),
      start = Date.now()
    res.setHeader('X-Request-ID', requestId)
    try {
      const path = new URL(req.url || '/', 'http://localhost').pathname
      const origin = req.headers.origin
      if (origin && config.origins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }
      if (req.method === 'OPTIONS' && path.startsWith('/api/v1/')) {
        if (!origin || !config.origins.includes(origin))
          fail(403, 'Request origin is not allowed.')
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, X-CSRF-Token, Idempotency-Key',
          'Access-Control-Max-Age': '600',
        })
        return res.end()
      }
      if (req.method === 'GET' && path === '/api/v1/health') {
        await store.pool.query('SELECT 1')
        await redis.ping()
        return send(res, 200, {
          ok: true,
          database: 'postgresql',
          sessions: 'redis',
        })
      }
      if (req.method === 'GET' && (await sendStatic(res, path))) return
      const mutation = !['GET', 'HEAD'].includes(req.method || '')
      if (mutation && !(req.method === 'POST' && /^\/api\/v1\/webhooks\/banks\/[a-z0-9_-]+$/i.test(path)) && !config.origins.includes(req.headers.origin || ''))
        fail(403, 'Request origin is not allowed.')
      if (
        req.method === 'POST' &&
        ['/api/v1/auth/register', '/api/v1/auth/login'].includes(path)
      ) {
        const attempts = await redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
          {
            keys: [prefix + 'attempts:' + req.socket.remoteAddress],
            arguments: [],
          },
        )
        if (Number(attempts) > 20)
          fail(429, 'Too many attempts. Try again in one minute.')
        const input = await body(req)
        if (path.endsWith('register')) {
          const b = register.parse(input),
            user: User = {
              id: randomUUID(),
              name: b.name,
              email: b.email,
              role: 'owner',
            },
            tenant = randomUUID(),
            passwordHash = await hash(b.password)
          await store.tenant(tenant, async (c) => {
            const state = seed()
            if (!b.sample) {
              state.products = []
              state.invoices = []
              state.leads = []
              state.employees = []
              state.projects = []
              state.tasks = []
              state.openingCash = 0
            }
            for (const rows of [
              state.products,
              state.invoices,
              state.leads,
              state.employees,
              state.projects,
              state.tasks,
            ])
              for (const row of rows) row.id = randomUUID()
            state.organisation = b.organisation
            state.sampleData = b.sample
            state.stockMovements = hydrateInventory({
              ...state,
              stockMovements: undefined,
            }).stockMovements
            for (const m of state.stockMovements) m.actor = b.email
            await c.query('INSERT INTO tenants(id,state) VALUES($1,$2)', [
              tenant,
              { ...state, stockMovements: [] },
            ])
            await c.query(
              'INSERT INTO users(id,tenant_id,email,name,password,role) VALUES($1,$2,$3,$4,$5,$6)',
              [user.id, tenant, b.email, b.name, passwordHash, 'owner'],
            )
            await seedModuleRecords(c, tenant)
            for (const m of state.stockMovements)
              await store.appendStock(c, tenant, m)
            await store.append(c, tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: b.email,
              action: 'workspace_created',
              entity: 'security',
              detail: b.organisation,
            })
          })
          return send(res, 201, await snap(await issue(res, user, tenant, 0)))
        }
        const b = login.parse(input),
          r = (
            await store.pool.query('SELECT * FROM users WHERE email=$1', [
              b.email,
            ])
          ).rows[0]
        const valid = await matches(
          b.password,
          r?.password || `00000000000000000000000000000000:${'0'.repeat(128)}`,
        )
        if (!r || !valid || !r.active)
          fail(401, 'Email or password is incorrect.')
        return send(
          res,
          200,
          await snap(await issue(res, r, r.tenant_id, r.session_version)),
        )
      }
      if (
        req.method === 'POST' &&
        path === '/api/v1/auth/password-reset/request'
      ) {
        const attempts = await redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
          {
            keys: [prefix + 'reset-attempts:' + req.socket.remoteAddress],
            arguments: [],
          },
        )
        if (Number(attempts) > 5)
          fail(429, 'Too many reset requests. Try again later.')
        const b = resetRequest.parse(await body(req))
        const account = (
          await store.pool.query<{ id: string; tenant_id: string }>(
            'SELECT id,tenant_id FROM users WHERE email=$1 AND active=true',
            [b.email],
          )
        ).rows[0]
        let token: string | undefined
        if (account) {
          token = randomBytes(32).toString('hex')
          await store.pool.query(
            'UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
            [account.id],
          )
          await store.pool.query(
            "INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
            [randomUUID(), account.id, digest(token)],
          )
        }
        const response: { ok: true; developmentToken?: string } = { ok: true }
        if (token && process.env.RETURN_RESET_TOKEN === 'true' && process.env.NODE_ENV !== 'production')
          response.developmentToken = token
        return send(res, 200, response)
      }
      if (
        req.method === 'POST' &&
        path === '/api/v1/auth/password-reset/confirm'
      ) {
        const b = resetConfirm.parse(await body(req))
        const found = (
          await store.pool.query<{ tenant_id: string; user_id: string }>(
            `SELECT u.tenant_id,prt.user_id FROM password_reset_tokens prt
           JOIN users u ON u.id=prt.user_id
           WHERE prt.token_hash=$1 AND prt.used_at IS NULL AND prt.expires_at>now()`,
            [digest(b.token)],
          )
        ).rows[0]
        if (!found) fail(400, 'Reset link is invalid or expired.')
        await store.tenant(found.tenant_id, async (c) => {
          const tokenRow = (
            await c.query(
              `SELECT id FROM password_reset_tokens
             WHERE user_id=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,
              [found.user_id, digest(b.token)],
            )
          ).rows[0]
          if (!tokenRow) fail(400, 'Reset link is invalid or expired.')
          await c.query(
            'UPDATE users SET password=$1,session_version=session_version+1 WHERE id=$2 AND tenant_id=$3',
            [await hash(b.newPassword), found.user_id, found.tenant_id],
          )
          await c.query(
            'UPDATE password_reset_tokens SET used_at=now() WHERE id=$1',
            [tokenRow.id],
          )
          await store.append(c, found.tenant_id, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: 'password-recovery',
            action: 'password_reset',
            entity: 'security',
            detail: found.user_id,
          })
        })
        return send(res, 200, { ok: true })
      }
      const bankWebhookRoute = path.match(/^\/api\/v1\/webhooks\/banks\/([a-z0-9_-]+)$/i)
      if (req.method === 'POST' && bankWebhookRoute) {
        const provider = bankWebhookRoute[1].toLowerCase()
        if (!['mock','paystack','flutterwave'].includes(provider)) return fail(503,'Provider adapter is not configured.')
        const bindings = JSON.parse(process.env.BANK_WEBHOOK_BINDINGS || '{}')
        if (!bindings[provider]) return fail(503,'Provider adapter is not configured.')
        const binding = webhookBinding.parse(bindings[provider])
        const raw = await rawBody(req)
        const header = provider === 'paystack' ? 'x-paystack-signature' : provider === 'flutterwave' ? 'flutterwave-signature' : 'x-businessos-signature'
        if (!verifyBankSignature(provider,raw,req.headers[header],binding.secret)) return fail(401,'Invalid webhook signature.')
        let payload: unknown
        try { payload=JSON.parse(raw.toString()) } catch { return fail(400,'Invalid JSON.') }
        const event=normalizeBankEvent(provider,payload)
        if (!event) return send(res,200,{status:'ignored'})
        const result=await store.tenant(binding.tenantId,async c => {
          await store.read(c,binding.tenantId,true)
          const account=(await c.query('SELECT id,currency FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND provider=$3 AND status=$4',[binding.accountId,binding.tenantId,provider,'active'])).rows[0]
          if (!account) return fail(404,'Configured bank account is unavailable.')
          if (account.currency !== event.currency) return fail(400,'Transaction currency does not match bank account.')
          const existing=(await c.query('SELECT id FROM bank_transactions WHERE bank_account_id=$1 AND external_ref=$2',[binding.accountId,event.id])).rows[0]
          if (existing) return {status:'duplicate_ignored',transactionId:existing.id}
          const id=randomUUID()
          const { state } = await store.read(c, binding.tenantId)
          const suggestion = suggestReconciliation(event, [
            ...state.invoices
              .filter((invoice) => invoice.status === 'Unpaid')
              .map((invoice) => ({
                type: 'invoice' as const,
                id: invoice.id,
                amount: invoice.amount,
                label: invoice.name,
              })),
            ...state.expenses.map((expense) => ({
              type: 'expense' as const,
              id: expense.id,
              amount: expense.amount,
              label: expense.name,
            })),
          ])
          await c.query(
            `INSERT INTO bank_transactions
              (id,tenant_id,bank_account_id,external_ref,occurred_at,amount,direction,reference,raw_payload,match_status,matched_entity_type,matched_entity_id)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              id,
              binding.tenantId,
              binding.accountId,
              event.id,
              event.occurredAt,
              event.amount,
              event.direction,
              event.reference,
              payload,
              suggestion ? 'suggested' : 'unmatched',
              suggestion?.source.type || null,
              suggestion?.source.id || null,
            ],
          )
          await store.append(c,binding.tenantId,{id:randomUUID(),date:new Date().toISOString(),actor:'webhook:'+provider,action:'bank_transaction_received',entity:'bank_transaction',detail:id+' / '+event.id+(suggestion ? ` -> suggested ${suggestion.source.type} (${suggestion.confidence}%: ${suggestion.reason})` : '')})
          return {status:'ingested',transactionId:id,matchStatus:suggestion ? 'suggested' : 'unmatched'}
        })
        return send(res,200,result)
      }
      const sharedDocumentRoute = path.match(
        /^\/api\/v1\/shared-documents\/([a-f0-9]{64})$/i,
      )
      if (req.method === 'GET' && sharedDocumentRoute) {
        const tokenHash = digest(sharedDocumentRoute[1])
        const client = await store.pool.connect()
        let share: { id: string; tenant_id: string; document_id: string } | undefined
        try {
          await client.query('BEGIN')
          await client.query("SELECT set_config('app.share_token',$1,true)", [tokenHash])
          share = (
            await client.query(
              `SELECT id,tenant_id,document_id FROM document_shares
               WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()`,
              [tokenHash],
            )
          ).rows[0]
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw error
        } finally {
          client.release()
        }
        if (!share) {
          fail(404, 'This document link is invalid or has expired.')
          return
        }
        const activeShare = share
        const file = await store.tenant(activeShare.tenant_id, async (c) => {
          const row = (
            await c.query(
              `SELECT d.filename,d.mime_type,b.content
               FROM documents d JOIN document_blobs b ON b.document_id=d.id
               WHERE d.id=$1 AND d.tenant_id=$2 AND d.status='active'`,
              [activeShare.document_id, activeShare.tenant_id],
            )
          ).rows[0]
          if (!row) fail(404, 'This document is unavailable.')
          await store.append(c, activeShare.tenant_id, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: 'shared-link:' + activeShare.id,
            action: 'document_shared_link_downloaded',
            entity: 'document',
            detail: activeShare.document_id,
          })
          return row as { filename: string; mime_type: string; content: Buffer }
        })
        res.writeHead(200, {
          'Content-Type': file.mime_type,
          'Content-Length': file.content.length,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        return res.end(file.content)
      }
      const { key, session: s } = await auth(req)
      if (mutation && req.headers['x-csrf-token'] !== s.csrf)
        fail(403, 'Session verification failed. Reload and try again.')
      if (req.method === 'GET' && path === '/api/v1/workspace')
        return send(res, 200, await snap(s))
      const notificationRoute = /^\/api\/v1\/notifications(?:\/([0-9a-f-]+)\/read)?$/i.exec(path)
      if (notificationRoute) {
        const notificationId = notificationRoute[1] ? z.string().uuid().parse(notificationRoute[1]) : undefined
        if (req.method === 'GET' && !notificationId) {
          const unreadOnly = new URL(req.url || '/', 'http://localhost').searchParams.get('unread') === 'true'
          return send(res, 200, await store.tenant(s.tenant, async (c) => {
            await ensureCurrent(c, s)
            const rows = await c.query(
              `SELECT id,kind,title,body,link,read_at,created_at
               FROM notifications WHERE tenant_id=$1 AND recipient_id=$2
               AND ($3::boolean=false OR read_at IS NULL)
               ORDER BY created_at DESC,id DESC LIMIT 100`,
              [s.tenant, s.user.id, unreadOnly],
            )
            return { notifications: rows.rows, unread: rows.rows.filter((row) => !row.read_at).length }
          }))
        }
        if (req.method === 'PATCH' && notificationId) {
          return send(res, 200, await store.tenant(s.tenant, async (c) => {
            await ensureCurrent(c, s)
            const updated = await c.query(
              `UPDATE notifications SET read_at=COALESCE(read_at,now())
               WHERE id=$1 AND tenant_id=$2 AND recipient_id=$3 RETURNING id,read_at`,
              [notificationId, s.tenant, s.user.id],
            )
            if (!updated.rowCount) fail(404, 'Notification not found.')
            return { id: updated.rows[0].id, readAt: updated.rows[0].read_at }
          }))
        }
        if (req.method === 'POST' && !notificationId) {
          if (s.user.role !== 'owner') fail(403, 'Only workspace owners can publish announcements.')
          const b = z.object({
            title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(1000),
            link: z.string().trim().max(500).regex(/^\/[a-z0-9/?=&_-]*$/i).optional(),
          }).strict().parse(await body(req))
          return send(res, 201, await store.tenant(s.tenant, async (c) => {
            await ensureCurrent(c, s)
            const recipients = await c.query('SELECT id FROM users WHERE tenant_id=$1 AND active=true', [s.tenant])
            const ids: string[] = []
            for (const recipient of recipients.rows) {
              const id = randomUUID(); ids.push(id)
              await c.query(
                `INSERT INTO notifications(id,tenant_id,recipient_id,actor_id,kind,title,body,link)
                 VALUES($1,$2,$3,$4,'announcement',$5,$6,$7)`,
                [id, s.tenant, recipient.id, s.user.id, b.title, b.body, b.link || null],
              )
            }
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'announcement_published', entity: 'notification', detail: b.title })
            return { delivered: ids.length, notificationIds: ids }
          }))
        }
        fail(405, 'Method not supported.')
      }
      if (req.method === 'GET' && path === '/api/v1/bi/metrics') {
        const state = await store.tenant(s.tenant, async (c) => {
          await ensureCurrent(c, s)
          return scopedState((await store.read(c, s.tenant)).state, s.user.role)
        })
        const current = metrics(state)
        return send(res, 200, {
          metrics: {
            cash: current.cash,
            revenue: current.revenue,
            receivables: current.receivables,
            payables: current.payables,
            inventoryValue: current.stock,
            pipeline: current.pipeline,
            lowStockCount: current.low.length,
          },
          dataWindow: 'Current tenant workspace snapshot',
          engine: 'deterministic-rules-v1',
        })
      }
      const entitlement = await store.tenant(s.tenant,async c => (await c.query('SELECT p.* FROM tenants t JOIN subscription_plans p ON p.id=t.plan_id WHERE t.id=$1',[s.tenant])).rows[0])
      const required=requiredFeature(path)
      if(required && !entitlement?.features.includes(required)) return fail(403,'Your subscription does not include this feature.')
      if(req.method==='GET' && path==='/api/v1/billing/entitlements') return send(res,200,{plan:entitlement.id,features:entitlement.features,seatLimit:entitlement.seat_limit})
      if (path === '/api/v1/crm/customers' || path.startsWith('/api/v1/crm/customers/')) {
        const route = new RegExp('^/api/v1/crm/customers(?:/([^/]+)(?:/(interactions))?)?$').exec(path)
        if (!route) return fail(404, 'Route not found.')
        const customerId = route[1] ? z.uuid().parse(route[1]) : undefined
        const history = route[2] === 'interactions'
        const write = req.method !== 'GET'
        if (!(write ? ['owner','sales_crm_user'] : ['owner','sales_crm_user','finance_admin','auditor']).includes(s.user.role))
          fail(403, 'Your role cannot access this customer workflow.')
        if (!['GET','POST','PATCH'].includes(req.method || '') ||
            (req.method === 'PATCH' && (!customerId || history)) ||
            (req.method === 'POST' && customerId && !history)) fail(405, 'Method not supported.')
        const input = write ? (history ? interactionInput : req.method === 'PATCH' ? customerUpdate : customerInput).parse(await body(req)) : undefined
        const result = await store.tenant(s.tenant, async c => {
          await ensureCurrent(c, s)
          if (customerId) {
            const exists = await c.query('SELECT id FROM customers WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenant,customerId])
            if (!exists.rowCount) fail(404,'Customer not found.')
          }
          if (!write) {
            if (history) return {interactions:(await c.query('SELECT i.id,i.kind,i.summary,i.occurred_at,i.follow_up_on,i.created_at,u.name AS actor FROM customer_interactions i JOIN users u ON u.id=i.actor_id WHERE i.tenant_id=$1 AND i.customer_id=$2 ORDER BY i.occurred_at DESC,i.id',[s.tenant,customerId])).rows}
            return {customers:(await c.query('SELECT id,name,email,phone,address,tax_reference,status,version,created_at,updated_at FROM customers WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY name,id',[s.tenant,customerId || null])).rows}
          }
          const id = customerId || randomUUID()
          if (history) {
            const b = interactionInput.parse(input)
            await c.query('INSERT INTO customer_interactions(id,tenant_id,customer_id,kind,summary,occurred_at,follow_up_on,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),s.tenant,id,b.kind,b.summary,b.occurredAt,b.followUpOn,s.user.id])
          } else if (req.method === 'PATCH') {
            const b = customerUpdate.parse(input)
            const updated = await c.query('UPDATE customers SET name=$1,email=$2,phone=$3,address=$4,tax_reference=$5,status=$6,version=version+1,updated_at=now() WHERE tenant_id=$7 AND id=$8 AND version=$9',[b.name,b.email,b.phone,b.address,b.taxReference,b.status,s.tenant,id,b.version])
            if (!updated.rowCount) fail(409,'Customer changed. Refresh the profile before saving again.')
          } else {
            const b = customerInput.parse(input)
            await c.query('INSERT INTO customers(id,tenant_id,name,email,phone,address,tax_reference,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,s.tenant,b.name,b.email,b.phone,b.address,b.taxReference,b.status])
          }
          await store.append(c,s.tenant,{id:randomUUID(),date:new Date().toISOString(),actor:s.user.email,action:history?'customer_interaction_logged':req.method==='PATCH'?'customer_updated':'customer_created',entity:id,detail:history?'Customer interaction recorded':'Customer profile saved'})
          return {id}
        })
        return send(res,req.method === 'POST'?201:200,result)
      }
      if (req.method === 'POST' && path === '/api/v1/ai/ask') {
        if (['auditor', 'super_admin'].includes(s.user.role))
          fail(403, 'Your role cannot create AI analysis requests.')
        const input = insightQuestion.parse(await body(req))
        const result = await store.tenant(s.tenant, async (c) => {
          await ensureCurrent(c, s)
          const state = scopedState(
            (await store.read(c, s.tenant, true)).state,
            s.user.role,
          )
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'ai_question_asked',
            entity: 'decision_intelligence',
            detail: input.question,
          })
          return insight(state, input.question)
        })
        return send(res, 200, result)
      }
      if (req.method === 'POST' && path === '/api/v1/ai/forecast') {
        if (['auditor', 'super_admin'].includes(s.user.role))
          fail(403, 'Your role cannot create forecasts.')
        const input = forecastRequest.parse(await body(req))
        const result = await store.tenant(s.tenant, async (c) => {
          await ensureCurrent(c, s)
          const state = scopedState(
            (await store.read(c, s.tenant, true)).state,
            s.user.role,
          )
          const current = metrics(state)
          const values =
            input.metric === 'cash'
              ? {
                  baseline: current.cash,
                  forecast:
                    current.cash +
                    Math.round(current.receivables * 0.75) -
                    current.payables,
                  assumptions: [
                    '75% collection of open receivables',
                    'Recorded payables are settled',
                  ],
                }
              : input.metric === 'pipeline'
                ? {
                    baseline: current.pipeline,
                    forecast: Math.round(current.pipeline * 0.42),
                    assumptions: ['42% weighted opportunity realization'],
                  }
                : {
                    baseline: current.stock,
                    forecast: current.low.length,
                    assumptions: [
                      'Configured reorder thresholds identify stockout risk',
                    ],
                  }
          const horizonDays = input.metric === 'pipeline' ? 45 : 30
          const id = randomUUID()
          const features = {
            cash: current.cash, receivables: current.receivables, payables: current.payables,
            pipeline: current.pipeline, stock: current.stock, lowStock: current.low.length,
            invoices: state.invoices.length, expenses: state.expenses.length, products: state.products.length,
          }
          await c.query(
            'INSERT INTO forecast_runs(id,tenant_id,metric,horizon_days,baseline,forecast_value,assumptions,confidence,data_window,model_version,features,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
            [id, s.tenant, input.metric, horizonDays, values.baseline, values.forecast, JSON.stringify(values.assumptions), 'limited', 'Current tenant workspace snapshot', 'deterministic-rules-v2', JSON.stringify(features), s.user.id],
          )
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'ai_forecast_generated',
            entity: 'decision_intelligence',
            detail: input.metric,
          })
          return {
            id,
            metric: input.metric,
            horizonDays,
            ...values,
            confidence: 'limited',
            dataWindow: 'Current tenant workspace snapshot',
            engine: 'deterministic-rules-v2',
          }
        })
        return send(res, 200, result)
      }
      if ((req.method === 'GET' && path === '/api/v1/ai/forecasts') || (req.method === 'GET' && /^\/api\/v1\/ai\/forecasts\/[0-9a-f-]+$/i.test(path))) {
        if (['auditor', 'super_admin'].includes(s.user.role) && req.method !== 'GET') fail(403, 'Read-only.')
        const one = path.match(/^\/api\/v1\/ai\/forecasts\/([0-9a-f-]+)$/i)
        const rows = await store.tenant(s.tenant, async (c) =>
          (await c.query(
            'SELECT id,metric,horizon_days,baseline,forecast_value,assumptions,confidence,data_window,model_version,features,created_at FROM forecast_runs WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at DESC,id DESC LIMIT 100',
            [s.tenant, one ? one[1] : null],
          )).rows,
        )
        if (one && !rows.length) fail(404, 'Forecast not found.')
        return send(res, 200, one ? rows[0] : { forecasts: rows })
      }
      if (req.method === 'POST' && path === '/api/v1/auth/logout') {
        await redis.del(key)
        res.setHeader(
          'Set-Cookie',
          `bos_session=; HttpOnly; SameSite=${cookieSameSite}; Path=/api; Max-Age=0${config.secure ? '; Secure' : ''}`,
        )
        return send(res, 200, { ok: true })
      }
      if (
        req.method === 'POST' &&
        ['/api/v1/auth/password', '/api/v1/auth/revoke-sessions'].includes(path)
      ) {
        const attempts = await redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
          { keys: [prefix + 'security-attempts:' + s.user.id], arguments: [] },
        )
        if (Number(attempts) > 10)
          fail(429, 'Too many security requests. Try again in one minute.')
        const input = await body(req)
        const change = path.endsWith('/password')
          ? passwordChangeSchema.parse(input)
          : null
        if (!change) z.object({}).strict().parse(input)
        await store.tenant(s.tenant, async (c) => {
          await store.read(c, s.tenant, true)
          await ensureCurrent(c, s)
          const row = (
            await c.query(
              'SELECT * FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
              [s.user.id, s.tenant],
            )
          ).rows[0]
          if (!sessionIsCurrent(s, row))
            fail(401, 'Session expired. Sign in again.')
          if (change) {
            if (!(await matches(change.currentPassword, row.password)))
              fail(400, 'Current password is incorrect.')
            await c.query(
              'UPDATE users SET password=$1,session_version=session_version+1 WHERE id=$2 AND tenant_id=$3',
              [await hash(change.newPassword), s.user.id, s.tenant],
            )
          } else
            await c.query(
              'UPDATE users SET session_version=session_version+1 WHERE id=$1 AND tenant_id=$2',
              [s.user.id, s.tenant],
            )
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: change ? 'password_changed' : 'sessions_revoked',
            entity: 'security',
            detail: 'All prior sessions revoked',
          })
        })
        await redis.del(key)
        res.setHeader(
          'Set-Cookie',
          `bos_session=; HttpOnly; SameSite=${cookieSameSite}; Path=/api; Max-Age=0` +
            (config.secure ? '; Secure' : ''),
        )
        return send(res, 200, { ok: true })
      }
      const accessRoute = path.match(
        /^\/api\/v1\/users\/([0-9a-f-]+)\/access$/i,
      )
      if (req.method === 'PATCH' && accessRoute) {
        if (s.user.role !== 'owner')
          fail(403, 'Only the owner can manage users.')
        const id = z.string().uuid().parse(accessRoute[1]),
          b = z
            .object({ active: z.boolean() })
            .strict()
            .parse(await body(req))
        await store.tenant(s.tenant, async (c) => {
          await store.read(c, s.tenant, true)
          await ensureCurrent(c, s)
          const target = (
            await c.query(
              'SELECT id,name,email,role,active FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
              [id, s.tenant],
            )
          ).rows[0]
          if (!target) fail(404, 'User not found in this workspace.')
          if (!accessChangeAllowed(s.user, target))
            fail(403, 'Owner access cannot be changed here.')
          if (target.active === b.active) return
          if (b.active) await ensureSeatAvailable(c, s.tenant)
          await c.query(
            'UPDATE users SET active=$1,session_version=session_version+1 WHERE id=$2 AND tenant_id=$3',
            [b.active, id, s.tenant],
          )
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: b.active ? 'user_enabled' : 'user_disabled',
            entity: 'security',
            detail: target.email,
          })
        })
        return send(res, 200, { ok: true })
      }
      if (path === '/api/v1/users') {
        if (s.user.role !== 'owner')
          fail(403, 'Only the owner can manage users.')
        if (req.method === 'GET')
          return send(res, 200, {
            users: (
              await store.pool.query(
                'SELECT id,name,email,role,active FROM users WHERE tenant_id=$1 ORDER BY name,id',
                [s.tenant],
              )
            ).rows,
          })
        if (req.method === 'POST') {
          const b = z
              .object({
                name: text,
                email,
                password,
                role: z.enum(userRoles.filter((role) => role !== 'owner' && role !== 'super_admin')),
              })
              .strict()
              .parse(await body(req)),
            h = await hash(b.password)
          await store.tenant(s.tenant, async (c) => {
            await store.read(c, s.tenant, true)
            await ensureCurrent(c, s)
            await ensureSeatAvailable(c, s.tenant)
            await c.query(
              'INSERT INTO users(id,tenant_id,email,name,password,role) VALUES($1,$2,$3,$4,$5,$6)',
              [randomUUID(), s.tenant, b.email, b.name, h, b.role],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'user_added',
              entity: 'security',
              detail: b.email + ' (' + b.role + ')',
            })
          })
          return send(res, 201, { ok: true })
        }
      }
      if (path === '/api/v1/banks/accounts' || (req.method === 'POST' && path === '/api/v1/banks/connect')) {
        if (!['owner', 'finance_admin', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot view bank accounts.')
        if (req.method === 'GET') {
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              accounts: (
                await c.query(
                  'SELECT id,provider,external_ref,name,currency,status,created_at FROM bank_accounts WHERE tenant_id=$1 ORDER BY created_at DESC',
                  [s.tenant],
                )
              ).rows,
            })),
          )
        }
        if (req.method === 'POST') {
          if (!['owner', 'finance_admin'].includes(s.user.role))
            fail(403, 'Your role cannot manage bank accounts.')
          const b = z
            .object({
              provider: text,
              externalRef: text,
              name: text,
              currency: z
                .string()
                .trim()
                .regex(/^[A-Z]{3}$/),
            })
            .strict()
            .parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO bank_accounts(id,tenant_id,provider,external_ref,name,currency,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                id,
                s.tenant,
                b.provider,
                b.externalRef,
                b.name,
                b.currency,
                'active',
              ],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'bank_account_added',
              entity: 'bank_account',
              detail: b.name,
            })
          })
          return send(res, 201, { id })
        }
      }
      if (req.method === 'GET' && ['/api/v1/finance/export.csv','/api/v1/finance/export.xlsx'].includes(path)) {
        const xlsx = path.endsWith('.xlsx')
        if (!['owner', 'finance_admin', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot export financial reports.')
        const period = reportingPeriod.parse(Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams))
        const csv = await store.tenant(s.tenant, async (c) => {
          const { state } = await store.read(c, s.tenant)
          const cell = (value: unknown) => {
            const text = String(value ?? '')
            const safe = /^[=+\-@]/.test(text) ? "'" + text : text
            return '"' + safe.replaceAll('"', '""') + '"'
          }
          const statements={income:generateIncomeStatement(state,period),balance:generateBalanceSheet(state,period),cashFlow:generateCashFlowStatement(state,period)}
          const rows: unknown[][] = [
            ['section','date','description','debit_account','credit_account','amount','status'],
            ['period',period.to || '',period.from || 'Beginning','','','','UTC reporting dates'],
            ['summary',period.to || '', 'Closing cash','','',statements.cashFlow.closingCash,'posted journals and opening cash'],
            ['summary',period.to || '', 'Receivables at period end','','',statements.balance.assets.receivables,'posted journals'],
            ['summary','','Operating expenses in period','','',statements.income.operatingExpenses,'posted journals'],
            ...periodState(state,period).journals.map(journal=>['journal',journal.date,journal.source,journal.debit,journal.credit,journal.amount,'posted']),
          ]
          function statementRows(prefix:string,value:unknown) {
            if(value && typeof value==='object') for(const [key,item] of Object.entries(value)) statementRows(prefix+'.'+key,item)
            else if(typeof value==='number') rows.push(['statement','',prefix,'','',value,'posted journals'])
          }
          statementRows('statement',statements)
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'finance_report_exported',
            entity: 'finance_report',
            detail: JSON.stringify({format:xlsx?'XLSX':'CSV',period}),
          })
          return xlsx ? financeWorkbook(rows) : rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
        })
        if (Buffer.isBuffer(csv)) {
          res.writeHead(200, {'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="businessos-finance-report.xlsx"','Cache-Control':'private, no-store','Content-Length':csv.length})
          return res.end(csv)
        }
        return sendCsv(res, 'businessos-finance-report.csv', csv)
      }
      if (req.method === 'GET' && path === '/api/v1/finance/statements') {
        const query = new URL(req.url || '/', 'http://localhost').searchParams
        const period = reportingPeriod.parse(Object.fromEntries(query))
        if (!['owner', 'finance_admin', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot view financial statements.')
        const data = await store.tenant(s.tenant, async (c) => {
          const { state } = await store.read(c, s.tenant)
          return {
            incomeStatement: generateIncomeStatement(state, period),
            balanceSheet: generateBalanceSheet(state, period),
            cashFlowStatement: generateCashFlowStatement(state, period),
          }
        })
        return send(res, 200, data)
      }
      if (req.method === 'GET' && path === '/api/v1/finance/export.pdf') {
        if (!['owner', 'finance_admin', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot export financial reports.')
        const period = reportingPeriod.parse(Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams))
        const data = await store.tenant(s.tenant, async (c) => {
          const { state } = await store.read(c, s.tenant)
          const statements = { income: generateIncomeStatement(state, period), balance: generateBalanceSheet(state, period), cashFlow: generateCashFlowStatement(state, period) }
          await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'finance_report_exported', entity: 'finance_report', detail: JSON.stringify({ format: 'PDF', period }) })
          return { state, statements }
        })
        const money = (n: unknown) => String(n ?? 0)
        const pdf = pdfReport('BusinessOS Financial Report', [
          { label: 'Period', value: period.from || period.to ? `${period.from || 'Beginning'} to ${period.to || 'Latest'}` : 'All posted journals' },
          { label: 'Revenue', value: money(data.statements.income.revenue) },
          { label: 'COGS', value: money(data.statements.income.cogs) },
          { label: 'Gross profit', value: money(data.statements.income.grossProfit) },
          { label: 'Operating expenses', value: money(data.statements.income.operatingExpenses) },
          { label: 'Net profit', value: money(data.statements.income.netProfit) },
          { label: 'Cash (closing)', value: money(data.statements.cashFlow.closingCash) },
          { label: 'Receivables', value: money(data.statements.balance.assets.receivables) },
          { label: 'Inventory', value: money(data.statements.balance.assets.inventory) },
          { label: 'Payables', value: money(data.statements.balance.liabilities.payables) },
          { label: 'Balanced', value: String(data.statements.balance.isBalanced) },
        ], { tenant: data.state.organisation, actor: s.user.email, period: period.from || period.to ? `${period.from || ''}..${period.to || ''}` : 'all' })
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="businessos-finance-report.pdf"', 'Cache-Control': 'private, no-store', 'Content-Length': pdf.length })
        return res.end(pdf)
      }
      if (req.method === 'GET' && path === '/api/v1/audit-logs') {
        if (!['owner', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot view the audit trail.')
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .catch(50)
          .parse(
            new URL(req.url || '/', 'http://localhost').searchParams.get(
              'limit',
            ),
          )
        return send(
          res,
          200,
          await store.tenant(s.tenant, async (c) => ({
            entries: (
              await c.query(
                `SELECT payload FROM audit WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,
                [s.tenant, limit],
              )
            ).rows.map((row) => row.payload),
          })),
        )
      }
      const payrollBatchRoute = path.match(
        /^\/api\/v1\/payroll\/runs\/([0-9a-f-]+)\/payment-batches$/i,
      )
      if (payrollBatchRoute) {
        const payrollRunId = z.string().uuid().parse(payrollBatchRoute[1])
        if (
          !['owner', 'finance_admin', 'hr_admin', 'auditor'].includes(
            s.user.role,
          )
        )
          fail(403, 'Your role cannot view payroll payment batches.')
        if (req.method === 'GET')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              batches: (
                await c.query(
                  `SELECT id,payroll_run_id,amount,status,created_at,updated_at
               FROM payroll_payment_batches WHERE tenant_id=$1 AND payroll_run_id=$2 ORDER BY created_at DESC`,
                  [s.tenant, payrollRunId],
                )
              ).rows,
            })),
          )
        if (req.method === 'POST') {
          if (!['owner', 'finance_admin'].includes(s.user.role))
            fail(
              403,
              'Only finance-authorised users can generate payment batches.',
            )
          z.object({})
            .strict()
            .parse(await body(req))
          const requestKey = z
            .string()
            .uuid()
            .parse(req.headers['idempotency-key'])
          const batch = await store.tenant(s.tenant, async (c) => {
            const { state } = await store.read(c, s.tenant, true)
            await ensureCurrent(c, s)
            const payroll = state.payroll.find((run) => run.id === payrollRunId)
            if (!payroll) throw new HttpError(404, 'Payroll run not found.')
            if (payroll.status !== 'Approved')
              fail(
                400,
                'Approve the payroll run before generating its payment batch.',
              )
            const existing = (
              await c.query(
                `SELECT id,payroll_run_id,amount,status,created_at,updated_at,idempotency_key
               FROM payroll_payment_batches WHERE tenant_id=$1 AND payroll_run_id=$2 FOR UPDATE`,
                [s.tenant, payrollRunId],
              )
            ).rows[0]
            if (existing) {
              if (existing.idempotency_key !== requestKey)
                fail(
                  409,
                  'A payment batch already exists for this payroll run.',
                )
              return existing
            }
            const id = randomUUID()
            const created = (
              await c.query(
                `INSERT INTO payroll_payment_batches(id,tenant_id,payroll_run_id,idempotency_key,amount,created_by)
               VALUES($1,$2,$3,$4,$5,$6)
               RETURNING id,payroll_run_id,amount,status,created_at,updated_at`,
                [
                  id,
                  s.tenant,
                  payrollRunId,
                  requestKey,
                  payroll.rulesVersion ? Math.round(generatePayslips(state,payrollRunId).reduce((n,p)=>n+p.netPay,0)*100)/100 : payroll.amount,
                  s.user.id,
                ],
              )
            ).rows[0]
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'payroll_payment_batch_generated',
              entity: 'payroll_payment_batch',
              detail: payroll.name + ' -> ' + id,
            })
            return created
          })
          return send(res, 201, { batch })
        }
      }
      const payslipsRoute = path.match(
        /^\/api\/v1\/hr\/runs\/([0-9a-f-]+)\/payslips$/i,
      )
      if (req.method === 'GET' && payslipsRoute) {
        if (
          !['owner', 'hr_admin', 'finance_admin', 'auditor'].includes(
            s.user.role,
          )
        )
          fail(403, 'Your role cannot view employee payslips.')
        const payrollRunId = z.string().uuid().parse(payslipsRoute[1])
        const slips = await store.tenant(s.tenant, async (c) => {
          const { state } = await store.read(c, s.tenant)
          return generatePayslips(state, payrollRunId)
        })
        return send(res, 200, { payslips: slips })
      }
      const bankImportRoute = path.match(
        /^\/api\/v1\/banks\/accounts\/([0-9a-f-]+)\/transactions\/import$/i,
      )
      if (req.method === 'POST' && bankImportRoute) {
        if (!['owner', 'finance_admin'].includes(s.user.role))
          fail(403, 'Your role cannot import bank transactions.')
        const accountId = z.string().uuid().parse(bankImportRoute[1])
        const payload = z
          .object({
            transactions: z
              .array(
                z
                  .object({
                    externalRef: text,
                    occurredAt: z.string().datetime(),
                    amount: z.number().finite().refine((value) => value !== 0),
                    direction: z.enum(['credit', 'debit']),
                    reference: text,
                  })
                  .strict(),
              )
              .min(1)
              .max(250),
          })
          .strict()
          .parse(await body(req))
        const refs = payload.transactions.map((transaction) => transaction.externalRef)
        if (new Set(refs).size !== refs.length)
          fail(400, 'Each imported transaction must have a unique external reference.')
        const result = await store.tenant(s.tenant, async (c) => {
          const account = (
            await c.query(
              'SELECT id FROM bank_accounts WHERE id=$1 AND tenant_id=$2',
              [accountId, s.tenant],
            )
          ).rows[0]
          if (!account) fail(404, 'Bank account not found.')
          const existing = new Set(
            (
              await c.query(
                `SELECT external_ref FROM bank_transactions
                 WHERE tenant_id=$1 AND bank_account_id=$2 AND external_ref = ANY($3::text[])`,
                [s.tenant, accountId, refs],
              )
            ).rows.map((row) => row.external_ref as string),
          )
          const { state } = await store.read(c, s.tenant)
          let imported = 0
          let suggested = 0
          for (const transaction of payload.transactions) {
            if (existing.has(transaction.externalRef)) continue
            const suggestion = suggestReconciliation(transaction, [
              ...state.invoices
                .filter((invoice) => invoice.status === 'Unpaid')
                .map((invoice) => ({
                  type: 'invoice' as const,
                  id: invoice.id,
                  amount: invoice.amount,
                  label: invoice.name,
                })),
              ...state.expenses.map((expense) => ({
                type: 'expense' as const,
                id: expense.id,
                amount: expense.amount,
                label: expense.name,
              })),
            ])
            await c.query(
              `INSERT INTO bank_transactions
                (id,tenant_id,bank_account_id,external_ref,occurred_at,amount,direction,reference,raw_payload,match_status,matched_entity_type,matched_entity_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                randomUUID(),
                s.tenant,
                accountId,
                transaction.externalRef,
                transaction.occurredAt,
                transaction.amount,
                transaction.direction,
                transaction.reference,
                { import: 'csv', transaction },
                suggestion ? 'suggested' : 'unmatched',
                suggestion?.source.type || null,
                suggestion?.source.id || null,
              ],
            )
            imported += 1
            if (suggestion) suggested += 1
          }
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'bank_statement_imported',
            entity: 'bank_transaction',
            detail: `${imported} imported, ${existing.size} duplicate references skipped, ${suggested} suggested matches`,
          })
          return { imported, skipped: existing.size, suggested }
        })
        return send(res, 201, result)
      }
      const bankTransactionRoute = path.match(
        /^\/api\/v1\/banks\/accounts\/([0-9a-f-]+)\/transactions(?:\/([0-9a-f-]+))?$/i,
      )
      if (bankTransactionRoute) {
        if (!['owner', 'finance_admin', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot view bank transactions.')
        const accountId = z.string().uuid().parse(bankTransactionRoute[1])
        const transactionId = bankTransactionRoute[2]
          ? z.string().uuid().parse(bankTransactionRoute[2])
          : undefined
        if (req.method === 'GET')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              transactions: (
                await c.query(
                  `SELECT id,external_ref,occurred_at,amount,direction,reference,match_status,
                        matched_entity_type,matched_entity_id,reconciled_at,created_at
                 FROM bank_transactions
                 WHERE tenant_id=$1 AND bank_account_id=$2
                 ORDER BY occurred_at DESC,id`,
                  [s.tenant, accountId],
                )
              ).rows,
            })),
          )
        if (req.method === 'POST' && !transactionId) {
          if (!['owner', 'finance_admin'].includes(s.user.role))
            fail(403, 'Your role cannot manage bank transactions.')
          const b = z
            .object({
              externalRef: text,
              occurredAt: z.string().datetime(),
              amount: z
                .number()
                .finite()
                .refine((value) => value !== 0),
              direction: z.enum(['credit', 'debit']),
              reference: text,
            })
            .strict()
            .parse(await body(req))
          const id = randomUUID()
          const created = await store.tenant(s.tenant, async (c) => {
            const account = (
              await c.query(
                'SELECT id FROM bank_accounts WHERE id=$1 AND tenant_id=$2',
                [accountId, s.tenant],
              )
            ).rows[0]
            if (!account) fail(404, 'Bank account not found.')
            const { state } = await store.read(c, s.tenant)
            const suggestion = suggestReconciliation(
              b,
              [
                ...state.invoices
                  .filter((invoice) => invoice.status === 'Unpaid')
                  .map((invoice) => ({
                    type: 'invoice' as const,
                    id: invoice.id,
                    amount: invoice.amount,
                    label: invoice.name,
                  })),
                ...state.expenses.map((expense) => ({
                  type: 'expense' as const,
                  id: expense.id,
                  amount: expense.amount,
                  label: expense.name,
                })),
              ],
            )
            await c.query(
              `INSERT INTO bank_transactions
                (id,tenant_id,bank_account_id,external_ref,occurred_at,amount,direction,reference,raw_payload,match_status,matched_entity_type,matched_entity_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                id,
                s.tenant,
                accountId,
                b.externalRef,
                b.occurredAt,
                b.amount,
                b.direction,
                b.reference,
                b,
                suggestion ? 'suggested' : 'unmatched',
                suggestion?.source.type || null,
                suggestion?.source.id || null,
              ],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'bank_transaction_added',
              entity: 'bank_transaction',
              detail:
                b.reference +
                (suggestion
                  ? ` -> suggested ${suggestion.source.type} (${suggestion.confidence}%: ${suggestion.reason})`
                  : ''),
            })
            return {
              match_status: suggestion ? 'suggested' : 'unmatched',
              matched_entity_type: suggestion?.source.type || null,
              matched_entity_id: suggestion?.source.id || null,
            }
          })
          return send(res, 201, {
            id,
            ...b,
            match_status: created.match_status,
            matched_entity_type: created.matched_entity_type,
            matched_entity_id: created.matched_entity_id,
            reconciled_at: null,
          })
        }
        if (req.method === 'PATCH' && transactionId) {
          if (!['owner', 'finance_admin'].includes(s.user.role))
            fail(403, 'Your role cannot reconcile bank transactions.')
          const b = z
            .object({
              matchStatus: z.enum([
                'unmatched',
                'suggested',
                'matched',
                'ignored',
              ]),
              matchedEntityType: z.enum(['invoice', 'expense']).optional(),
              matchedEntityId: z.string().uuid().optional(),
            })
            .strict()
            .parse(await body(req))
          const reconciliation = await store.tenant(s.tenant, async (c) => {
            const current = (
              await c.query(
                `SELECT match_status,matched_entity_type,matched_entity_id,amount,direction FROM bank_transactions
               WHERE id=$1 AND bank_account_id=$2 AND tenant_id=$3 FOR UPDATE`,
                [transactionId, accountId, s.tenant],
              )
            ).rows[0]
            if (!current) fail(404, 'Bank transaction not found.')
            let invoiceSettled = false
            let matchedEntityType = current.matched_entity_type as
              | 'invoice'
              | 'expense'
              | null
            let matchedEntityId = current.matched_entity_id as string | null
            if (b.matchStatus === 'matched') {
              const manualMatch = b.matchedEntityType || b.matchedEntityId
              if (Boolean(b.matchedEntityType) !== Boolean(b.matchedEntityId))
                fail(400, 'Provide both a source type and source ID for a manual match.')
              if (manualMatch) {
                matchedEntityType = b.matchedEntityType!
                matchedEntityId = b.matchedEntityId!
              } else if (
                current.match_status !== 'suggested' ||
                !matchedEntityType ||
                !matchedEntityId
              )
                fail(
                  400,
                  'Choose a valid source for a manual match, or approve a current system suggestion.',
                )
              const snapshot = await store.read(c, s.tenant, true)
              const { state } = snapshot
              const expectedType = current.direction === 'credit' ? 'invoice' : 'expense'
              if (matchedEntityType !== expectedType)
                fail(400, 'Credits can only match invoices and debits can only match expenses.')
              const sourceExists =
                matchedEntityType === 'invoice'
                  ? state.invoices.some(
                      (invoice) =>
                        invoice.id === matchedEntityId &&
                        invoice.status === 'Unpaid' &&
                        invoice.amount === Math.abs(Number(current.amount)),
                    )
                  : matchedEntityType === 'expense'
                    ? state.expenses.some(
                        (expense) =>
                          expense.id === matchedEntityId &&
                          expense.amount === Math.abs(Number(current.amount)),
                      )
                    : false
              if (!sourceExists)
                fail(
                  409,
                  'The suggested source is no longer available for reconciliation.',
                )
              if (matchedEntityType === 'invoice') {
                const next = transition(state, {
                  type: 'status',
                  collection: 'invoices',
                  id: matchedEntityId!,
                  status: 'Paid',
                  actor: s.user.email,
                })
                next.audit[0].actor = s.user.email
                await store.append(c, s.tenant, next.audit[0])
                for (const journal of next.journals.slice(
                  0,
                  next.journals.length - state.journals.length,
                ))
                  await store.append(c, s.tenant, journal, 'journals')
                await c.query(
                  'UPDATE tenants SET state=$1,version=version+1 WHERE id=$2',
                  [
                    { ...next, audit: [], journals: [], stockMovements: [] },
                    s.tenant,
                  ],
                )
                invoiceSettled = true
              }
            }
            if (
              b.matchStatus === 'suggested' &&
              current.match_status !== 'suggested'
            )
              fail(
                400,
                'Reconciliation suggestions are generated by the matching engine.',
              )
            const preserveSource = b.matchStatus === 'suggested' || b.matchStatus === 'matched'
            const result = await c.query(
              `UPDATE bank_transactions SET match_status=$1,
                 matched_entity_type=$2,
                 matched_entity_id=$3,
                 reconciled_at=CASE WHEN $1='matched' THEN now() ELSE NULL END,
                  reconciled_by=CASE WHEN $1='matched' THEN $4::uuid ELSE NULL::uuid END
               WHERE id=$5 AND bank_account_id=$6 AND tenant_id=$7`,
              [
                b.matchStatus,
                preserveSource ? matchedEntityType : null,
                preserveSource ? matchedEntityId : null,
                s.user.id,
                transactionId,
                accountId,
                s.tenant,
              ],
            )
            if (!result.rowCount) fail(404, 'Bank transaction not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'bank_transaction_reconciled',
              entity: 'bank_transaction',
              detail:
                transactionId +
                ' -> ' +
                b.matchStatus +
                (preserveSource
                  ? ` (${matchedEntityType}:${matchedEntityId})`
                  : ''),
            })
            return { invoiceSettled }
          })
          return send(res, 200, {
            ok: true,
            invoiceSettled: reconciliation.invoiceSettled,
          })
        }
      }
      if (path === '/api/v1/documents') {
        if (req.method === 'GET') {
          if (!canReadModule(s.user.role, 'documents'))
            fail(403, 'Your role cannot view documents.')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              documents: (
                await c.query(
                  `SELECT id,filename,mime_type,size_bytes,storage_key,version,status,uploaded_by,created_at,updated_at
                 FROM documents WHERE tenant_id=$1 ORDER BY updated_at DESC,id`,
                  [s.tenant],
                )
              ).rows,
            })),
          )
        }
        if (req.method === 'POST') {
          if (!canWriteModule(s.user.role, 'documents'))
            fail(403, 'Your role cannot register documents.')
          const b = z
            .object({
              filename: z.string().trim().min(1).max(255),
              mimeType: z
                .string()
                .trim()
                .min(1)
                .max(120)
                .regex(/^[\w.-]+\/[\w.+-]+$/),
              sizeBytes: z.number().int().min(0).max(104857600),
              contentBase64: z.string().min(4).max(2796204).optional(),
            })
            .strict()
            .parse(await body(req, 3 * 1024 * 1024))
          let content: Buffer | null = null
          if (b.contentBase64) {
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b.contentBase64))
              fail(400, 'Document content must be Base64 encoded.')
            content = Buffer.from(b.contentBase64, 'base64')
            if (!content.length || content.length > 2097152)
              fail(413, 'Document uploads are limited to 2 MB in local storage.')
            if (content.length !== b.sizeBytes)
              fail(400, 'Document size does not match its uploaded content.')
          }
          const id = randomUUID()
          const storageKey = `${s.tenant}/${id}/${b.filename}`
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              `INSERT INTO documents(id,tenant_id,filename,mime_type,size_bytes,storage_key,uploaded_by)
               VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [
                id,
                s.tenant,
                b.filename,
                b.mimeType,
                b.sizeBytes,
                storageKey,
                s.user.id,
              ],
            )
            if (content)
              await c.query(
                `INSERT INTO document_blobs(document_id,tenant_id,content,sha256)
                 VALUES($1,$2,$3,$4)`,
                [
                  id,
                  s.tenant,
                  content,
                  createHash('sha256').update(content).digest('hex'),
                ],
              )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'document_registered',
              entity: 'document',
              detail: b.filename + (content ? ' (binary stored)' : ' (metadata only)'),
            })
          })
          return send(res, 201, {
            id,
            ...b,
            storageKey,
            version: 1,
            status: 'active',
            contentStored: Boolean(content),
          })
        }
      }
      const documentCommentRoute = path.match(/^\/api\/v1\/documents\/([0-9a-f-]+)\/comments$/i)
      if (documentCommentRoute) {
        const documentId = z.string().uuid().parse(documentCommentRoute[1])
        if (req.method === 'GET') {
          if (!canReadModule(s.user.role, 'documents')) fail(403, 'Your role cannot view document comments.')
          return send(res, 200, await store.tenant(s.tenant, async (c) => {
            const exists = await c.query('SELECT id FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, s.tenant])
            if (!exists.rowCount) fail(404, 'Document not found.')
            return { comments: (await c.query(
              `SELECT dc.id,dc.body,dc.created_at,u.name AS author
               FROM document_comments dc JOIN users u ON u.id=dc.author_id
               WHERE dc.document_id=$1 AND dc.tenant_id=$2 ORDER BY dc.created_at DESC,dc.id DESC`,
              [documentId, s.tenant],
            )).rows }
          }))
        }
        if (req.method === 'POST') {
          if (!canWriteModule(s.user.role, 'documents')) fail(403, 'Your role cannot comment on documents.')
          const b = z.object({ body: z.string().trim().min(1).max(1000) }).strict().parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            const exists = await c.query('SELECT id FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, s.tenant])
            if (!exists.rowCount) fail(404, 'Document not found.')
            await c.query('INSERT INTO document_comments(id,tenant_id,document_id,author_id,body) VALUES($1,$2,$3,$4,$5)', [id, s.tenant, documentId, s.user.id, b.body])
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'document_commented', entity: 'document', detail: documentId })
          })
          return send(res, 201, { id, body: b.body })
        }
        fail(405, 'Method not supported.')
      }
      const documentVersionRoute = path.match(/^\/api\/v1\/documents\/([0-9a-f-]+)\/versions(?:\/(\d+)(\/content)?)?$/i)
      if (documentVersionRoute) {
        const documentId = z.string().uuid().parse(documentVersionRoute[1])
        const version = documentVersionRoute[2] ? z.coerce.number().int().min(1).parse(documentVersionRoute[2]) : undefined
        const contentRequest = Boolean(documentVersionRoute[3])
        if (!version && req.method === 'GET') {
          if (!canReadModule(s.user.role, 'documents')) fail(403, 'Your role cannot view document history.')
          return send(res, 200, await store.tenant(s.tenant, async (c) => {
            const document = await c.query('SELECT id,version,filename,mime_type,size_bytes,updated_at FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, s.tenant])
            if (!document.rowCount) fail(404, 'Document not found.')
            const history = await c.query('SELECT version,filename,mime_type,size_bytes,created_at FROM document_versions WHERE document_id=$1 AND tenant_id=$2 ORDER BY version DESC', [documentId, s.tenant])
            return { current: document.rows[0], versions: history.rows }
          }))
        }
        if (!version && req.method === 'POST') {
          if (!canWriteModule(s.user.role, 'documents')) fail(403, 'Your role cannot upload document revisions.')
          const b = z.object({ filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(120).regex(/^[\w.-]+\/[\w.+-]+$/), sizeBytes: z.number().int().min(1).max(2097152), contentBase64: z.string().min(4).max(2796204) }).strict().parse(await body(req, 3 * 1024 * 1024))
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b.contentBase64)) fail(400, 'Document content must be Base64 encoded.')
          const content = Buffer.from(b.contentBase64, 'base64')
          if (!content.length || content.length > 2097152) fail(413, 'Document uploads are limited to 2 MB in local storage.')
          if (content.length !== b.sizeBytes) fail(400, 'Document size does not match its uploaded content.')
          const hash = createHash('sha256').update(content).digest('hex')
          const result = await store.tenant(s.tenant, async (c) => {
            const current = (await c.query(
              `SELECT d.id,d.filename,d.mime_type,d.size_bytes,d.version,d.status,d.uploaded_by,b.content,b.sha256
               FROM documents d JOIN document_blobs b ON b.document_id=d.id
               WHERE d.id=$1 AND d.tenant_id=$2 FOR UPDATE`, [documentId, s.tenant],
            )).rows[0]
            if (!current) fail(404, 'Only documents with stored content can be revised.')
            if (current.status !== 'active') fail(409, 'Restore the document before uploading a revision.')
            await c.query(
              `INSERT INTO document_versions(id,tenant_id,document_id,version,filename,mime_type,size_bytes,content,sha256,uploaded_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id,document_id,version) DO NOTHING`,
              [randomUUID(), s.tenant, documentId, current.version, current.filename, current.mime_type, current.size_bytes, current.content, current.sha256, current.uploaded_by],
            )
            const nextVersion = Number(current.version) + 1
            await c.query('UPDATE documents SET filename=$1,mime_type=$2,size_bytes=$3,version=$4,updated_at=now(),uploaded_by=$5 WHERE id=$6 AND tenant_id=$7', [b.filename, b.mimeType, b.sizeBytes, nextVersion, s.user.id, documentId, s.tenant])
            await c.query('UPDATE document_blobs SET content=$1,sha256=$2 WHERE document_id=$3 AND tenant_id=$4', [content, hash, documentId, s.tenant])
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'document_revised', entity: 'document', detail: documentId + ' v' + nextVersion })
            return { version: nextVersion }
          })
          return send(res, 201, result)
        }
        if (version && contentRequest && req.method === 'GET') {
          if (!canReadModule(s.user.role, 'documents')) fail(403, 'Your role cannot download document history.')
          const file = await store.tenant(s.tenant, async (c) => {
            const row = (await c.query('SELECT filename,mime_type,content FROM document_versions WHERE document_id=$1 AND tenant_id=$2 AND version=$3', [documentId, s.tenant, version])).rows[0]
            if (!row) fail(404, 'Document version not found.')
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'document_version_downloaded', entity: 'document', detail: documentId + ' v' + version })
            return row as { filename: string; mime_type: string; content: Buffer }
          })
          res.writeHead(200, { 'Content-Type': file.mime_type, 'Content-Length': file.content.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
          return res.end(file.content)
        }
        fail(405, 'Method not supported.')
      }
      const documentContentRoute = path.match(
        /^\/api\/v1\/documents\/([0-9a-f-]+)\/content$/i,
      )
      if (documentContentRoute && req.method === 'GET') {
        if (!canReadModule(s.user.role, 'documents'))
          fail(403, 'Your role cannot download documents.')
        const id = z.string().uuid().parse(documentContentRoute[1])
        const file = await store.tenant(s.tenant, async (c) => {
          const row = (
            await c.query(
              `SELECT d.filename,d.mime_type,b.content
               FROM documents d JOIN document_blobs b ON b.document_id=d.id
               WHERE d.id=$1 AND d.tenant_id=$2 AND d.status='active'`,
              [id, s.tenant],
            )
          ).rows[0]
          if (!row) fail(404, 'Document content is unavailable.')
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'document_downloaded',
            entity: 'document',
            detail: id,
          })
          return row as { filename: string; mime_type: string; content: Buffer }
        })
        res.writeHead(200, {
          'Content-Type': file.mime_type,
          'Content-Length': file.content.length,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        return res.end(file.content)
      }
      const documentShareRoute = path.match(
        /^\/api\/v1\/documents\/([0-9a-f-]+)\/shares$/i,
      )
      if (documentShareRoute && req.method === 'POST') {
        if (!canWriteModule(s.user.role, 'documents'))
          fail(403, 'Your role cannot share documents.')
        const documentId = z.string().uuid().parse(documentShareRoute[1])
        const { expiresHours } = z
          .object({ expiresHours: z.number().int().min(1).max(168).default(24) })
          .strict()
          .parse(await body(req))
        const token = randomBytes(32).toString('hex')
        const expiresAt = new Date(Date.now() + expiresHours * 3600000)
        await store.tenant(s.tenant, async (c) => {
          const document = (
            await c.query(
              `SELECT d.id FROM documents d JOIN document_blobs b ON b.document_id=d.id
               WHERE d.id=$1 AND d.tenant_id=$2 AND d.status='active'`,
              [documentId, s.tenant],
            )
          ).rows[0]
          if (!document) fail(404, 'Only active documents with stored content can be shared.')
          await c.query(
            `INSERT INTO document_shares(id,tenant_id,document_id,token_hash,expires_at,created_by)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [randomUUID(), s.tenant, documentId, digest(token), expiresAt, s.user.id],
          )
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'document_share_created',
            entity: 'document',
            detail: documentId + ' / expires ' + expiresAt.toISOString(),
          })
        })
        return send(res, 201, { token, expiresAt: expiresAt.toISOString() })
      }
      const documentRoute = path.match(/^\/api\/v1\/documents\/([0-9a-f-]+)$/i)
      if (documentRoute && req.method === 'PATCH') {
        if (!canWriteModule(s.user.role, 'documents'))
          fail(403, 'Your role cannot archive documents.')
        const id = z.string().uuid().parse(documentRoute[1])
        const b = z
          .object({ status: z.enum(['active', 'archived']) })
          .strict()
          .parse(await body(req))
        await store.tenant(s.tenant, async (c) => {
          const result = await c.query(
            'UPDATE documents SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3',
            [b.status, id, s.tenant],
          )
          if (!result.rowCount) fail(404, 'Document not found.')
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action:
              b.status === 'archived'
                ? 'document_archived'
                : 'document_restored',
            entity: 'document',
            detail: id,
          })
        })
        return send(res, 200, { ok: true })
      }
      const ticketRoute = path.match(
        /^\/api\/v1\/support\/tickets(?:\/([0-9a-f-]+))?$/i,
      )
      if (ticketRoute) {
        const ticketId = ticketRoute[1]
          ? z.string().uuid().parse(ticketRoute[1])
          : undefined
        if (req.method === 'GET') {
          if (!canReadModule(s.user.role, 'support'))
            fail(403, 'Your role cannot view support tickets.')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              tickets: (
                await c.query(
                  `SELECT id,ticket_number,subject,customer,priority,status,sla_due_at,assigned_to,created_at,updated_at
               FROM support_tickets WHERE tenant_id=$1 ORDER BY updated_at DESC,id`,
                  [s.tenant],
                )
              ).rows,
            })),
          )
        }
        if (!canWriteModule(s.user.role, 'support'))
          fail(403, 'Your role cannot manage support tickets.')
        if (req.method === 'POST' && !ticketId) {
          const b = z
            .object({
              subject: text,
              customer: text,
              priority: z.enum(['low', 'medium', 'high', 'urgent']),
              slaDueAt: z.string().datetime().nullable().default(null),
            })
            .strict()
            .parse(await body(req))
          const id = randomUUID(),
            ticketNumber = 'T-' + randomUUID().slice(0, 8).toUpperCase()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              `INSERT INTO support_tickets(id,tenant_id,ticket_number,subject,customer,priority,sla_due_at)
               VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [
                id,
                s.tenant,
                ticketNumber,
                b.subject,
                b.customer,
                b.priority,
                b.slaDueAt,
              ],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'support_ticket_created',
              entity: 'support_ticket',
              detail: ticketNumber,
            })
          })
          return send(res, 201, { id, ticketNumber, ...b, status: 'open' })
        }
        if (req.method === 'PATCH' && ticketId) {
          const b = z
            .object({
              status: z.enum(['open', 'pending', 'resolved', 'closed']),
              priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
            })
            .strict()
            .parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              `UPDATE support_tickets SET status=$1,priority=COALESCE($2,priority),updated_at=now()
               WHERE id=$3 AND tenant_id=$4`,
              [b.status, b.priority || null, ticketId, s.tenant],
            )
            if (!result.rowCount) fail(404, 'Support ticket not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'support_ticket_updated',
              entity: 'support_ticket',
              detail: ticketId + ' -> ' + b.status,
            })
          })
          return send(res, 200, { ok: true })
        }
      }
      const taxRoute = path.match(
        /^\/api\/v1\/tax\/filings(?:\/([0-9a-f-]+))?$/i,
      )
      if (taxRoute) {
        const filingId = taxRoute[1]
          ? z.string().uuid().parse(taxRoute[1])
          : undefined
        if (req.method === 'GET') {
          if (!canReadModule(s.user.role, 'tax'))
            fail(403, 'Your role cannot view tax filings.')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              filings: (
                await c.query(
                  `SELECT id,name,territory,due_date,amount,status,created_at,updated_at
               FROM tax_filings WHERE tenant_id=$1 ORDER BY due_date ASC,id`,
                  [s.tenant],
                )
              ).rows,
            })),
          )
        }
        if (!canWriteModule(s.user.role, 'tax'))
          fail(403, 'Your role cannot manage tax filings.')
        if (req.method === 'POST' && !filingId) {
          const b = z
            .object({
              name: text,
              territory: text,
              dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              amount: z.number().finite().min(0),
            })
            .strict()
            .parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO tax_filings(id,tenant_id,name,territory,due_date,amount) VALUES($1,$2,$3,$4,$5,$6)',
              [id, s.tenant, b.name, b.territory, b.dueDate, b.amount],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'tax_filing_created',
              entity: 'tax_filing',
              detail: b.name,
            })
          })
          return send(res, 201, { id, ...b, status: 'draft' })
        }
        if (req.method === 'PATCH' && filingId) {
          const b = z
            .object({
              status: z.enum(['draft', 'ready', 'filed', 'paid', 'overdue']),
            })
            .strict()
            .parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              'UPDATE tax_filings SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3',
              [b.status, filingId, s.tenant],
            )
            if (!result.rowCount) fail(404, 'Tax filing not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'tax_filing_updated',
              entity: 'tax_filing',
              detail: filingId + ' -> ' + b.status,
            })
          })
          return send(res, 200, { ok: true })
        }
      }
      const locationRoute = path.match(
        /^\/api\/v1\/warehouse\/locations(?:\/([0-9a-f-]+))?$/i,
      )
      if (locationRoute) {
        const locationId = locationRoute[1]
          ? z.string().uuid().parse(locationRoute[1])
          : undefined
        if (req.method === 'GET') {
          if (!canReadModule(s.user.role, 'warehouse'))
            fail(403, 'Your role cannot view warehouse locations.')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              locations: (
                await c.query(
                  'SELECT id,name,code,status,created_at,updated_at FROM warehouse_locations WHERE tenant_id=$1 ORDER BY name,id',
                  [s.tenant],
                )
              ).rows,
            })),
          )
        }
        if (!canWriteModule(s.user.role, 'warehouse'))
          fail(403, 'Your role cannot manage warehouse locations.')
        if (req.method === 'POST' && !locationId) {
          const b = z
            .object({ name: text, code: z.string().trim().min(1).max(40) })
            .strict()
            .parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO warehouse_locations(id,tenant_id,name,code) VALUES($1,$2,$3,$4)',
              [id, s.tenant, b.name, b.code],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'warehouse_location_created',
              entity: 'warehouse_location',
              detail: b.code,
            })
          })
          return send(res, 201, { id, ...b, status: 'active' })
        }
        if (req.method === 'PATCH' && locationId) {
          const b = z
            .object({ status: z.enum(['active', 'inactive']) })
            .strict()
            .parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              'UPDATE warehouse_locations SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3',
              [b.status, locationId, s.tenant],
            )
            if (!result.rowCount) fail(404, 'Warehouse location not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'warehouse_location_updated',
              entity: 'warehouse_location',
              detail: locationId + ' -> ' + b.status,
            })
          })
          return send(res, 200, { ok: true })
        }
      }
      const supplierRoute = path.match(
        /^\/api\/v1\/suppliers(?:\/([0-9a-f-]+))?$/i,
      )
      if (supplierRoute) {
        const supplierId = supplierRoute[1]
          ? z.string().uuid().parse(supplierRoute[1])
          : undefined
        if (req.method === 'GET') {
          if (!['owner', 'operations_manager', 'auditor'].includes(s.user.role))
            fail(403, 'Your role cannot view suppliers.')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              suppliers: (
                await c.query(
                  'SELECT id,name,contact,lead_days,status,created_at,updated_at FROM suppliers WHERE tenant_id=$1 ORDER BY name,id',
                  [s.tenant],
                )
              ).rows,
            })),
          )
        }
        if (!['owner', 'operations_manager'].includes(s.user.role))
          fail(403, 'Your role cannot manage suppliers.')
        if (req.method === 'POST' && !supplierId) {
          const b = z
            .object({
              name: text,
              contact: z.string().trim().max(200).default(''),
              leadDays: z.number().int().min(0).max(3650),
            })
            .strict()
            .parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO suppliers(id,tenant_id,name,contact,lead_days) VALUES($1,$2,$3,$4,$5)',
              [id, s.tenant, b.name, b.contact, b.leadDays],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'supplier_created',
              entity: 'supplier',
              detail: b.name,
            })
          })
          return send(res, 201, { id, ...b, status: 'active' })
        }
        if (req.method === 'PATCH' && supplierId) {
          const b = z
            .object({ status: z.enum(['active', 'review', 'inactive']) })
            .strict()
            .parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              'UPDATE suppliers SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3',
              [b.status, supplierId, s.tenant],
            )
            if (!result.rowCount) fail(404, 'Supplier not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'supplier_updated',
              entity: 'supplier',
              detail: supplierId + ' -> ' + b.status,
            })
          })
          return send(res, 200, { ok: true })
        }
      }

      // 1. Assets Management (Module 1 & 11)
      const assetRoute = path.match(/^\/api\/v1\/assets(?:\/([0-9a-f-]+))?$/i)
      if (assetRoute) {
        const assetId = assetRoute[1] ? z.string().uuid().parse(assetRoute[1]) : undefined
        if (req.method === 'GET') {
          if (!['owner', 'operations_manager', 'finance_admin', 'auditor'].includes(s.user.role))
            fail(403, 'Your role cannot view capital assets.')
          return send(res, 200, await store.tenant(s.tenant, async (c) => {
            const rows = (await c.query(
              'SELECT id,name,serial_number,category,cost,depreciation_rate,location,status,created_at,updated_at FROM assets WHERE tenant_id=$1 ORDER BY created_at DESC',
              [s.tenant]
            )).rows
            return {
              assets: rows.map((r) => {
                const elapsedYears = Math.max(0, (Date.now() - new Date(r.created_at).getTime()) / (365.25 * 24 * 3600 * 1000))
                const {bookValue} = depreciation(Number(r.cost),Number(r.depreciation_rate),elapsedYears)
                return { ...r, cost: Number(r.cost), depreciation_rate: Number(r.depreciation_rate), book_value: bookValue }
              })
            }
          }))
        }
        if (req.method === 'POST' && !assetId) {
          if (!['owner', 'operations_manager', 'finance_admin'].includes(s.user.role))
            fail(403, 'Your role cannot register assets.')
          const b = z.object({
            name: text,
            serialNumber: z.string().trim().min(1).max(100),
            category: z.string().trim().min(1).max(100),
            cost: z.number().finite().min(0),
            depreciationRate: z.number().finite().min(0).max(100).default(20),
            location: z.string().trim().max(100).default('Main Office'),
          }).strict().parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO assets(id,tenant_id,name,serial_number,category,cost,depreciation_rate,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [id, s.tenant, b.name, b.serialNumber, b.category, b.cost, b.depreciationRate, b.location]
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'asset_registered',
              entity: 'asset',
              detail: `${b.name} (${b.serialNumber})`,
            })
          })
          return send(res, 201, { id, ...b, status: 'operational' })
        }
        if (req.method === 'PATCH' && assetId) {
          if (!['owner', 'operations_manager', 'finance_admin'].includes(s.user.role))
            fail(403, 'Your role cannot update assets.')
          const b = z.object({
            status: z.enum(['operational', 'maintenance', 'retired']).optional(),
            location: z.string().trim().max(100).optional(),
          }).strict().parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              'UPDATE assets SET status=COALESCE($1,status), location=COALESCE($2,location), updated_at=now() WHERE id=$3 AND tenant_id=$4',
              [b.status || null, b.location || null, assetId, s.tenant]
            )
            if (!result.rowCount) fail(404, 'Asset not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'asset_updated',
              entity: 'asset',
              detail: `${assetId} -> ${b.status || b.location}`,
            })
          })
          return send(res, 200, { ok: true })
        }
      }

      // 2. Facilities Work Orders (Module 11)
      const facilityRoute = path.match(/^\/api\/v1\/facilities\/work-orders(?:\/([0-9a-f-]+))?$/i)
      if (facilityRoute) {
        const orderId = facilityRoute[1] ? z.string().uuid().parse(facilityRoute[1]) : undefined
        if (req.method === 'GET') {
          if (!['owner', 'operations_manager', 'auditor'].includes(s.user.role))
            fail(403, 'Your role cannot view facility work orders.')
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            workOrders: (await c.query(
              'SELECT id,facility_name,equipment,condition,priority,status,description,scheduled_date,created_at,updated_at FROM facilities_work_orders WHERE tenant_id=$1 ORDER BY created_at DESC',
              [s.tenant]
            )).rows,
          })))
        }
        if (req.method === 'POST' && !orderId) {
          if (!['owner', 'operations_manager'].includes(s.user.role))
            fail(403, 'Your role cannot create facility work orders.')
          const b = z.object({
            facilityName: text,
            equipment: text,
            condition: z.enum(['good', 'fair', 'needs_service', 'critical']),
            priority: z.enum(['low', 'medium', 'high', 'urgent']),
            description: z.string().trim().max(500).default(''),
            scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
          }).strict().parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO facilities_work_orders(id,tenant_id,facility_name,equipment,condition,priority,description,scheduled_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [id, s.tenant, b.facilityName, b.equipment, b.condition, b.priority, b.description, b.scheduledDate]
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'facility_work_order_created',
              entity: 'facilities',
              detail: `${b.facilityName} · ${b.equipment}`,
            })
          })
          return send(res, 201, { id, ...b, status: 'open' })
        }
        if (req.method === 'PATCH' && orderId) {
          if (!['owner', 'operations_manager'].includes(s.user.role))
            fail(403, 'Your role cannot update facility work orders.')
          const b = z.object({
            status: z.enum(['none', 'open', 'in_progress', 'completed']),
            condition: z.enum(['good', 'fair', 'needs_service', 'critical']).optional(),
          }).strict().parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              'UPDATE facilities_work_orders SET status=$1, condition=COALESCE($2,condition), updated_at=now() WHERE id=$3 AND tenant_id=$4',
              [b.status, b.condition || null, orderId, s.tenant]
            )
            if (!result.rowCount) fail(404, 'Work order not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'facility_work_order_updated',
              entity: 'facilities',
              detail: `${orderId} -> ${b.status}`,
            })
          })
          return send(res, 200, { ok: true })
        }
      }

      // 3. Production Management & Quality (Module 12)
      const productionRoute = path.match(/^\/api\/v1\/production\/batches(?:\/([0-9a-f-]+))?$/i)
      if (productionRoute) {
        const batchId = productionRoute[1] ? z.string().uuid().parse(productionRoute[1]) : undefined
        if (req.method === 'GET') {
          if (!['owner', 'operations_manager', 'auditor'].includes(s.user.role))
            fail(403, 'Your role cannot view production batches.')
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            batches: (await c.query(
              'SELECT id,batch_number,product_name,planned_qty,completed_qty,defect_count,status,created_at,updated_at FROM production_batches WHERE tenant_id=$1 ORDER BY created_at DESC',
              [s.tenant]
            )).rows,
          })))
        }
        if (req.method === 'POST' && !batchId) {
          if (!['owner', 'operations_manager'].includes(s.user.role))
            fail(403, 'Your role cannot create production batches.')
          const b = z.object({
            batchNumber: text,
            productName: text,
            plannedQty: z.number().int().min(1),
          }).strict().parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO production_batches(id,tenant_id,batch_number,product_name,planned_qty) VALUES($1,$2,$3,$4,$5)',
              [id, s.tenant, b.batchNumber, b.productName, b.plannedQty]
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'production_batch_scheduled',
              entity: 'production',
              detail: `${b.batchNumber} · ${b.productName}`,
            })
          })
          return send(res, 201, { id, ...b, completedQty: 0, defectCount: 0, status: 'scheduled' })
        }
        if (req.method === 'PATCH' && batchId) {
          if (!['owner', 'operations_manager'].includes(s.user.role))
            fail(403, 'Your role cannot update production batches.')
          const b = z.object({
            completedQty: z.number().int().min(0).optional(),
            defectCount: z.number().int().min(0).optional(),
            status: z.enum(['scheduled', 'running', 'qa_check', 'completed']).optional(),
          }).strict().parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const current=(await c.query('SELECT status,planned_qty,completed_qty,defect_count FROM production_batches WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[batchId,s.tenant])).rows[0]
            if(!current) return fail(404,'Batch not found.')
            try { validateProductionUpdate(current,b) } catch(e) { return fail(400,e instanceof Error?e.message:'Invalid production update.') }
            const result = await c.query(
              'UPDATE production_batches SET completed_qty=COALESCE($1,completed_qty), defect_count=COALESCE($2,defect_count), status=COALESCE($3,status), updated_at=now() WHERE id=$4 AND tenant_id=$5',
              [b.completedQty ?? null, b.defectCount ?? null, b.status || null, batchId, s.tenant]
            )
            if (!result.rowCount) fail(404, 'Batch not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'production_batch_updated',
              entity: 'production',
              detail: `${batchId} -> ${b.status || 'updated'}`,
            })
          })
          return send(res, 200, { ok: true })
        }
      }

      // 4. Front Office & Visitors (Module 8)
      const visitorRoute = path.match(/^\/api\/v1\/frontoffice\/visitors(?:\/([0-9a-f-]+))?$/i)
      if (visitorRoute) {
        if (!["owner","sales_crm_user","department_manager","employee"].includes(s.user.role) && !(req.method === 'GET' && s.user.role === 'auditor')) fail(403, 'Your role cannot access this workflow.')
        const visitorId = visitorRoute[1] ? z.string().uuid().parse(visitorRoute[1]) : undefined
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            visitors: (await c.query(
              'SELECT id,visitor_name,host_person,company,purpose,status,check_in_time,check_out_time,created_at,updated_at FROM front_office_visitors WHERE tenant_id=$1 ORDER BY created_at DESC',
              [s.tenant]
            )).rows,
          })))
        }
        if (req.method === 'POST' && !visitorId) {
          const b = z.object({
            visitorName: text,
            hostPerson: text,
            company: z.string().trim().max(100).default(''),
            purpose: text,
            status: z.enum(['scheduled', 'checked_in']).default('scheduled'),
          }).strict().parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              `INSERT INTO front_office_visitors(id,tenant_id,visitor_name,host_person,company,purpose,status,check_in_time)
               VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7='checked_in' THEN now() ELSE NULL END)`,
              [id, s.tenant, b.visitorName, b.hostPerson, b.company, b.purpose, b.status]
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'visitor_logged',
              entity: 'frontoffice',
              detail: `${b.visitorName} -> ${b.hostPerson}`,
            })
          })
          return send(res, 201, { id, ...b })
        }
        if (req.method === 'PATCH' && visitorId) {
          const b = z.object({
            status: z.enum(['scheduled', 'checked_in', 'completed', 'cancelled']),
          }).strict().parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              `UPDATE front_office_visitors SET status=$1,
                check_in_time=CASE WHEN $1='checked_in' AND check_in_time IS NULL THEN now() ELSE check_in_time END,
                check_out_time=CASE WHEN $1='completed' THEN now() ELSE check_out_time END,
                updated_at=now()
               WHERE id=$2 AND tenant_id=$3`,
              [b.status, visitorId, s.tenant]
            )
            if (!result.rowCount) fail(404, 'Visitor record not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'visitor_status_updated',
              entity: 'frontoffice',
              detail: `${visitorId} -> ${b.status}`,
            })
          })
          return send(res, 200, { ok: true })
        }
      }

      // 5. Marketing Campaigns & ROI (Module 6)
      const campaignRoute = path.match(/^\/api\/v1\/marketing\/campaigns(?:\/([0-9a-f-]+))?$/i)
      if (campaignRoute) {
        if (!["owner","sales_crm_user"].includes(s.user.role) && !(req.method === 'GET' && s.user.role === 'auditor')) fail(403, 'Your role cannot access this workflow.')
        const campaignId = campaignRoute[1] ? z.string().uuid().parse(campaignRoute[1]) : undefined
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => {
            const rows = (await c.query(
              'SELECT id,name,channel,budget,spend,leads_count,revenue_generated,status,created_at,updated_at FROM marketing_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC',
              [s.tenant]
            )).rows
            return {
              campaigns: rows.map((r) => {
                const spend = Number(r.spend)
                const revenue = Number(r.revenue_generated)
                const roi = spend > 0 ? Math.round(((revenue - spend) / spend) * 100) : 0
                return { ...r, budget: Number(r.budget), spend, leads_count: Number(r.leads_count), revenue_generated: revenue, roi_percent: roi }
              })
            }
          }))
        }
        if (req.method === 'POST' && !campaignId) {
          const b = z.object({
            name: text,
            channel: z.enum(['social', 'email', 'search', 'event', 'referral']),
            budget: z.number().finite().min(0).default(0),
            spend: z.number().finite().min(0).default(0),
          }).strict().parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO marketing_campaigns(id,tenant_id,name,channel,budget,spend) VALUES($1,$2,$3,$4,$5,$6)',
              [id, s.tenant, b.name, b.channel, b.budget, b.spend]
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'marketing_campaign_created',
              entity: 'marketing',
              detail: `${b.name} (${b.channel})`,
            })
          })
          return send(res, 201, { id, ...b, leads_count: 0, revenue_generated: 0, roi_percent: 0, status: 'planning' })
        }
        if (req.method === 'PATCH' && campaignId) {
          const b = z.object({
            spend: z.number().finite().min(0).optional(),
            leadsCount: z.number().int().min(0).optional(),
            revenueGenerated: z.number().finite().min(0).optional(),
            status: z.enum(['planning', 'active', 'completed', 'paused']).optional(),
          }).strict().parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              'UPDATE marketing_campaigns SET spend=COALESCE($1,spend), leads_count=COALESCE($2,leads_count), revenue_generated=COALESCE($3,revenue_generated), status=COALESCE($4,status), updated_at=now() WHERE id=$5 AND tenant_id=$6',
              [b.spend ?? null, b.leadsCount ?? null, b.revenueGenerated ?? null, b.status || null, campaignId, s.tenant]
            )
            if (!result.rowCount) fail(404, 'Campaign not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'marketing_campaign_updated',
              entity: 'marketing',
              detail: `${campaignId} updated`,
            })
          })
          return send(res, 200, { ok: true })
        }
      }

      // 6. Compliance & Risk Register (Module 16)
      const riskRoute = path.match(/^\/api\/v1\/compliance\/risks(?:\/([0-9a-f-]+))?$/i)
      if (riskRoute) {
        if (!["owner","finance_admin","operations_manager","hr_admin"].includes(s.user.role) && !(req.method === 'GET' && s.user.role === 'auditor')) fail(403, 'Your role cannot access this workflow.')
        const riskId = riskRoute[1] ? z.string().uuid().parse(riskRoute[1]) : undefined
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            risks: (await c.query(
              'SELECT id,title,category,severity,status,mitigation_plan,review_date,created_at,updated_at FROM compliance_risks WHERE tenant_id=$1 ORDER BY created_at DESC',
              [s.tenant]
            )).rows,
          })))
        }
        if (req.method === 'POST' && !riskId) {
          const b = z.object({
            title: text,
            category: z.enum(['financial', 'operational', 'regulatory', 'security', 'vendor']),
            severity: z.enum(['low', 'medium', 'high', 'critical']),
            mitigationPlan: z.string().trim().max(500).default(''),
            reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
          }).strict().parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              'INSERT INTO compliance_risks(id,tenant_id,title,category,severity,mitigation_plan,review_date) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [id, s.tenant, b.title, b.category, b.severity, b.mitigationPlan, b.reviewDate]
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'compliance_risk_identified',
              entity: 'compliance',
              detail: `${b.title} [${b.severity}]`,
            })
          })
          return send(res, 201, { id, ...b, status: 'identified' })
        }
        if (req.method === 'PATCH' && riskId) {
          const b = z.object({
            status: z.enum(['identified', 'mitigating', 'controlled', 'accepted']),
            mitigationPlan: z.string().trim().max(500).optional(),
          }).strict().parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const result = await c.query(
              'UPDATE compliance_risks SET status=$1, mitigation_plan=COALESCE($2,mitigation_plan), updated_at=now() WHERE id=$3 AND tenant_id=$4',
              [b.status, b.mitigationPlan || null, riskId, s.tenant]
            )
            if (!result.rowCount) fail(404, 'Risk record not found.')
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'compliance_risk_updated',
              entity: 'compliance',
              detail: `${riskId} -> ${b.status}`,
            })
          })
          return send(res, 200, { ok: true })
        }
      }

      // 7. Warehouse Stock Transfers (Module 17)
      if (path === '/api/v1/warehouse/transfers') {
        if (!['owner', 'operations_manager', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot view stock transfers.')
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            transfers: (await c.query(
              'SELECT id,source_location_id,destination_location_id,product_id,product_name,quantity,status,transferred_at,created_at FROM stock_transfers WHERE tenant_id=$1 ORDER BY created_at DESC',
              [s.tenant]
            )).rows,
          })))
        }
        if (req.method === 'POST') {
          if (!['owner', 'operations_manager'].includes(s.user.role))
            fail(403, 'Your role cannot execute stock transfers.')
          const b = z.object({
            sourceLocationId: z.string().uuid().nullable().default(null),
            destinationLocationId: z.string().uuid(),
            productId: text,
            quantity: z.number().int().min(1),
          }).strict().parse(await body(req))

          const requestKey=z.string().uuid().parse(req.headers['idempotency-key'])
          const transfer = await store.tenant(s.tenant, async (c) => {
            const { state } = await store.read(c, s.tenant, true)
            const prior=(await c.query('SELECT * FROM stock_transfers WHERE tenant_id=$1 AND request_key=$2',[s.tenant,requestKey])).rows[0]
            if(prior) {
              if(prior.source_location_id!==b.sourceLocationId || prior.destination_location_id!==b.destinationLocationId || prior.product_id!==b.productId || prior.quantity!==b.quantity) return fail(409,'Idempotency key was used for a different transfer.')
              return {id:prior.id,productName:prior.product_name,quantity:prior.quantity,status:prior.status}
            }
            const product = state.products.find((p) => p.id === b.productId)
            if (!product) return fail(404, 'Product not found.')
            if (product.qty < b.quantity)
              fail(400, `Insufficient stock (${product.qty} available, requested ${b.quantity}).`)

            if (b.sourceLocationId === b.destinationLocationId) return fail(400,'Choose different source and destination locations.')
            for (const location of [b.sourceLocationId,b.destinationLocationId].filter(Boolean)) {
              if (!(await c.query('SELECT id FROM warehouse_locations WHERE id=$1 AND tenant_id=$2 AND status=$3',[location,s.tenant,'active'])).rowCount) return fail(404,'Warehouse location not found.')
            }
            const allocations=(await c.query('SELECT location_id,quantity FROM warehouse_stock WHERE tenant_id=$1 AND product_id=$2',[s.tenant,b.productId])).rows
            const available=b.sourceLocationId ? Number(allocations.find(row=>row.location_id===b.sourceLocationId)?.quantity || 0) : product.qty-allocations.reduce((n,row)=>n+Number(row.quantity),0)
            if (available < b.quantity) return fail(400,'Insufficient stock at the source location.')
            if (b.sourceLocationId) await c.query('UPDATE warehouse_stock SET quantity=quantity-$1 WHERE tenant_id=$2 AND location_id=$3 AND product_id=$4',[b.quantity,s.tenant,b.sourceLocationId,b.productId])
            await c.query('INSERT INTO warehouse_stock(tenant_id,location_id,product_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,location_id,product_id) DO UPDATE SET quantity=warehouse_stock.quantity+EXCLUDED.quantity',[s.tenant,b.destinationLocationId,b.productId,b.quantity])
            const id = randomUUID()
            await c.query(
              'INSERT INTO stock_transfers(id,tenant_id,source_location_id,destination_location_id,product_id,product_name,quantity,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [id, s.tenant, b.sourceLocationId, b.destinationLocationId, b.productId, product.name, b.quantity, requestKey]
            )

            for (const [location,delta] of [[b.sourceLocationId,-b.quantity],[b.destinationLocationId,b.quantity]]) await c.query('INSERT INTO warehouse_movements(id,tenant_id,transfer_id,location_id,product_id,quantity_delta) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),s.tenant,id,location,b.productId,delta])
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'warehouse_stock_transferred',
              entity: 'warehouse',
              detail: `${b.quantity}x ${product.name}`,
            })

            return { id, productName: product.name, quantity: b.quantity, status: 'completed' }
          })

          return send(res, 201, transfer)
        }
      }

      const returnRoute = new RegExp('^/api/v1/warehouse/shipment-returns(?:/([0-9a-f-]+))?$','i').exec(path)
      if(returnRoute) {
        const result=await handleReturns({store,session:s,method:req.method||'GET',id:returnRoute[1],input:mutation?await body(req):undefined,requestKey:req.headers['idempotency-key'] as string|undefined,ensureCurrent,fail})
        return send(res,result.status,result.body)
      }
      const shipmentRoute = new RegExp('^/api/v1/warehouse/shipments(?:/([0-9a-f-]+))?$','i').exec(path)
      if(shipmentRoute) {
        const result=await handleShipments({store,session:s,method:req.method||'GET',id:shipmentRoute[1],input:mutation?await body(req):undefined,requestKey:req.headers['idempotency-key'] as string|undefined,ensureCurrent,fail})
        return send(res,result.status,result.body)
      }
      const warehouseWorkflowRoute = path.match(/^\/api\/v1\/warehouse\/(fulfillments|returns)(?:\/([0-9a-f-]+))?$/i)
      if (warehouseWorkflowRoute) {
        if (!['owner', 'operations_manager', 'auditor'].includes(s.user.role)) fail(403, 'Your role cannot access this workflow.')
        const kind = warehouseWorkflowRoute[1] === 'fulfillments' ? 'fulfillment' : 'return'
        const recordId = warehouseWorkflowRoute[2] ? z.string().uuid().parse(warehouseWorkflowRoute[2]) : undefined
        if (req.method === 'GET' && !recordId) {
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            records: (await c.query(
              `SELECT id,name,detail,status,metadata,created_at,updated_at FROM module_records
               WHERE tenant_id=$1 AND module='warehouse' AND metadata->>'kind'=$2 ORDER BY updated_at DESC,id DESC`,
              [s.tenant, kind],
            )).rows,
          })))
        }
        if (req.method === 'POST' && !recordId) {
          if (!['owner', 'operations_manager'].includes(s.user.role)) fail(403, 'Only authorised roles can create warehouse records.')
          const input = await body(req)
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            if (kind === 'fulfillment') {
              const b = z.object({ orderRef: text, customer: z.string().trim().max(160).default(''), items: z.string().trim().min(1).max(500), location: z.string().trim().max(160).default(''), assignee: z.string().trim().max(160).default('') }).strict().parse(input)
              await c.query('INSERT INTO module_records(id,tenant_id,module,name,detail,status,metadata) VALUES($1,$2,\'warehouse\',$3,$4,\'picking\',$5)', [id, s.tenant, b.orderRef, b.items, { kind, customer: b.customer, location: b.location, assignee: b.assignee }])
              await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'fulfillment_created', entity: 'warehouse', detail: b.orderRef })
            } else {
              const b = z.object({ rma: text, customer: z.string().trim().max(160).default(''), product: z.string().trim().min(1).max(500), condition: z.enum(['inspecting','restockable','damaged','salvage']) }).strict().parse(input)
              await c.query('INSERT INTO module_records(id,tenant_id,module,name,detail,status,metadata) VALUES($1,$2,\'warehouse\',$3,$4,\'pending\',$5)', [id, s.tenant, b.rma, b.product, { kind, customer: b.customer, condition: b.condition }])
              await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'return_created', entity: 'warehouse', detail: b.rma })
            }
          })
          return send(res, 201, { id })
        }
        if (req.method === 'PATCH' && recordId) {
          if (!['owner', 'operations_manager'].includes(s.user.role)) fail(403, 'Only authorised roles can update warehouse records.')
          const b = z.object({ status: kind === 'fulfillment' ? z.enum(['packed','dispatched']) : z.enum(['restocked','refunded','exchanged']) }).strict().parse(await body(req))
          await store.tenant(s.tenant, async (c) => {
            const existing = (await c.query(`SELECT name,status FROM module_records WHERE id=$1 AND tenant_id=$2 AND module='warehouse' AND metadata->>'kind'=$3 FOR UPDATE`, [recordId, s.tenant, kind])).rows[0]
            if (!existing) fail(404, 'Warehouse record not found.')
            const valid = kind === 'fulfillment' ? (existing.status === 'picking' && b.status === 'packed') || (existing.status === 'packed' && b.status === 'dispatched') : existing.status === 'pending'
            if (!valid) fail(409, 'This warehouse status transition is not allowed.')
            await c.query('UPDATE module_records SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3', [b.status, recordId, s.tenant])
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: kind + '_status_updated', entity: 'warehouse', detail: existing.name + ' -> ' + b.status })
          })
          return send(res, 200, { ok: true })
        }
        fail(405, 'Method not supported.')
      }

      const workflowRoute = new RegExp('^/api/v1/workflows/([a-z]+)(?:/([0-9a-f-]+))?$','i').exec(path)
      if (workflowRoute) {
        const result = await handleWorkflow({store,session:s,method:req.method || 'GET',kind:workflowRoute[1],id:workflowRoute[2],input:mutation?await body(req):undefined,requestKey:req.headers['idempotency-key'] as string|undefined,ensureCurrent,fail})
        return send(res,result.status,result.body)
      }
      const branchRoute = path.match(/^\/api\/v1\/branches(?:\/([0-9a-f-]+))?$/i)
      if (branchRoute) {
        if (!['owner', 'auditor'].includes(s.user.role)) fail(403, 'Only the owner can manage branches.')
        const branchId = branchRoute[1] ? z.uuid().parse(branchRoute[1]) : undefined
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            branches: (await c.query('SELECT * FROM branches WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY created_at DESC,id', [s.tenant, branchId || null])).rows,
          })))
        }
        if (s.user.role !== 'owner') fail(403, 'Only the owner can manage branches.')
        if (req.method === 'POST' && !branchId) {
          const input = z.object({ name: text, code: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()), timezone: z.string().trim().min(1).max(80).default('Africa/Lagos') }).strict().parse(await body(req))
          const row = await store.tenant(s.tenant, async (c) => {
            const created = (await c.query('INSERT INTO branches(id,tenant_id,name,code,timezone) VALUES($1,$2,$3,$4,$5) RETURNING *', [randomUUID(), s.tenant, input.name, input.code, input.timezone])).rows[0]
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'branch_created', entity: 'branch', detail: input.code })
            return created
          })
          return send(res, 201, row)
        }
        if (req.method === 'PATCH' && branchId) {
          const input = z.object({ version: z.number().int().positive(), name: text.optional(), status: z.enum(['active', 'archived']).optional() }).strict().parse(await body(req))
          const row = await store.tenant(s.tenant, async (c) => {
            const updated = (await c.query('UPDATE branches SET name=COALESCE($1,name),status=COALESCE($2,status),version=version+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 AND version=$5 RETURNING *', [input.name || null, input.status || null, s.tenant, branchId, input.version])).rows[0]
            if (!updated) fail(409, 'Branch changed or not found. Refresh before updating.')
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'branch_updated', entity: branchId, detail: updated.code })
            return updated
          })
          return send(res, 200, row)
        }
        fail(405, 'Method not supported.')
      }
      const chainRoute = path.match(/^\/api\/v1\/approvals\/chains(?:\/([0-9a-f-]+))?$/i)
      if (chainRoute) {
        if (!['owner', 'auditor'].includes(s.user.role)) fail(403, 'Only the owner can configure approval chains.')
        const chainId = chainRoute[1] ? z.uuid().parse(chainRoute[1]) : undefined
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => {
            await seedDefaultChains(c, s.tenant)
            return { chains: (await c.query('SELECT * FROM approval_chains WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY scope,min_amount', [s.tenant, chainId || null])).rows }
          }))
        }
        if (s.user.role !== 'owner') fail(403, 'Only the owner can configure approval chains.')
        if (req.method === 'POST' && !chainId) {
          const input = chainInput.parse(await body(req))
          const row = await store.tenant(s.tenant, async (c) => {
            await seedDefaultChains(c, s.tenant)
            const created = (await c.query('INSERT INTO approval_chains(id,tenant_id,name,scope,min_amount,steps) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [randomUUID(), s.tenant, input.name, input.scope, input.minAmount, JSON.stringify(input.steps)])).rows[0]
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'approval_chain_created', entity: 'approval', detail: input.scope })
            return created
          })
          return send(res, 201, row)
        }
        if (req.method === 'PATCH' && chainId) {
          const input = chainUpdate.parse(await body(req))
          const row = await store.tenant(s.tenant, async (c) => {
            const existing = (await c.query('SELECT * FROM approval_chains WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [s.tenant, chainId])).rows[0]
            if (!existing) fail(404, 'Approval chain not found.')
            if (existing.version !== input.version) fail(409, 'Approval chain changed. Refresh before updating.')
            const updated = (await c.query('UPDATE approval_chains SET steps=COALESCE($1,steps),min_amount=COALESCE($2,min_amount),active=COALESCE($3,active),version=version+1,updated_at=now() WHERE tenant_id=$4 AND id=$5 RETURNING *', [input.steps ? JSON.stringify(input.steps) : null, input.minAmount ?? null, input.active ?? null, s.tenant, chainId])).rows[0]
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'approval_chain_updated', entity: chainId, detail: existing.scope })
            return updated
          })
          return send(res, 200, row)
        }
        fail(405, 'Method not supported.')
      }
      const approvalRoute = path.match(/^\/api\/v1\/approvals\/requests(?:\/([0-9a-f-]+))?$/i)
      if (approvalRoute) {
        const requestId = approvalRoute[1] ? z.uuid().parse(approvalRoute[1]) : undefined
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            requests: (await c.query('SELECT r.*,ch.name AS chain_name FROM approval_requests r JOIN approval_chains ch ON ch.id=r.chain_id WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.id=$2) ORDER BY r.created_at DESC', [s.tenant, requestId || null])).rows,
          })))
        }
        if (req.method === 'POST' && !requestId) {
          if (!['owner', 'finance_admin', 'hr_admin', 'operations_manager'].includes(s.user.role)) fail(403, 'Your role cannot request approvals.')
          const input = z.object({ scope: z.enum(['purchase_order', 'payroll', 'payment', 'master_data']), entityType: text, entityId: text, amount: z.number().finite().min(0).max(1e12).default(0) }).strict().parse(await body(req))
          const row = await store.tenant(s.tenant, async (c) => {
            await seedDefaultChains(c, s.tenant)
            const chain = await matchingChain(c, s.tenant, input.scope, input.amount)
            if (!chain) fail(400, 'No active approval chain covers this request.')
            const created = (await c.query('INSERT INTO approval_requests(id,tenant_id,chain_id,entity_type,entity_id,amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [randomUUID(), s.tenant, chain!.id, input.entityType, input.entityId, input.amount, s.user.id])).rows[0]
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'approval_requested', entity: input.entityId, detail: input.scope })
            return created
          })
          return send(res, 201, row)
        }
        if (req.method === 'PATCH' && requestId) {
          const input = approvalDecision.parse(await body(req))
          const row = await store.tenant(s.tenant, async (c) => {
            const existing = (await c.query('SELECT r.*,ch.steps FROM approval_requests r JOIN approval_chains ch ON ch.id=r.chain_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE', [s.tenant, requestId])).rows[0]
            if (!existing) fail(404, 'Approval request not found.')
            if (existing.version !== input.version) fail(409, 'Approval request changed. Refresh before deciding.')
            if (existing.status !== 'pending') fail(409, 'This approval request is already decided.')
            const steps = existing.steps as { role: string }[]
            const step = steps[existing.current_step]
            if (!step) fail(409, 'Approval chain has no remaining steps.')
            if (step.role !== s.user.role && s.user.role !== 'owner') fail(403, 'This step requires ' + step.role + '.')
            if (existing.created_by === s.user.id && s.user.role !== 'owner') fail(403, 'Another authorised approver must decide this request.')
            const decisions = [...(existing.decisions as unknown[]), { step: existing.current_step, role: s.user.role, decision: input.decision, comment: input.comment, at: new Date().toISOString() }]
            const last = existing.current_step + 1 >= steps.length
            const status = input.decision === 'reject' ? 'rejected' : last ? 'approved' : 'pending'
            const updated = (await c.query('UPDATE approval_requests SET decisions=$1,current_step=$2,status=$3,version=version+1,updated_at=now() WHERE tenant_id=$4 AND id=$5 RETURNING *', [JSON.stringify(decisions), input.decision === 'reject' ? existing.current_step : existing.current_step + 1, status, s.tenant, requestId])).rows[0]
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'approval_' + input.decision, entity: existing.entity_id, detail: 'step ' + existing.current_step + ' -> ' + status })
            return updated
          })
          return send(res, 200, row)
        }
        fail(405, 'Method not supported.')
      }
      const candidateRoute = path.match(/^\/api\/v1\/hr\/candidates(?:\/([0-9a-f-]+))?$/i)
      const interviewRoute = path.match(/^\/api\/v1\/hr\/candidates\/([0-9a-f-]+)\/interviews$/i)
      if (interviewRoute) {
        if (!['owner', 'hr_admin', 'auditor'].includes(s.user.role)) fail(403, 'Your role cannot access recruitment.')
        const candidateId = z.uuid().parse(interviewRoute[1])
        if (req.method === 'GET') {
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            interviews: (await c.query('SELECT * FROM candidate_interviews WHERE tenant_id=$1 AND candidate_id=$2 ORDER BY interview_at DESC,id', [s.tenant, candidateId])).rows,
          })))
        }
        if (s.user.role === 'auditor') fail(403, 'Recruitment is read-only for auditors.')
        const input = z.object({ interviewAt: z.string().datetime(), interviewers: z.string().trim().max(500).default(''), notes: z.string().trim().max(2000).default('') }).strict().parse(await body(req))
        const row = await store.tenant(s.tenant, async (c) => {
          const found = (await c.query('SELECT id FROM recruitment_candidates WHERE tenant_id=$1 AND id=$2', [s.tenant, candidateId])).rows[0]
          if (!found) fail(404, 'Candidate not found.')
          const created = (await c.query('INSERT INTO candidate_interviews(id,tenant_id,candidate_id,interview_at,interviewers,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [randomUUID(), s.tenant, candidateId, input.interviewAt, input.interviewers, input.notes])).rows[0]
          await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'candidate_interview_scheduled', entity: candidateId, detail: input.interviewAt })
          return created
        })
        return send(res, 201, row)
      }
      if (candidateRoute && !interviewRoute) {
        if (!['owner', 'hr_admin', 'auditor'].includes(s.user.role)) fail(403, 'Your role cannot access recruitment.')
        const id = candidateRoute[1] ? z.uuid().parse(candidateRoute[1]) : undefined
        if (req.method === 'GET' && !id) {
          return send(res, 200, await store.tenant(s.tenant, async c => ({
            candidates: (await c.query('SELECT * FROM recruitment_candidates WHERE tenant_id=$1 ORDER BY updated_at DESC,id', [s.tenant])).rows,
          })))
        }
        if (s.user.role === 'auditor') fail(403, 'Recruitment is read-only for auditors.')
        if (req.method === 'POST' && !id) {
          const input = candidateInput.parse(await body(req))
          const candidate = await store.tenant(s.tenant, async c => {
            const row = (await c.query('INSERT INTO recruitment_candidates(id,tenant_id,name,email,position,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [randomUUID(),s.tenant,input.name,input.email,input.position,input.notes])).rows[0]
            await store.append(c,s.tenant,{id:randomUUID(),date:new Date().toISOString(),actor:s.user.email,action:'candidate_created',entity:row.id,detail:input.position})
            return row
          })
          return send(res,201,candidate)
        }
        if (req.method === 'PATCH' && id) {
          const input = candidateUpdate.parse(await body(req))
          const candidate = await store.tenant(s.tenant, async c => {
            const row = (await c.query('SELECT * FROM recruitment_candidates WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[s.tenant,id])).rows[0]
            if (!row) return fail(404,'Candidate not found.')
            if (row.version !== input.version) fail(409,'Candidate changed. Refresh before updating.')
            if (!canAdvanceCandidate(row.status,input.status)) fail(409,'This hiring stage transition is not allowed.')
            const updated = (await c.query('UPDATE recruitment_candidates SET status=$1,version=version+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING *',[input.status,s.tenant,id])).rows[0]
            await store.append(c,s.tenant,{id:randomUUID(),date:new Date().toISOString(),actor:s.user.email,action:'candidate_stage_updated',entity:id,detail:row.status+' -> '+input.status})
            return updated
          })
          return send(res,200,candidate)
        }
        fail(405,'Method not supported.')
      }
      const moduleRoute = path.match(
        /^\/api\/v1\/modules\/([a-z-]+)(?:\/([0-9a-f-]+))?$/i,
      )
      if (moduleRoute) {
        const module = z.enum(moduleNames).parse(moduleRoute[1])
        const recordId = moduleRoute[2]
          ? z.string().uuid().parse(moduleRoute[2])
          : undefined
        if (req.method === 'GET') {
          if (!canReadModule(s.user.role, module))
            fail(403, 'Your role cannot view this module.')
          return send(
            res,
            200,
            await store.tenant(s.tenant, async (c) => ({
              records: (
                await c.query(
                  `SELECT id,module,name,detail,status,metadata,created_at,updated_at
                 FROM module_records WHERE tenant_id=$1 AND module=$2
                 AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR detail ILIKE '%' || $3 || '%')
                 ORDER BY updated_at DESC,name,id`,
                  [
                    s.tenant,
                    module,
                    new URL(req.url || '/', 'http://localhost').searchParams
                      .get('q')
                      ?.trim() || null,
                  ],
                )
              ).rows,
            })),
          )
        }
        if (req.method === 'POST') {
          if (!canWriteModule(s.user.role, module))
            fail(403, 'Your role cannot create module records.')
          const b = z
            .object({
              name: text,
              detail: z.string().trim().max(500).default(''),
              status: text.default('Draft'),
              metadata: z.record(z.string(), z.unknown()).default({}),
            })
            .strict()
            .parse(await body(req))
          const id = randomUUID()
          await store.tenant(s.tenant, async (c) => {
            await c.query(
              `INSERT INTO module_records(id,tenant_id,module,name,detail,status,metadata)
               VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [id, s.tenant, module, b.name, b.detail, b.status, b.metadata],
            )
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'module_record_created',
              entity: module,
              detail: b.name,
            })
          })
          return send(res, 201, { id, module, ...b })
        }
        if (recordId && (req.method === 'PATCH' || req.method === 'DELETE')) {
          if (!canWriteModule(s.user.role, module))
            fail(403, 'Only authorised roles can change module records.')
          const input =
            req.method === 'PATCH'
              ? z
                  .object({
                    name: text.optional(),
                    detail: z.string().trim().max(500).optional(),
                    status: text.optional(),
                    metadata: z.record(z.string(), z.unknown()).optional(),
                  })
                  .strict()
                  .parse(await body(req))
              : null
          await store.tenant(s.tenant, async (c) => {
            const existing = (
              await c.query(
                'SELECT id,name,detail,status,metadata FROM module_records WHERE id=$1 AND tenant_id=$2 AND module=$3 FOR UPDATE',
                [recordId, s.tenant, module],
              )
            ).rows[0]
            if (!existing) fail(404, 'Module record not found.')
            if (req.method === 'DELETE') {
              await c.query(
                'DELETE FROM module_records WHERE id=$1 AND tenant_id=$2',
                [recordId, s.tenant],
              )
            } else {
              const next = { ...existing, ...(input || {}) }
              await c.query(
                `UPDATE module_records SET name=$1,detail=$2,status=$3,metadata=$4,updated_at=now()
                 WHERE id=$5 AND tenant_id=$6`,
                [
                  next.name,
                  next.detail,
                  next.status,
                  next.metadata,
                  recordId,
                  s.tenant,
                ],
              )
            }
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action:
                req.method === 'DELETE'
                  ? 'module_record_deleted'
                  : 'module_record_updated',
              entity: module,
              detail:
                existing.name +
                (req.method === 'PATCH'
                  ? ' -> ' + (input?.status || 'updated')
                  : ''),
            })
          })
          return send(res, 200, { ok: true })
        }
      }
      const outboxRoute = path.match(/^\/api\/v1\/notifications\/outbox$/i)
      if (outboxRoute) {
        if (req.method === 'GET') {
          if (!['owner', 'auditor'].includes(s.user.role)) fail(403, 'Only the owner can inspect the delivery outbox.')
          return send(res, 200, await store.tenant(s.tenant, async (c) => ({
            messages: (await c.query('SELECT id,channel,recipient,subject,status,attempts,provider,created_at FROM message_outbox WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100', [s.tenant])).rows,
          })))
        }
        if (req.method === 'POST') {
          if (!['owner', 'hr_admin', 'operations_manager', 'sales_crm_user', 'department_manager'].includes(s.user.role)) fail(403, 'Your role cannot queue notifications.')
          const input = z.object({ channel: z.enum(['email', 'sms', 'whatsapp', 'push']), recipient: z.string().trim().min(1).max(320), subject: z.string().trim().max(200).default(''), body: z.string().trim().min(1).max(8000) }).strict().parse(await body(req))
          const id = await store.tenant(s.tenant, async (c) => {
            const queued = await queueMessage(c, s.tenant, input)
            await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'notification_queued', entity: 'notification', detail: input.channel })
            return queued
          })
          return send(res, 201, { id, provider: 'local-log', signature: signDelivery(id) })
        }
      }
      const deliverRoute = path.match(/^\/api\/v1\/notifications\/outbox\/([0-9a-f-]+)\/deliver$/i)
      if (deliverRoute) {
        if (!['owner', 'operations_manager'].includes(s.user.role)) fail(403, 'Only operations can run the delivery worker.')
        const id = z.uuid().parse(deliverRoute[1])
        const row = await store.tenant(s.tenant, async (c) => {
          const existing = (await c.query('SELECT * FROM message_outbox WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [s.tenant, id])).rows[0]
          if (!existing) fail(404, 'Queued message not found.')
          const updated = (await c.query("UPDATE message_outbox SET status='sent',attempts=attempts+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [s.tenant, id])).rows[0]
          await store.append(c, s.tenant, { id: randomUUID(), date: new Date().toISOString(), actor: s.user.email, action: 'notification_delivered', entity: id, detail: existing.channel })
          return updated
        })
        return send(res, 200, { id: row.id, status: row.status })
      }

      const adminTenantRoute = new RegExp('^/api/v1/admin/tenants(?:/([0-9a-f-]+)/plan)?$','i').exec(path)
      if(adminTenantRoute) {
        if(s.user.role!=='super_admin')fail(403,'Platform administrator privileges required.')
        if(req.method==='GET'&&!adminTenantRoute[1]) {
          const query=new URL(req.url||'/','http://localhost').searchParams
          const offset=z.coerce.number().int().min(0).max(1000000).parse(query.get('offset')||0)
          const ids=await store.tenant(s.tenant,async c=>{
            await ensureCurrent(c,s)
            return (await c.query('SELECT DISTINCT tenant_id FROM users ORDER BY tenant_id LIMIT 100 OFFSET $1',[offset])).rows
          })
          const tenants=[]
          for(const row of ids) {
            const metadata=await store.tenant(row.tenant_id,async c=>(await c.query("SELECT id,state->>'organisation' AS name,state->>'currency' AS currency,plan_id,(SELECT count(*)::int FROM users WHERE tenant_id=tenants.id AND active=true) AS seats FROM tenants WHERE id=$1",[row.tenant_id])).rows[0])
            if(metadata)tenants.push(metadata)
          }
          await store.tenant(s.tenant,async c=>{await store.append(c,s.tenant,{id:randomUUID(),date:new Date().toISOString(),actor:s.user.email,action:'tenant_directory_viewed',entity:'platform',detail:JSON.stringify({offset,count:tenants.length})})})
          return send(res,200,{tenants,nextOffset:ids.length===100?offset+100:null})
        }
        if(req.method==='PATCH'&&adminTenantRoute[1]) {
          const tenantId=z.uuid().parse(adminTenantRoute[1])
          const input=z.object({planId:z.enum(['starter','business','business_pro','enterprise']),expectedPlanId:text}).strict().parse(await body(req))
          await store.tenant(tenantId,async c=>{
            await ensureCurrent(c,s)
            const current=(await c.query('SELECT plan_id FROM tenants WHERE id=$1 FOR UPDATE',[tenantId])).rows[0]
            if(!current)fail(404,'Tenant not found.')
            if(current.plan_id!==input.expectedPlanId)fail(409,'Plan changed. Refresh the tenant directory.')
            const plan=(await c.query('SELECT seat_limit FROM subscription_plans WHERE id=$1',[input.planId])).rows[0]
            const seats=Number((await c.query('SELECT count(*)::int AS count FROM users WHERE tenant_id=$1 AND active=true',[tenantId])).rows[0].count)
            if(seats>plan.seat_limit)fail(409,'Disable excess seats before assigning this plan.')
            await c.query('UPDATE tenants SET plan_id=$1,version=version+1 WHERE id=$2',[input.planId,tenantId])
            await store.append(c,tenantId,{id:randomUUID(),date:new Date().toISOString(),actor:s.user.email,action:'tenant_plan_assigned',entity:tenantId,detail:JSON.stringify({from:current.plan_id,to:input.planId})})
          })
          return send(res,200,{ok:true})
        }
        fail(405,'Method not supported.')
      }
      if (path === '/api/v1/admin/overview') {
        if (s.user.role !== 'super_admin')
          fail(403, 'Admin privileges required.')
        return send(
          res,
          200,
          await store.tenant(s.tenant, async (c) => {
            const tenantsCount = Number(
              (await c.query('SELECT count(*)::int as count FROM tenants'))
                .rows[0]?.count || 1,
            )
            const usersCount = Number(
              (
                await c.query(
                  'SELECT count(*)::int as count FROM users WHERE tenant_id=$1',
                  [s.tenant],
                )
              ).rows[0]?.count || 1,
            )
            return {
              tenantsCount,
              usersCount,
              version: '1.0.0',
              status: 'operational',
              database: 'PostgreSQL 17 (RLS active)',
              redis: 'Connected (Session & Queue store)',
              aiEngine: 'Active (Forecasting & Heuristics)',
            }
          }),
        )
      }
      if (path === '/api/v1/admin/plans') {
        if(s.user.role!=='super_admin') return fail(403,'Admin privileges required.')
        if(req.method==='GET') {
          const rows=(await store.pool.query('SELECT * FROM subscription_plans ORDER BY seat_limit')).rows
          return send(res,200,{plans:rows.map(p=>({...p,description:'Server-enforced subscription features',limits:'Up to '+p.seat_limit+' seats'}))})
        }
        if(req.method==='PATCH') {
          const b=z.object({id:z.enum(['starter','business','business_pro','enterprise']),price:text,features:z.array(z.enum(['core','operations','reports','automation','forecast'])).min(1),seatLimit:z.number().int().min(1).max(100000)}).strict().parse(await body(req))
          await store.tenant(s.tenant,async c=>{
            await c.query('UPDATE subscription_plans SET price=$1,features=$2,seat_limit=$3 WHERE id=$4',[b.price,b.features,b.seatLimit,b.id])
            await store.append(c,s.tenant,{id:randomUUID(),date:new Date().toISOString(),actor:s.user.email,action:'subscription_plan_updated',entity:'plan',detail:JSON.stringify(b)})
          })
          return send(res,200,{ok:true})
        }
      }
      if (path === '/api/v1/admin/integrations') {
        if (s.user.role !== 'super_admin')
          fail(403, 'Admin privileges required.')
        return send(res, 200, {
          integrations: [],
        })
      }
      if (path === '/api/v1/admin/ai-controls') {
        if (s.user.role !== 'super_admin')
          fail(403, 'Admin privileges required.')
        return send(res, 200, {
          settings: {
            forecastingModel: 'deterministic-rules-v1',
            confidenceThreshold: 0.85,
            dataCoverageMinimumDays: 30,
            anomalySensitivity: 'medium',
            explainabilityLevel: 'strict',
            autoApproveHighImpactThreshold: 'disabled',
          },
        })
      }
      if (req.method === 'POST' && path === '/api/v1/actions') {
        const b = z
          .object({
            version: z.number().int().nonnegative(),
            action: z
              .object({
                type: text,
                collection: text.optional(),
                data: z.record(z.string(), z.unknown()).optional(),
                id: text.optional(),
                status: text.optional(),
                period: text.optional(),
                name: text.optional(),
              })
              .strict(),
          })
          .strict()
          .parse(await body(req))
        if (!actionAllowed(s.user.role, b.action as Action))
          fail(403, 'Your role cannot perform this action.')
        const requestKey = z
            .string()
            .uuid()
            .parse(req.headers['idempotency-key']),
          fingerprint = digest(JSON.stringify(b.action))
        const result = await store.tenant(s.tenant, async (c) => {
          const current = await store.read(c, s.tenant, true)
          await ensureCurrent(c, s)
          const actor = (
            await c.query<AccountRow>(
              'SELECT id,tenant_id,name,email,role,active,session_version FROM users WHERE id=$1 AND tenant_id=$2',
              [s.user.id, s.tenant],
            )
          ).rows[0]
          if (!sessionIsCurrent(s, actor))
            fail(401, 'Session expired. Sign in again.')
          const old = (
            await c.query(
              'SELECT fingerprint FROM requests WHERE tenant_id=$1 AND request_key=$2',
              [s.tenant, requestKey],
            )
          ).rows[0]
          if (old) {
            if (old.fingerprint !== fingerprint)
              fail(409, 'Request key already used for a different action.')
            return current
          }
          if (current.version !== b.version)
            fail(
              409,
              'Workspace changed in another session. Refresh and review before saving again.',
            )
          const needed=actionFeature(b.action as {type?:string;collection?:string})
          if(needed && !entitlement.features.includes(needed)) return fail(403,'Your subscription does not include this workflow.')
          let next
          try {
            next = transition(current.state, {
              ...b.action,
              actor: actor.email,
              enforceApproverSeparation: true,
            } as Action)
          } catch (e) {
            return fail(400, e instanceof Error ? e.message : 'Invalid action.')
          }
          const allocated=(await c.query('SELECT product_id,SUM(quantity) AS quantity FROM warehouse_stock WHERE tenant_id=$1 GROUP BY product_id',[s.tenant])).rows
          for(const row of allocated) if((next.products.find(p=>p.id===row.product_id)?.qty || 0)<Number(row.quantity)) return fail(400,'Stock adjustment would reduce total stock below allocated warehouse quantities.')
          for (const m of next.stockMovements.slice(
            0,
            next.stockMovements.length - current.state.stockMovements.length,
          )) {
            m.actor = s.user.email
            await store.appendStock(c, s.tenant, m)
          }
          next.audit[0].actor = s.user.email
          await store.append(c, s.tenant, next.audit[0])
          for (const j of next.journals.slice(
            0,
            next.journals.length - current.state.journals.length,
          ))
            await store.append(c, s.tenant, j, 'journals')
          await c.query(
            'UPDATE tenants SET state=$1,version=version+1 WHERE id=$2',
            [
              { ...next, audit: [], journals: [], stockMovements: [] },
              s.tenant,
            ],
          )
          await c.query('INSERT INTO requests VALUES($1,$2,$3)', [
            s.tenant,
            requestKey,
            fingerprint,
          ])
          return { state: next, version: current.version + 1 }
        })
        return send(res, 200, {
          ...result,
          state: scopedState(result.state, s.user.role),
          user: s.user,
          csrf: s.csrf,
          entitlements: { plan: entitlement.id, features: entitlement.features, seatLimit: entitlement.seat_limit },
        } satisfies Snapshot)
      }
      fail(404, 'Endpoint not found.')
    } catch (e) {
      const status =
        e instanceof HttpError
          ? e.status
          : e instanceof z.ZodError
            ? 400
            : (e as { code?: string }).code === '23505'
              ? 409
              : 500
      if (status >= 500)
        console.error(
          JSON.stringify({
            event: 'request_error',
            requestId,
            code: (e as { code?: string }).code,
            message: e instanceof Error ? e.message : String(e),
          }),
        )
      const error =
        e instanceof HttpError
          ? e.message
          : e instanceof z.ZodError
            ? e.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; ')
            : status === 409
              ? 'This email is already registered.'
              : 'Service unavailable. Check PostgreSQL and Redis.'
      send(res, status, { error, requestId })
    } finally {
      console.log(
        JSON.stringify({
          requestId,
          method: req.method,
          path: req.url?.split('?')[0],
          status: res.statusCode,
          durationMs: Date.now() - start,
        }),
      )
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  return {
    server,
    store,
    redis,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()))
      await redis.quit()
      await store.close()
    },
  }
}
