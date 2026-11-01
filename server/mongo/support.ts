import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { database } from './database'
import { requireRole, fail } from './security'
import {
  expose,
  findRecord,
  insertRecord,
  listRecords,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'

export async function handleSupport(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  if (!ctx.path.startsWith('/support/')) return
  const { path, request, account } = ctx,
    tenant = account.tenant,
    method = request.method
  requireRole(account, [
    'owner',
    'sales_crm_user',
    'department_manager',
    'auditor',
  ])
  const d = await database()
  if (path === '/support/feedback/metrics' && method === 'GET') {
    const rows = await d.records
        .find({ tenant, kind: 'support:feedback' })
        .toArray(),
      n = rows.length
    const sum = (key: string) =>
      rows.reduce((total, row) => total + Number(row.data[key]), 0)
    const promoters = rows.filter((row) => Number(row.data.nps) >= 9).length,
      detractors = rows.filter((row) => Number(row.data.nps) <= 6).length
    return Response.json({
      metrics: {
        responses: n,
        csat: n ? sum('csat') / n : 0,
        nps: n ? sum('nps') / n : 0,
        nps_score: n ? ((promoters - detractors) * 100) / n : 0,
      },
    })
  }
  const route = path.match(/^\/support\/tickets(?:\/([^/]+)(\/feedback)?)?$/)
  if (!route) return
  const id = route[1] ? z.uuid().parse(route[1]) : undefined,
    feedback = !!route[2]
  if (method === 'GET' && !feedback)
    return Response.json({
      tickets: id
        ? [expose(await findRecord(tenant, 'support:ticket', id))]
        : await listRecords(tenant, 'support:ticket'),
    })
  requireRole(account, ['owner', 'sales_crm_user', 'department_manager'])
  if (feedback) {
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = z
      .object({
        csat: z.number().int().min(1).max(5),
        nps: z.number().int().min(0).max(10),
        comment: z.string().trim().max(2000).default(''),
      })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const ticket = await findRecord(tenant, 'support:ticket', id!, session)
        if (!['resolved', 'closed'].includes(String(ticket.data.status)))
          fail(409, 'Resolve the ticket before recording feedback.')
        if (
          await d.records.findOne(
            { tenant, kind: 'support:feedback', 'data.ticket_id': id },
            { session },
          )
        )
          fail(409, 'Feedback has already been recorded for this ticket.')
        return expose(
          await insertRecord(
            tenant,
            'support:feedback',
            { ...input, ticket_id: id },
            session,
          ),
        )
      }),
      { status: 201 },
    )
  }
  if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
    fail(405, 'Method not supported.')
  const input = id
    ? z
        .object({ status: z.enum(['open', 'pending', 'resolved', 'closed']) })
        .strict()
        .parse(await ctx.input())
    : z
        .object({
          subject: z.string().trim().min(1).max(200),
          customer: z.string().trim().min(1).max(160),
          priority: z.enum(['low', 'medium', 'high', 'urgent']),
          slaDueAt: z.iso.datetime({ offset: true }).nullable().default(null),
        })
        .strict()
        .parse(await ctx.input())
  return Response.json(
    await mutate(ctx, input, async (session) => {
      if (id && 'status' in input) {
        const row = await findRecord(tenant, 'support:ticket', id, session)
        const transitions: Record<string, string[]> = {
          open: ['pending', 'resolved'],
          pending: ['open', 'resolved'],
          resolved: ['open', 'closed'],
          closed: [],
        }
        if (!transitions[String(row.data.status)]?.includes(input.status))
          fail(409, 'Ticket transition is not allowed.')
        return expose(await updateRecord(row, input, session))
      }
      if (!('subject' in input)) fail(400, 'Invalid ticket.')
      return expose(
        await insertRecord(
          tenant,
          'support:ticket',
          {
            subject: input.subject,
            customer: input.customer,
            priority: input.priority,
            sla_due_at: input.slaDueAt,
            status: 'open',
            ticket_number: 'T-' + randomUUID().slice(0, 8).toUpperCase(),
          },
          session,
        ),
      )
    }),
    { status: id ? 200 : 201 },
  )
}
