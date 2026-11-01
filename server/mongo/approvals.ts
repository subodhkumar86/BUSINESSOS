import type { ClientSession } from 'mongodb'
import { z } from 'zod'
import { chainInput, chainUpdate, approvalDecision } from '../approvals'
import { database, type AccountDocument } from './database'
import { fail, requireRole } from './security'
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
import type { Action } from '../../src/types'

export async function queueApproval(
  account: AccountDocument,
  action: Action,
  session: ClientSession,
): Promise<string | undefined> {
  if (
    action.type !== 'status' ||
    action.status !== 'Approved' ||
    !['orders', 'payroll'].includes(action.collection || '')
  )
    return
  const scope = action.collection === 'orders' ? 'purchase_order' : 'payroll',
    tenant = account.tenant,
    d = await database()
  const current = await readWorkspace(tenant, session)
  const entity =
    action.collection === 'orders'
      ? current.state.orders.find((o) => o.id === action.id)
      : current.state.payroll.find((p) => p.id === action.id)
  if (!entity) fail(404, 'Approval source not found.')
  const amount = 'qty' in entity ? entity.qty * entity.cost : entity.amount
  const chain = await d.records
    .find(
      {
        tenant,
        kind: 'approval:chain',
        'data.active': true,
        'data.scope': scope,
        'data.minAmount': { $lte: amount },
      },
      { session },
    )
    .sort({ 'data.minAmount': -1, _id: 1 })
    .limit(1)
    .next()
  if (!chain) return
  if (['Approved', 'Received'].includes(entity.status))
    fail(409, 'This record has already been approved.')
  let request = await d.records.findOne(
    {
      tenant,
      kind: 'approval:request',
      'data.entity_id': entity.id,
      'data.status': 'pending',
    },
    { session },
  )
  if (!request)
    request = await insertRecord(
      tenant,
      'approval:request',
      {
        entity_id: entity.id,
        entity_type: action.collection,
        chain_id: chain._id,
        chain_name: chain.data.name,
        scope,
        steps: chain.data.steps,
        step_index: 0,
        status: 'pending',
        requested_by: account.id,
        action: {
          type: 'status',
          collection: action.collection,
          id: entity.id,
          status: 'Approved',
        },
        decisions: [],
      },
      session,
    )
  return String(request.data.chain_name)
}

export async function handleApprovals(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const { path, request, account } = ctx,
    tenant = account.tenant,
    method = request.method
  if (path === '/branches') {
    requireRole(account, [
      'owner',
      'operations_manager',
      'finance_admin',
      'hr_admin',
      'department_manager',
      'auditor',
    ])
    if (method === 'GET')
      return Response.json({ branches: await listRecords(tenant, 'branch') })
    requireRole(account, ['owner'])
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = z
      .object({
        name: z.string().trim().min(1).max(160),
        code: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .transform((v) => v.toUpperCase()),
      })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        if (
          await (
            await database()
          ).records.findOne(
            { tenant, kind: 'branch', 'data.code': input.code },
            { session },
          )
        )
          fail(409, 'Branch code already exists.')
        return expose(await insertRecord(tenant, 'branch', input, session))
      }),
      { status: 201 },
    )
  }
  const chain = path.match(/^\/approvals\/chains(?:\/([^/]+))?$/),
    approvals = path.match(/^\/approvals\/requests(?:\/([^/]+))?$/)
  if (!chain && !approvals) return
  requireRole(account, [
    'owner',
    'operations_manager',
    'finance_admin',
    'hr_admin',
    'department_manager',
    'auditor',
  ])
  const route = (chain || approvals)!,
    id = route[1] ? z.uuid().parse(route[1]) : undefined,
    kind = chain ? 'approval:chain' : 'approval:request'
  if (method === 'GET')
    return Response.json({
      [chain ? 'chains' : 'requests']: id
        ? [expose(await findRecord(tenant, kind, id))]
        : await listRecords(tenant, kind),
    })
  if (chain) {
    requireRole(account, ['owner'])
    if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
      fail(405, 'Method not supported.')
    const input = id
      ? chainUpdate.parse(await ctx.input())
      : chainInput.parse(await ctx.input())
    if (
      'scope' in input &&
      !['purchase_order', 'payroll'].includes(input.scope)
    )
      fail(
        400,
        'Approval chains currently support purchase orders and payroll accruals.',
      )
    if (
      input.steps?.some(
        (step) =>
          ![
            'owner',
            'finance_admin',
            'hr_admin',
            'operations_manager',
            'department_manager',
          ].includes(step.role),
      )
    )
      fail(400, 'Choose a supported approver role.')
    return Response.json(
      await mutate(ctx, input, async (session) => {
        if (!id) return expose(await insertRecord(tenant, kind, input, session))
        const row = await findRecord(tenant, kind, id, session)
        if (!('version' in input) || input.version !== row.version)
          fail(409, 'Chain changed. Refresh before editing.')
        const { version: _version, ...data } = input
        return expose(await updateRecord(row, data, session))
      }),
      { status: id ? 200 : 201 },
    )
  }
  requireRole(account, [
    'owner',
    'operations_manager',
    'finance_admin',
    'hr_admin',
    'department_manager',
  ])
  if (method !== 'POST' || !id)
    fail(
      405,
      'Approval requests are created when an action needs an active chain.',
    )
  const input = approvalDecision.parse(await ctx.input())
  return Response.json(
    await mutate(ctx, input, async (session) => {
      const row = await findRecord(tenant, kind, id, session)
      if (row.version !== input.version || row.data.status !== 'pending')
        fail(409, 'Approval changed. Refresh before deciding.')
      if (row.data.requested_by === account.id)
        fail(403, 'You cannot approve your own request.')
      const steps = row.data.steps as { role: string }[],
        index = Number(row.data.step_index)
      if (steps[index]?.role !== account.role)
        fail(403, 'The current step requires ' + steps[index]?.role + '.')
      const decisions = row.data.decisions as {
        actor: string
        decision: string
        at: string
        comment: string
      }[]
      if (decisions.some((decision) => decision.actor === account.id))
        fail(403, 'Each approval step requires a different person.')
      const final = input.decision === 'approve' && index === steps.length - 1
      if (final) {
        const current = await readWorkspace(tenant, session)
        let next
        try {
          next = transition(current.state, {
            ...(row.data.action as Action),
            actor: account.email,
            enforceApproverSeparation: true,
          })
        } catch (error) {
          fail(
            409,
            error instanceof Error
              ? error.message
              : 'Source record cannot be approved.',
          )
        }
        await saveWorkspace(current, next, session)
      }
      return expose(
        await updateRecord(
          row,
          {
            step_index: input.decision === 'approve' ? index + 1 : index,
            status:
              input.decision === 'reject'
                ? 'rejected'
                : final
                  ? 'approved'
                  : 'pending',
            decisions: [
              ...decisions,
              {
                actor: account.id,
                decision: input.decision,
                at: new Date().toISOString(),
                comment: input.comment,
              },
            ],
          },
          session,
        ),
      )
    }),
  )
}
