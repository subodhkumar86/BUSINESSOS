import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { database } from './database'
import { fail, requireRole, throttle } from './security'
import {
  expose,
  findRecord,
  insertRecord,
  listRecords,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'
import { readWorkspace, saveWorkspace } from './workspace'
import { transition } from '../../src/domain'
import {
  candidateInput,
  candidateUpdate,
  canAdvanceCandidate,
} from '../recruitment'

const text = z.string().trim().min(1).max(160)
const notes = z.string().trim().max(2000).default('')
const money = z.number().finite().min(0).max(10000000000)
const version = z.number().int().positive()
const budgetInput = z
  .object({
    name: text,
    department: z.string().trim().max(160).default(''),
    periodFrom: z.iso.date(),
    periodTo: z.iso.date(),
    totalAmount: money,
  })
  .strict()
  .refine(
    (b) => b.periodFrom <= b.periodTo,
    'Period end must follow the start.',
  )
const rfqInput = z
  .object({
    supplierName: text,
    productDescription: text,
    quantity: z.number().int().min(1).max(100000000),
    requiredBy: z.iso.date().nullable().default(null),
    notes,
  })
  .strict()

export async function handleBusiness(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const { path, account, request } = ctx,
    tenant = account.tenant,
    method = request.method,
    d = await database()
  const budgetExpense = path.match(/^\/budgets\/([^/]+)\/expenses$/)
  if (budgetExpense) {
    requireRole(account, ['owner', 'finance_admin'])
    if (method !== 'POST') fail(405, 'Method not supported.')
    const id = z.uuid().parse(budgetExpense[1]),
      input = z
        .object({ version, description: text, amount: money.positive() })
        .strict()
        .parse(await ctx.input())
    return Response.json(
      await mutate(
        ctx,
        input,
        async (session) => {
          const budget = await findRecord(tenant, 'budget', id, session)
          if (budget.version !== input.version)
            fail(409, 'Budget changed. Refresh before posting an expense.')
          if (budget.data.status !== 'active')
            fail(409, 'Only active budgets can receive expenses.')
          const today = new Date().toISOString().slice(0, 10)
          if (
            String(budget.data.period_from) > today ||
            String(budget.data.period_to) < today
          )
            fail(409, 'Expense date is outside this budget period.')
          const spent =
            Math.round(
              (Number(budget.data.spent_amount) + input.amount) * 100,
            ) / 100
          if (spent > Number(budget.data.total_amount))
            fail(409, 'Expense exceeds the remaining budget.')
          const current = await readWorkspace(tenant, session)
          const next = transition(current.state, {
            type: 'create',
            collection: 'expenses',
            data: { name: input.description, amount: input.amount },
            actor: account.email,
          })
          await saveWorkspace(current, next, session)
          await insertRecord(
            tenant,
            'budget:expense',
            {
              budget_id: id,
              expense_id: next.expenses[0].id,
              amount: input.amount,
            },
            session,
          )
          return expose(
            await updateRecord(budget, { spent_amount: spent }, session),
          )
        },
        true,
      ),
      { status: 201 },
    )
  }
  if (path === '/billing/change-requests') {
    requireRole(account, ['owner', 'finance_admin'])
    if (method === 'GET')
      return Response.json({
        requests: await listRecords(tenant, 'billing:change'),
      })
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = z
      .object({
        plan: z.enum(['starter', 'business', 'business_pro', 'enterprise']),
      })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        if (!(await d.plans.findOne({ _id: input.plan }, { session })))
          fail(404, 'Plan not found.')
        const existing = await d.records.findOne(
          {
            tenant,
            kind: 'billing:change',
            'data.plan': input.plan,
            'data.status': 'requested',
          },
          { session },
        )
        return expose(
          existing ||
            (await insertRecord(
              tenant,
              'billing:change',
              {
                plan: input.plan,
                status: 'requested',
                requested_by: account.id,
              },
              session,
            )),
        )
      }),
      { status: 201 },
    )
  }
  if (
    path === '/workspace/chat' ||
    path === '/notifications' ||
    /^\/notifications\/[^/]+\/read$/.test(path)
  ) {
    const chat = path === '/workspace/chat'
    if (method === 'GET' && (chat || path === '/notifications')) {
      let rows = await listRecords(
        tenant,
        chat ? 'workspace:chat' : 'notification',
      )
      if (!chat && new URL(request.url).searchParams.get('unread') === 'true') {
        const reads = await d.records
          .find({
            tenant,
            kind: 'notification:read',
            'data.user_id': account.id,
          })
          .toArray()
        const ids = new Set(reads.map((row) => row.data.notification_id))
        rows = rows.filter((row) => !ids.has(row.id))
      }
      return Response.json({
        [chat ? 'messages' : 'notifications']: chat ? rows.reverse() : rows,
      })
    }
    if (method === 'PATCH' && path.endsWith('/read')) {
      const id = z.uuid().parse(path.split('/')[2])
      await mutate(ctx, { id }, async (session) => {
        await findRecord(tenant, 'notification', id, session)
        const filter = {
          tenant,
          kind: 'notification:read',
          'data.notification_id': id,
          'data.user_id': account.id,
        }
        if (!(await d.records.findOne(filter, { session })))
          await insertRecord(
            tenant,
            'notification:read',
            { notification_id: id, user_id: account.id },
            session,
          )
        return { ok: true }
      })
      return Response.json({ ok: true })
    }
    if (method !== 'POST' || (!chat && path !== '/notifications'))
      fail(405, 'Method not supported.')
    requireRole(
      account,
      chat
        ? [
            'owner',
            'finance_admin',
            'hr_admin',
            'operations_manager',
            'sales_crm_user',
            'department_manager',
            'employee',
          ]
        : ['owner'],
    )
    await throttle('message:' + tenant + ':' + account.id, 60)
    const body = z.string().trim().min(1).max(1000)
    const input = (
      chat
        ? z.object({ body }).strict()
        : z.object({ title: text, body }).strict()
    ).parse(await ctx.input())
    const result = await mutate(ctx, input, async (session) =>
      expose(
        await insertRecord(
          tenant,
          chat ? 'workspace:chat' : 'notification',
          {
            ...input,
            ...(chat
              ? {
                  sender_id: account.id,
                  sender_name: account.name,
                  sender_role: account.role,
                }
              : {}),
          },
          session,
        ),
      ),
    )
    return Response.json(result, { status: 201 })
  }
  const supplier = path.match(/^\/suppliers(?:\/([^/]+))?$/)
  const budget = path.match(/^\/budgets(?:\/([^/]+))?$/)
  const rfq = path.match(/^\/rfq(?:\/([^/]+))?$/)
  const candidate = path.match(/^\/hr\/candidates(?:\/([^/]+)(\/onboard)?)?$/)
  if (!supplier && !budget && !rfq && !candidate) return
  const route = (supplier || budget || rfq || candidate)!,
    id = route[1] ? z.uuid().parse(route[1]) : undefined
  const kind = supplier
    ? 'supplier'
    : budget
      ? 'budget'
      : rfq
        ? 'rfq'
        : 'candidate'
  const readers =
    supplier || rfq
      ? ['owner', 'operations_manager', 'finance_admin', 'auditor']
      : budget
        ? ['owner', 'finance_admin', 'auditor']
        : ['owner', 'hr_admin', 'auditor']
  requireRole(account, readers)
  if ((rfq || candidate) && !ctx.features.includes('operations'))
    fail(403, 'Your plan does not include this workflow.')
  if (method === 'GET' && !candidate?.[2])
    return Response.json({
      [supplier
        ? 'suppliers'
        : budget
          ? 'budgets'
          : rfq
            ? 'rfqs'
            : 'candidates']: id
        ? [expose(await findRecord(tenant, kind, id))]
        : await listRecords(tenant, kind),
    })
  requireRole(
    account,
    budget
      ? ['owner', 'finance_admin']
      : candidate
        ? ['owner', 'hr_admin']
        : ['owner', 'operations_manager'],
  )
  if (candidate?.[2]) {
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = z
      .object({ department: text, monthlyCompensation: money.positive() })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const row = await findRecord(tenant, kind, id!, session)
        if (row.data.status !== 'hired')
          fail(409, 'Only hired candidates can be onboarded.')
        if (row.data.employee_id)
          return { employeeId: row.data.employee_id, ok: true }
        const current = await readWorkspace(tenant, session)
        const next = transition(current.state, {
          type: 'create',
          collection: 'employees',
          data: {
            name: row.data.name,
            department: input.department,
            amount: input.monthlyCompensation,
          },
          actor: account.email,
        })
        const employee = next.employees[0]
        await saveWorkspace(current, next, session)
        await updateRecord(row, { employee_id: employee.id }, session)
        return { employeeId: employee.id, ok: true }
      }),
    )
  }
  if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
    fail(405, 'Method not supported.')
  const raw = await ctx.input()
  const supplierInput = z
    .object({
      name: text,
      contact: z.string().trim().max(300).default(''),
      leadDays: z.number().int().min(0).max(3650).default(7),
    })
    .strict()
  const supplierPatch = z
    .object({ status: z.enum(['active', 'review', 'inactive']) })
    .strict()
  const budgetPatch = z
    .object({ version, status: z.enum(['active', 'closed']) })
    .strict()
  const rfqPatch = z
    .object({
      version,
      status: z.enum(['quoted', 'accepted', 'rejected', 'expired']),
      quotedAmount: money.positive().optional(),
    })
    .strict()
  const input = supplier
    ? (id ? supplierPatch : supplierInput).parse(raw)
    : budget
      ? (id ? budgetPatch : budgetInput).parse(raw)
      : rfq
        ? (id ? rfqPatch : rfqInput).parse(raw)
        : (id ? candidateUpdate : candidateInput).parse(raw)
  const result = await mutate(ctx, input, async (session) => {
    if (!id) {
      let data: Record<string, unknown>
      if (supplier) {
        const b = supplierInput.parse(input)
        data = {
          name: b.name,
          contact: b.contact,
          lead_days: b.leadDays,
          status: 'active',
        }
      } else if (budget) {
        const b = budgetInput.parse(input)
        data = {
          name: b.name,
          department: b.department,
          period_from: b.periodFrom,
          period_to: b.periodTo,
          total_amount: b.totalAmount,
          spent_amount: 0,
          status: 'active',
        }
      } else if (rfq) {
        const b = rfqInput.parse(input)
        data = {
          rfq_number: 'RFQ-' + randomUUID().slice(0, 8).toUpperCase(),
          supplier_name: b.supplierName,
          product_description: b.productDescription,
          quantity: b.quantity,
          required_by: b.requiredBy,
          notes: b.notes,
          quoted_amount: null,
          status: 'sent',
        }
      } else {
        const b = candidateInput.parse(input)
        data = {
          ...b,
          email: b.email.toLowerCase(),
          status: 'applied',
          employee_id: null,
        }
      }
      return expose(await insertRecord(tenant, kind, data, session))
    }
    const row = await findRecord(tenant, kind, id, session)
    let changes: Record<string, unknown>
    if (supplier) changes = supplierPatch.parse(input)
    else {
      const b = budget
        ? budgetPatch.parse(input)
        : rfq
          ? rfqPatch.parse(input)
          : candidateUpdate.parse(input)
      if (row.version !== b.version)
        fail(409, 'Record changed. Refresh before updating.')
      if (budget && (row.data.status !== 'active' || b.status !== 'closed'))
        fail(409, 'Only active budgets can be closed.')
      if (candidate && !canAdvanceCandidate(String(row.data.status), b.status))
        fail(409, 'Advance candidates one stage at a time.')
      changes = { status: b.status }
      if (rfq) {
        const allowed: Record<string, string[]> = {
          sent: ['quoted', 'rejected', 'expired'],
          quoted: ['accepted', 'rejected', 'expired'],
        }
        if (!allowed[String(row.data.status)]?.includes(b.status))
          fail(409, 'RFQ transition is not allowed.')
        const update = rfqPatch.parse(input)
        if (update.status === 'quoted' && !update.quotedAmount)
          fail(400, 'Record a positive quoted amount before accepting a quote.')
        if (update.quotedAmount !== undefined)
          changes.quoted_amount = update.quotedAmount
      }
    }
    return expose(await updateRecord(row, changes, session))
  })
  return Response.json(result, { status: id ? 200 : 201 })
}
