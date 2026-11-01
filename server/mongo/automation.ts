import { z } from 'zod'
import { database } from './database'
import { fail, requireRole } from './security'
import {
  expose,
  insertRecord,
  updateRecord,
  mutate,
  type WorkflowContext,
} from './records'
import { runStockReview } from './stock-review'
import { nextStockRun, type StockSchedule } from '../automation-schedule'

export async function handleAutomation(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  if (
    ctx.path !== '/automation/stock-review' &&
    ctx.path !== '/automation/stock-review/run'
  )
    return
  requireRole(ctx.account, ['owner', 'operations_manager', 'auditor'])
  const d = await database(),
    tenant = ctx.account.tenant
  if (ctx.request.method === 'GET' && !ctx.path.endsWith('/run')) {
    const settings = await d.records.findOne({
      tenant,
      kind: 'automation:stock_settings',
    })
    const runs = await d.records
      .find({ tenant, kind: 'automation:stock_run' })
      .sort({ created_at: -1, _id: -1 })
      .limit(50)
      .toArray()
    return Response.json({
      enabled: settings?.data.enabled === true,
      version: settings?.version ?? 0,
      schedule: settings?.data.schedule ?? 'off',
      nextRunAt: settings?.data.next_run_at ?? null,
      scheduleStatus: settings?.data.schedule_status ?? 'off',
      blockedReason: settings?.data.blocked_reason ?? '',
      runs: runs.map((row) => expose(row)),
    })
  }
  requireRole(ctx.account, ['owner', 'operations_manager'])
  if (!ctx.path.endsWith('/run')) {
    if (ctx.request.method !== 'PUT') fail(405, 'Method not allowed.')
    const input = z
      .object({
        enabled: z.boolean(),
        version: z.number().int().nonnegative(),
        schedule: z.enum(['off', 'hourly', 'daily']).optional(),
      })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const settings = await d.records.findOne(
          { tenant, kind: 'automation:stock_settings' },
          { session },
        )
        if ((settings?.version ?? 0) !== input.version)
          fail(409, 'Automation settings changed. Refresh before saving.')
        const schedule = (input.schedule ??
          settings?.data.schedule ??
          'off') as StockSchedule
        const data = {
          enabled: input.enabled,
          schedule,
          next_run_at: input.enabled ? nextStockRun(schedule) : null,
          schedule_status:
            input.enabled && schedule !== 'off' ? 'waiting' : 'off',
          blocked_reason: '',
          scheduled_by_id:
            input.enabled && schedule !== 'off' ? ctx.account.id : null,
        }
        const next = settings
          ? await updateRecord(settings, data, session)
          : await insertRecord(
              tenant,
              'automation:stock_settings',
              data,
              session,
            )
        return {
          enabled: input.enabled,
          version: next.version,
          schedule,
          nextRunAt: data.next_run_at,
          scheduleStatus: data.schedule_status,
          blockedReason: '',
        }
      }),
    )
  }
  if (ctx.request.method !== 'POST') fail(405, 'Method not allowed.')
  const input = z
    .object({})
    .strict()
    .parse(await ctx.input())
  return Response.json(
    await mutate(
      ctx,
      input,
      async (session) => ({
        run: await runStockReview(tenant, ctx.account.email, session),
      }),
      true,
    ),
    { status: 201 },
  )
}
