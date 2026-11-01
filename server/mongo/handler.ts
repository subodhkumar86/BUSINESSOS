import { randomUUID } from 'node:crypto'
import { MongoServerError, type ClientSession } from 'mongodb'
import { z } from 'zod'
import { database, transaction, type AccountDocument } from './database'
import {
  allowedOrigins,
  authenticate,
  cookie,
  digest,
  fail,
  hashPassword,
  HttpError,
  issueSession,
  passwordMatches,
  publicUser,
  requireRole,
  throttle,
  validateOrigin,
} from './security'
import {
  appendEvent,
  initialState,
  readWorkspace,
  saveWorkspace,
  scopedState,
  snapshot,
} from './workspace'
import {
  generateBalanceSheet,
  generateCashFlowStatement,
  generateIncomeStatement,
  generatePayslips,
  metrics,
  transition,
} from '../../src/domain'
import {
  actionAllowed,
  passwordChangeSchema,
  passwordSchema,
} from '../../server/security'
import { actionFeature, requiredFeature } from '../../server/entitlements'
import {
  canReadModule,
  canWriteModule,
  moduleNames,
} from '../../server/modules'
import { userRoles, type Action } from '../../src/types'
import { handleOperations } from './operations'
import { handleWarehouse } from './warehouse'
import { handleBusiness } from './business'
import { handleSupport } from './support'
import { handleDocuments, sharedDocument } from './documents'
import { handleReports } from './reports'
import { handleOperational } from './operational'
import { handleTaxSettings } from './tax-settings'
import { handleBanking } from './banking'
import { handleAutomation } from './automation'
import { handleAutomationWorker } from './automation-worker'
import { handleUpi } from './upi'
import { handleApprovals, queueApproval } from './approvals'
import { handleControls } from './controls'
import { handleOnboarding } from './onboarding'
import { handleSupply } from './supply'
import {
  checkLoginMfa,
  handleAccountSecurity,
  publicAccountSecurity,
} from './account-security'
import { handleOutboxWorker } from './outbox'
import { handleAdmin } from './admin'
import { scoreLead } from '../lead-scoring'
import { reportingPeriod } from '../../src/reporting'

const text = z.string().trim().min(1).max(200)
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase())
const actionInput = z
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

async function body(request: Request, maximum = 32768): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    fail(415, 'Send JSON data.')
  const reader = request.body?.getReader()
  if (!reader) fail(400, 'Request body is required.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    size += result.value.byteLength
    if (size > maximum) {
      await reader.cancel()
      fail(413, 'Request is too large.')
    }
    chunks.push(result.value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return fail(400, 'Invalid JSON.')
  }
}

async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\/v1/, ''),
    method = request.method
  const json = (
    value: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) => Response.json(value, { status, headers })
  if (method === 'OPTIONS') {
    validateOrigin(request)
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type,X-CSRF-Token,Idempotency-Key',
        'Access-Control-Max-Age': '600',
      },
    })
  }
  const worker = await handleOutboxWorker(request, path)
  if (worker) return worker
  const automationWorker = await handleAutomationWorker(request, path)
  if (automationWorker) return automationWorker
  const d = await database()
  const recovery = await publicAccountSecurity(request, path, () =>
    body(request),
  )
  if (recovery) return recovery
  if (path === '/health' && method === 'GET') {
    await d.db.command({ ping: 1 })
    const schema = await d.db
      .collection<{ _id: string; version: number }>('schema')
      .findOne({ _id: 'mongodb' })
    return json(
      {
        ok: !!schema,
        database: 'MongoDB',
        sessions: 'MongoDB',
        backend: 'Next.js',
        schemaVersion: schema?.version || 0,
      },
      schema ? 200 : 503,
    )
  }
  if (['/auth/register', '/auth/login'].includes(path) && method === 'POST') {
    validateOrigin(request)
    const input = await body(request)
    const credentials = z
      .object({ email, password: z.string().min(1).max(128) })
      .passthrough()
      .parse(input)
    // Shared MongoDB counters work across processes without Redis.
    await throttle('auth:global', 300)
    await throttle('auth:' + credentials.email)
    let account: AccountDocument
    if (path === '/auth/register') {
      const b = z
        .object({
          name: text,
          organisation: text,
          email,
          password: passwordSchema,
          sample: z.boolean().default(false),
          currency: z.enum(['NGN', 'INR']).default('INR'),
        })
        .strict()
        .parse(input)
      const tenant = randomUUID(),
        id = randomUUID(),
        state = initialState(b.organisation, b.sample)
      state.currency = b.currency
      account = {
        _id: id,
        id,
        tenant,
        name: b.name,
        email: b.email,
        password: await hashPassword(b.password),
        role: 'owner',
        active: true,
        sessionVersion: 0,
      }
      await transaction(async (session) => {
        if (!(await d.plans.findOne({ _id: 'business' }, { session })))
          fail(503, 'Run npm run db:migrate before registering.')
        await d.users.insertOne(account, { session })
        await d.tenants.insertOne(
          {
            _id: tenant,
            state: { ...state, stockMovements: [] },
            version: 0,
            plan: 'business',
            createdAt: new Date(),
          },
          { session },
        )
        for (const movement of state.stockMovements)
          await d.stock.insertOne(
            {
              _id: movement.id,
              tenant,
              payload: { ...movement, actor: account.email },
            },
            { session },
          )
        await appendEvent(
          tenant,
          account.email,
          'workspace_created',
          'security',
          b.organisation,
          session,
        )
      })
    } else {
      const b = z
        .object({
          email,
          password: z.string().min(1).max(128),
          code: z
            .union([z.literal(''), z.string().regex(/^\d{6}$/)])
            .optional(),
        })
        .strict()
        .parse(input)
      const found = await d.users.findOne({ email: b.email })
      const valid = await passwordMatches(
        b.password,
        found?.password ||
          `00000000000000000000000000000000:${'0'.repeat(128)}`,
      )
      if (!found || !valid || !found.active)
        fail(401, 'Email or password is incorrect.')
      account = found
      await checkLoginMfa(account, b.code)
    }
    const issued = await issueSession(account)
    return json(
      await snapshot(account, issued.session),
      path.endsWith('register') ? 201 : 200,
      { 'Set-Cookie': cookie(issued.token) },
    )
  }
  const shared = await sharedDocument(path, method)
  if (shared) return shared
  const { account, session: auth } = await authenticate(request),
    tenant = account.tenant
  const doc = await d.tenants.findOne({ _id: tenant })
  if (!doc) fail(404, 'Workspace not found.')
  const plan = await d.plans.findOne({ _id: doc.plan })
  if (!plan) fail(503, 'Database setup is pending.')
  const feature = requiredFeature('/api/v1' + path)
  if (feature && !plan.features.includes(feature))
    fail(403, 'Your subscription does not include this workflow.')
  const checkCurrent = async (session: ClientSession) => {
    if (
      !(await d.users.findOne(
        {
          _id: account._id,
          tenant,
          active: true,
          sessionVersion: auth.sessionVersion,
        },
        { session },
      ))
    )
      fail(401, 'Session expired. Sign in again.')
    const latestTenant = await d.tenants.findOne({ _id: tenant }, { session })
    if (!latestTenant) fail(404, 'Workspace not found.')
    const latestPlan = await d.plans.findOne(
      { _id: latestTenant.plan },
      { session },
    )
    if (!latestPlan) fail(503, 'Database setup is pending.')
    if (feature && !latestPlan.features.includes(feature))
      fail(403, 'Your current subscription does not include this workflow.')
    // Contend on the tenant document with security changes and workflow writes.
    await d.tenants.updateOne(
      { _id: tenant },
      { $inc: { securityRevision: 1 } },
      { session },
    )
  }
  if (path === '/workspace' && method === 'GET')
    return json(await snapshot(account, auth))
  if (path === '/auth/logout' && method === 'POST') {
    await d.sessions.deleteOne({ _id: auth._id, tenant })
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) })
  }
  if (
    ['/auth/password', '/auth/revoke-sessions'].includes(path) &&
    method === 'POST'
  ) {
    let newHash: string | undefined
    if (path === '/auth/password') {
      const b = passwordChangeSchema.parse(await body(request))
      if (!(await passwordMatches(b.currentPassword, account.password)))
        fail(403, 'Current password is incorrect.')
      newHash = await hashPassword(b.newPassword)
    }
    await transaction(async (session) => {
      await checkCurrent(session)
      await d.users.updateOne(
        { _id: account._id, tenant, sessionVersion: account.sessionVersion },
        {
          $inc: { sessionVersion: 1 },
          ...(newHash ? { $set: { password: newHash } } : {}),
        },
        { session },
      )
      await d.sessions.deleteMany({ tenant, userId: account.id }, { session })
      await appendEvent(
        tenant,
        account.email,
        'sessions_revoked',
        'security',
        path,
        session,
      )
    })
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) })
  }
  if (path === '/actions' && method === 'POST') {
    const b = actionInput.parse(await body(request)),
      action = b.action as Action
    // Non-collection actions must never borrow an allowed collection to bypass RBAC.
    if (
      !['create', 'status'].includes(action.type) &&
      action.collection !== undefined
    )
      fail(400, 'This action does not accept a collection.')
    if (['create', 'status'].includes(action.type) && !action.collection)
      fail(400, 'Choose a collection for this action.')
    if (!actionAllowed(account.role, action))
      fail(403, 'Your role cannot perform this action.')
    const needed = actionFeature(action)
    if (needed && !plan.features.includes(needed))
      fail(403, 'Your subscription does not include this workflow.')
    const key = z.uuid().parse(request.headers.get('idempotency-key')),
      fingerprint = digest(JSON.stringify(action))
    let approvalChain: string | undefined
    await transaction(async (session) => {
      const current = await readWorkspace(tenant, session)
      const old = await d.requests.findOne({ tenant, key }, { session })
      if (old) {
        if (old.fingerprint !== fingerprint)
          fail(409, 'Request key already used for a different action.')
        approvalChain =
          typeof old.response === 'string' ? old.response : undefined
        return
      }
      if (current.version !== b.version)
        fail(409, 'Workspace changed. Refresh and review before saving again.')
      if (
        !(await d.users.findOne(
          {
            _id: account._id,
            tenant,
            active: true,
            sessionVersion: auth.sessionVersion,
          },
          { session },
        ))
      )
        fail(401, 'Session expired.')
      let next
      await checkCurrent(session)
      approvalChain = await queueApproval(account, action, session)
      if (needed) {
        const latest = await d.plans.findOne({ _id: current.plan }, { session })
        if (!latest?.features.includes(needed))
          fail(403, 'Your current subscription does not include this action.')
      }
      if (approvalChain) {
        await d.requests.insertOne(
          {
            _id: randomUUID(),
            tenant,
            key,
            fingerprint,
            response: approvalChain,
          },
          { session },
        )
        await appendEvent(
          tenant,
          account.email,
          'approval_requested',
          action.id || '',
          approvalChain,
          session,
        )
        return
      }
      try {
        next = transition(current.state, {
          ...action,
          actor: account.email,
          enforceApproverSeparation: true,
        })
      } catch (error) {
        return fail(
          400,
          error instanceof Error ? error.message : 'Invalid action.',
        )
      }
      if (next.audit[0]) next.audit[0].actor = account.email
      const balances = await d.records
        .find({ tenant, kind: 'warehouse:balance' }, { session })
        .toArray()
      for (const product of next.products) {
        const allocated = balances
          .filter((row) => row.data.product_id === product.id)
          .reduce((total, row) => total + Number(row.data.quantity), 0)
        if (product.qty < allocated)
          fail(
            409,
            'Stock is allocated to warehouse locations. Dispatch from the location or transfer it before reducing unallocated stock.',
          )
      }
      await saveWorkspace(current, next, session)
      await d.requests.insertOne(
        { _id: randomUUID(), tenant, key, fingerprint },
        { session },
      )
    })
    return json({
      ...(await snapshot(account, auth)),
      ...(approvalChain
        ? {
            notice: `Approval requested through ${approvalChain}. Review pending steps in Approvals, branches and delivery.`,
          }
        : {}),
    })
  }
  if (path === '/billing/entitlements' && method === 'GET')
    return json({
      plan: plan._id,
      features: plan.features,
      seatLimit: plan.seatLimit,
      activeSeats: await d.users.countDocuments({ tenant, active: true }),
      availablePlans: (await d.plans.find().toArray()).map((p) => ({
        id: p._id,
        price: p.price,
        seatLimit: p.seatLimit,
        features: p.features,
      })),
    })
  if (path === '/audit-logs' && method === 'GET') {
    requireRole(account, ['owner', 'auditor'])
    const current = await readWorkspace(tenant)
    return json({ entries: current.state.audit.slice(0, 100) })
  }
  if (
    ['/bi/metrics', '/finance/dashboard', '/finance/statements'].includes(
      path,
    ) &&
    method === 'GET'
  ) {
    if (path.startsWith('/finance'))
      requireRole(account, ['owner', 'finance_admin', 'auditor'])
    const { state } = await readWorkspace(tenant),
      permitted = scopedState(state, account.role)
    if (path === '/finance/statements') {
      const period = reportingPeriod.parse(Object.fromEntries(url.searchParams))
      return json({
        income: generateIncomeStatement(state, period),
        balance: generateBalanceSheet(state, period),
        cashFlow: generateCashFlowStatement(state, period),
      })
    }
    return json(metrics(permitted))
  }
  if (path === '/crm/lead-scores' && method === 'GET') {
    requireRole(account, ['owner', 'sales_crm_user', 'auditor'])
    const { state } = await readWorkspace(tenant)
    const average = state.leads.length
      ? state.leads.reduce((sum, lead) => sum + lead.amount, 0) /
        state.leads.length
      : 0
    return json({
      scores: state.leads.map((lead) => ({
        id: lead.id,
        leadId: lead.id,
        name: lead.name,
        status: lead.status,
        ...scoreLead(lead, average),
      })),
    })
  }
  const payslip = path.match(/^\/payroll\/runs\/([^/]+)\/payslips$/)
  if (payslip && method === 'GET') {
    requireRole(account, ['owner', 'hr_admin', 'auditor'])
    return json({
      payslips: generatePayslips(
        (await readWorkspace(tenant)).state,
        z.uuid().parse(payslip[1]),
      ),
    })
  }
  if (path === '/ai/ask' && method === 'POST') {
    requireRole(account, [
      'owner',
      'finance_admin',
      'hr_admin',
      'operations_manager',
      'sales_crm_user',
    ])
    const b = z
      .object({ question: z.string().trim().min(3).max(500) })
      .strict()
      .parse(await body(request))
    const current = await readWorkspace(tenant),
      state = scopedState(current.state, account.role),
      m = metrics(state)
    const answer = /stock|inventory|reorder/i.test(b.question)
      ? `${m.low.length} products are below their reorder thresholds. Inventory value is ${m.stock}.`
      : /sales|pipeline|deal/i.test(b.question)
        ? `Open sales pipeline is ${m.pipeline}.`
        : `Recorded cash is ${m.cash}; receivables are ${m.receivables}; paid revenue is ${m.revenue}.`
    await transaction(async (session) => {
      await checkCurrent(session)
      await appendEvent(
        tenant,
        account.email,
        'ai_question_asked',
        'analytics',
        b.question,
        session,
      )
    })
    return json({
      answer,
      confidence: 'high for recorded calculations; no prediction',
      dataWindow: `Workspace version ${current.version}`,
      engine: 'deterministic-rules-v1',
      calculation: {
        cash: m.cash,
        receivables: m.receivables,
        inventory: m.stock,
        pipeline: m.pipeline,
      },
      sources: [
        {
          module: 'Permitted tenant workspace',
          version: current.version,
          records:
            state.invoices.length +
            state.expenses.length +
            state.products.length +
            state.leads.length,
        },
      ],
      enrichment: { status: 'disabled' },
    })
  }
  const employeeLink = path.match(/^\/users\/([^/]+)\/employee$/)
  if (employeeLink) {
    requireRole(account, ['owner'])
    if (method !== 'PATCH') fail(405, 'Method not supported.')
    const id = z.uuid().parse(employeeLink[1]),
      input = z
        .object({ employeeId: z.uuid().nullable() })
        .strict()
        .parse(await body(request))
    await transaction(async (session) => {
      await checkCurrent(session)
      const target = await d.users.findOne({ _id: id, tenant }, { session })
      if (!target) fail(404, 'User not found.')
      if (input.employeeId) {
        const state = (await readWorkspace(tenant, session)).state
        if (!state.employees.some((e) => e.id === input.employeeId))
          fail(404, 'Employee not found.')
        if (
          await d.users.findOne(
            { tenant, employeeId: input.employeeId, _id: { $ne: id } },
            { session },
          )
        )
          fail(409, 'This employee is already linked to another account.')
      }
      await d.users.updateOne(
        { _id: id, tenant },
        { $set: { employeeId: input.employeeId }, $inc: { sessionVersion: 1 } },
        { session },
      )
      await d.sessions.deleteMany({ tenant, userId: id }, { session })
      await appendEvent(
        tenant,
        account.email,
        'employee_account_linked',
        id,
        input.employeeId || 'unlinked',
        session,
      )
    })
    return json({ ok: true })
  }
  const team = path.match(/^\/(?:users|team)(?:\/([^/]+)(?:\/access)?)?$/)
  if (team) {
    requireRole(account, ['owner'])
    if (method === 'GET')
      return json({
        users: (await d.users.find({ tenant }).toArray()).map((u) => ({
          ...publicUser(u),
          active: u.active,
        })),
      })
    if (method === 'POST' && !team[1]) {
      const b = z
        .object({
          name: text,
          email,
          password: passwordSchema,
          role: z
            .enum(userRoles)
            .refine((role) => !['owner', 'super_admin'].includes(role)),
        })
        .strict()
        .parse(await body(request))
      const id = randomUUID(),
        password = await hashPassword(b.password)
      await transaction(async (session) => {
        await checkCurrent(session)
        if (
          (await d.users.countDocuments(
            { tenant, active: true },
            { session },
          )) >= plan.seatLimit
        )
          fail(409, 'Your plan has no available seats.')
        await d.users.insertOne(
          {
            _id: id,
            id,
            tenant,
            ...b,
            password,
            active: true,
            sessionVersion: 0,
          },
          { session },
        )
        await appendEvent(
          tenant,
          account.email,
          'user_created',
          id,
          b.role,
          session,
        )
      })
      return json(
        { id, name: b.name, email: b.email, role: b.role, active: true },
        201,
      )
    }
    if (method === 'PATCH' && team[1]) {
      const id = z.uuid().parse(team[1]),
        b = z
          .object({ active: z.boolean() })
          .strict()
          .parse(await body(request))
      await transaction(async (session) => {
        await checkCurrent(session)
        const target = await d.users.findOne({ _id: id, tenant }, { session })
        if (!target) fail(404, 'User not found.')
        if (target.role === 'owner' || target.id === account.id)
          fail(403, 'Owner access cannot be disabled.')
        if (
          b.active &&
          !target.active &&
          (await d.users.countDocuments(
            { tenant, active: true },
            { session },
          )) >= plan.seatLimit
        )
          fail(409, 'Your plan has no available seats.')
        await d.users.updateOne(
          { _id: id, tenant },
          { $set: { active: b.active }, $inc: { sessionVersion: 1 } },
          { session },
        )
        await d.sessions.deleteMany({ tenant, userId: id }, { session })
        await appendEvent(
          tenant,
          account.email,
          'user_access_changed',
          id,
          String(b.active),
          session,
        )
      })
      return json({ ok: true })
    }
    fail(405, 'Method not supported.')
  }
  const moduleRoute = path.match(/^\/modules\/([^/]+)(?:\/([^/]+))?$/)
  if (moduleRoute) {
    const kind = z.enum(moduleNames).parse(moduleRoute[1]),
      id = moduleRoute[2] ? z.uuid().parse(moduleRoute[2]) : undefined
    // Platform administration cannot be accessed through generic tenant records.
    if (kind === 'admin')
      fail(
        403,
        'Use the platform administration API with a platform administrator account.',
      )
    if (!canReadModule(account.role, kind))
      fail(403, 'Your role cannot view this module.')
    if (method === 'GET') {
      const rows = await d.records
        .find({ tenant, kind, ...(id ? { _id: id } : {}) })
        .sort({ updated_at: -1 })
        .limit(500)
        .toArray()
      return json({
        records: rows.map((row) => ({
          ...row.data,
          id: row._id,
          version: row.version,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })),
      })
    }
    if (!canWriteModule(account.role, kind))
      fail(403, 'Your role cannot change this module.')
    const schema = z
      .object({
        name: text,
        detail: z.string().max(2000).default(''),
        status: text,
        metadata: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
    const data = (method === 'PATCH' ? schema.partial() : schema).parse(
      await body(request),
    )
    if (method !== 'POST' && method !== 'PATCH')
      fail(405, 'Method not supported.')
    if ((method === 'POST' && id) || (method === 'PATCH' && !id))
      fail(405, 'Method not supported.')
    const recordId = id || randomUUID(),
      now = new Date().toISOString()
    const saved = await transaction(async (session) => {
      await checkCurrent(session)
      if (id) {
        const row = await d.records.findOne(
          { _id: id, tenant, kind },
          { session },
        )
        if (!row) fail(404, 'Record not found.')
        const merged = schema.parse({ ...row.data, ...data })
        await d.records.updateOne(
          { _id: id, tenant, kind, version: row.version },
          { $set: { data: merged, updated_at: now }, $inc: { version: 1 } },
          { session },
        )
      } else
        await d.records.insertOne(
          {
            _id: recordId,
            tenant,
            kind,
            data,
            version: 0,
            created_at: now,
            updated_at: now,
          },
          { session },
        )
      await appendEvent(
        tenant,
        account.email,
        'module_record_saved',
        recordId,
        kind,
        session,
      )
      return d.records.findOne({ _id: recordId, tenant, kind }, { session })
    })
    return json(
      {
        ...saved!.data,
        id: saved!._id,
        version: saved!.version,
        created_at: saved!.created_at,
        updated_at: saved!.updated_at,
      },
      id ? 200 : 201,
    )
  }
  const context = {
    request,
    path,
    account,
    input: () =>
      body(request, path.startsWith('/documents') ? 3 * 1024 * 1024 : 32768),
    checkCurrent,
    features: plan.features,
  }
  const warehouse = await handleWarehouse(context)
  if (warehouse) return warehouse
  const operation = await handleOperations(context)
  if (operation) return operation
  const business = await handleBusiness(context)
  if (business) return business
  const support = await handleSupport(context)
  if (support) return support
  const documents = await handleDocuments(context)
  if (documents) return documents
  const report = await handleReports(context)
  if (report) return report
  const operational = await handleOperational(context)
  if (operational) return operational
  const tax = await handleTaxSettings(context)
  if (tax) return tax
  const banking = await handleBanking(context)
  if (banking) return banking
  const automation = await handleAutomation(context)
  if (automation) return automation
  const upi = await handleUpi(context)
  if (upi) return upi
  const approvals = await handleApprovals(context)
  if (approvals) return approvals
  const controls = await handleControls(context)
  if (controls) return controls
  const onboarding = await handleOnboarding(context)
  if (onboarding) return onboarding
  const supply = await handleSupply(context)
  if (supply) return supply
  const admin = await handleAdmin(context)
  if (admin) return admin
  const accountSecurity = await handleAccountSecurity(context)
  if (accountSecurity) return accountSecurity
  // Unknown routes must not acknowledge a financial/provider operation as successful.
  return json(
    {
      error: 'API route not found.',
      code: 'ROUTE_NOT_FOUND',
    },
    404,
  )
}

export async function handleRequest(request: Request): Promise<Response> {
  let response: Response
  try {
    allowedOrigins()
    response = await dispatch(request)
  } catch (error) {
    if (error instanceof HttpError)
      response = Response.json(
        { error: error.message },
        { status: error.status },
      )
    else if (error instanceof z.ZodError)
      response = Response.json(
        {
          error: error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
        { status: 400 },
      )
    else if (error instanceof MongoServerError && error.code === 11000)
      response = Response.json(
        { error: 'This record already exists.' },
        { status: 409 },
      )
    else {
      console.error('BusinessOS request failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
      })
      response = Response.json(
        { error: 'Service unavailable. Check MongoDB and database setup.' },
        { status: 503 },
      )
    }
  }
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  const origin = request.headers.get('origin')
  try {
    if (origin && allowedOrigins().includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      response.headers.set('Vary', 'Origin')
    }
  } catch {
    /* Configuration errors already produce a failed request. */
  }
  return response
}
