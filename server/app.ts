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
import { metrics, seed, transition } from '../src/domain.ts'
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
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    fail(415, 'Send JSON data.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 32768) fail(413, 'Request too large.')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    return fail(400, 'Invalid JSON.')
  }
}
export async function createApp(config: {
  databaseUrl: string
  redisUrl: string
  origins: string[]
  secure?: boolean
  prefix?: string
  staticDir?: string
}) {
  const store = new Store(config.databaseUrl),
    redis = createClient({
      url: config.redisUrl,
      socket: { connectTimeout: 5000, reconnectStrategy: false },
    }),
    prefix = config.prefix || 'bos:'
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
      return {
        ...snapshot,
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
      `bos_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800${config.secure ? '; Secure' : ''}`,
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
      if (mutation && !config.origins.includes(req.headers.origin || ''))
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
        if (token && process.env.RETURN_RESET_TOKEN === 'true')
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
      const { key, session: s } = await auth(req)
      if (mutation && req.headers['x-csrf-token'] !== s.csrf)
        fail(403, 'Session verification failed. Reload and try again.')
      if (req.method === 'GET' && path === '/api/v1/workspace')
        return send(res, 200, await snap(s))
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
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'ai_forecast_generated',
            entity: 'decision_intelligence',
            detail: input.metric,
          })
          return {
            metric: input.metric,
            horizonDays: input.metric === 'pipeline' ? 45 : 30,
            ...values,
            confidence: 'limited',
            dataWindow: 'Current tenant workspace snapshot',
            engine: 'deterministic-rules-v1',
          }
        })
        return send(res, 200, result)
      }
      if (req.method === 'POST' && path === '/api/v1/auth/logout') {
        await redis.del(key)
        res.setHeader(
          'Set-Cookie',
          `bos_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${config.secure ? '; Secure' : ''}`,
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
          'bos_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0' +
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
                role: z.enum(userRoles.filter((role) => role !== 'owner')),
              })
              .strict()
              .parse(await body(req)),
            h = await hash(b.password)
          await store.tenant(s.tenant, async (c) => {
            await store.read(c, s.tenant, true)
            await ensureCurrent(c, s)
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
      if (path === '/api/v1/banks/accounts') {
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
      if (req.method === 'GET' && path === '/api/v1/finance/export.csv') {
        if (!['owner', 'finance_admin', 'auditor'].includes(s.user.role))
          fail(403, 'Your role cannot export financial reports.')
        const csv = await store.tenant(s.tenant, async (c) => {
          const { state } = await store.read(c, s.tenant)
          const cell = (value: unknown) => {
            const text = String(value ?? '')
            const safe = /^[=+\-@]/.test(text) ? "'" + text : text
            return '"' + safe.replaceAll('"', '""') + '"'
          }
          const rows: unknown[][] = [
            [
              'section',
              'date',
              'description',
              'debit_account',
              'credit_account',
              'amount',
              'status',
            ],
            [
              'summary',
              '',
              'Cash position',
              '',
              '',
              state.openingCash +
                state.invoices
                  .filter((invoice) => invoice.status === 'Paid')
                  .reduce((sum, invoice) => sum + invoice.amount, 0) -
                state.expenses.reduce(
                  (sum, expense) => sum + expense.amount,
                  0,
                ),
              'calculated',
            ],
            [
              'summary',
              '',
              'Open receivables',
              '',
              '',
              state.invoices
                .filter((invoice) => invoice.status === 'Unpaid')
                .reduce((sum, invoice) => sum + invoice.amount, 0),
              'calculated',
            ],
            [
              'summary',
              '',
              'Recorded expenses',
              '',
              '',
              state.expenses.reduce((sum, expense) => sum + expense.amount, 0),
              'calculated',
            ],
            ...state.journals.map((journal) => [
              'journal',
              journal.date,
              journal.source,
              journal.debit,
              journal.credit,
              journal.amount,
              'posted',
            ]),
          ]
          await store.append(c, s.tenant, {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: s.user.email,
            action: 'finance_report_exported',
            entity: 'finance_report',
            detail: 'CSV export',
          })
          return (
            rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
          )
        })
        return sendCsv(res, 'businessos-finance-report.csv', csv)
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
                  payroll.amount,
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
            const candidates =
              b.direction === 'credit'
                ? state.invoices
                    .filter(
                      (invoice) =>
                        invoice.status === 'Unpaid' &&
                        invoice.amount === Math.abs(b.amount),
                    )
                    .map((invoice) => ({ type: 'invoice', id: invoice.id }))
                : state.expenses
                    .filter((expense) => expense.amount === Math.abs(b.amount))
                    .map((expense) => ({ type: 'expense', id: expense.id }))
            const suggestion = candidates.length === 1 ? candidates[0] : null
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
                suggestion?.type || null,
                suggestion?.id || null,
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
                (suggestion ? ` -> suggested ${suggestion.type}` : ''),
            })
            return {
              match_status: suggestion ? 'suggested' : 'unmatched',
              matched_entity_type: suggestion?.type || null,
              matched_entity_id: suggestion?.id || null,
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
            })
            .strict()
            .parse(await body(req))
          const reconciliation = await store.tenant(s.tenant, async (c) => {
            const current = (
              await c.query(
                `SELECT match_status,matched_entity_type,matched_entity_id FROM bank_transactions
               WHERE id=$1 AND bank_account_id=$2 AND tenant_id=$3 FOR UPDATE`,
                [transactionId, accountId, s.tenant],
              )
            ).rows[0]
            if (!current) fail(404, 'Bank transaction not found.')
            let invoiceSettled = false
            if (b.matchStatus === 'matched') {
              if (
                current.match_status !== 'suggested' ||
                !current.matched_entity_type ||
                !current.matched_entity_id
              )
                fail(
                  400,
                  'Only a current system suggestion can be approved as matched.',
                )
              const snapshot = await store.read(c, s.tenant, true)
              const { state } = snapshot
              const sourceExists =
                current.matched_entity_type === 'invoice'
                  ? state.invoices.some(
                      (invoice) =>
                        invoice.id === current.matched_entity_id &&
                        invoice.status === 'Unpaid',
                    )
                  : current.matched_entity_type === 'expense'
                    ? state.expenses.some(
                        (expense) => expense.id === current.matched_entity_id,
                      )
                    : false
              if (!sourceExists)
                fail(
                  409,
                  'The suggested source is no longer available for reconciliation.',
                )
              if (current.matched_entity_type === 'invoice') {
                const next = transition(state, {
                  type: 'status',
                  collection: 'invoices',
                  id: current.matched_entity_id,
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
            const preserveSource =
              b.matchStatus === 'suggested' || b.matchStatus === 'matched'
            const result = await c.query(
              `UPDATE bank_transactions SET match_status=$1,
                 matched_entity_type=$2,
                 matched_entity_id=$3,
                 reconciled_at=CASE WHEN $1='matched' THEN now() ELSE NULL END,
                  reconciled_by=CASE WHEN $1='matched' THEN $4::uuid ELSE NULL::uuid END
               WHERE id=$5 AND bank_account_id=$6 AND tenant_id=$7`,
              [
                b.matchStatus,
                preserveSource ? current.matched_entity_type : null,
                preserveSource ? current.matched_entity_id : null,
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
                  ? ` (${current.matched_entity_type}:${current.matched_entity_id})`
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
            })
            .strict()
            .parse(await body(req))
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
            await store.append(c, s.tenant, {
              id: randomUUID(),
              date: new Date().toISOString(),
              actor: s.user.email,
              action: 'document_registered',
              entity: 'document',
              detail: b.filename,
            })
          })
          return send(res, 201, {
            id,
            ...b,
            storageKey,
            version: 1,
            status: 'active',
          })
        }
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
        if (s.user.role !== 'super_admin')
          fail(403, 'Admin privileges required.')
        return send(res, 200, {
          plans: [
            {
              id: 'starter',
              name: 'Starter',
              price: 'NGN 45,000 / mo',
              description:
                'Core finance, CRM, inventory, documents and standard dashboards for early stage operations.',
              features: [
                'Core Finance & Invoices',
                'CRM & Leads',
                'Inventory & Stock Alerts',
                'Document Vault',
                'Dashboard Analytics',
              ],
              limits: 'Up to 5 team seats, 1,000 inventory items',
            },
            {
              id: 'business',
              name: 'Business',
              price: 'NGN 120,000 / mo',
              description:
                'For growing companies needing HR & payroll, procurement, projects, and warehouse management.',
              features: [
                'Everything in Starter',
                'HR & Gross Payroll',
                'Procurement & PO Workflows',
                'Projects & Milestones',
                'Warehouse & Fulfillment',
                'Advanced Financial Reports',
              ],
              limits: 'Up to 25 team seats, 10,000 inventory items',
            },
            {
              id: 'business_pro',
              name: 'Business Pro',
              price: 'NGN 280,000 / mo',
              description:
                'Multi-branch operations, automations, and AI forecasting & anomaly detection.',
              features: [
                'Everything in Business',
                'Multi-branch & Warehouses',
                'Workflow Automations',
                'AI Cash & Demand Forecasting',
                'AI Anomaly Detection',
                'Custom Permission Rules',
              ],
              limits: 'Up to 100 team seats, unlimited inventory',
            },
            {
              id: 'enterprise',
              name: 'Enterprise',
              price: 'Custom quote',
              description:
                'Complex organizations requiring SSO, custom integrations, high API limits, and dedicated SLA.',
              features: [
                'Everything in Business Pro',
                'SSO / SAML 2.0',
                'Dedicated Account Manager',
                'Custom ERP/Bank Integrations',
                '99.9% Uptime SLA',
                'Audit Compliance Package',
              ],
              limits: 'Unlimited seats, custom infrastructure',
            },
          ],
        })
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
            forecastingModel: 'Heuristic-Linear + Seasonal SARIMA v1.2',
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
