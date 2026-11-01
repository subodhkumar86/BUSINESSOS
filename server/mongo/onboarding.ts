import { z } from 'zod'
import { database } from './database'
import { fail, requireRole } from './security'
import {
  insertRecord,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'

export async function handleOnboarding(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  if (ctx.path !== '/onboarding') return
  requireRole(ctx.account, ['owner'])
  const d = await database(),
    tenant = ctx.account.tenant
  const defaults = { completedSteps: [] as string[], dismissed: false }
  if (ctx.request.method === 'GET')
    return Response.json(
      (await d.records.findOne({ tenant, kind: 'onboarding' }))?.data ||
        defaults,
    )
  if (ctx.request.method !== 'PATCH') fail(405, 'Method not supported.')
  const input = z
    .object({
      completedStep: z
        .enum(['profile', 'employee', 'product', 'invoice', 'bank', 'team'])
        .optional(),
      dismissed: z.boolean().optional(),
    })
    .strict()
    .refine(
      (b) => b.completedStep || b.dismissed !== undefined,
      'Supply an onboarding change.',
    )
    .parse(await ctx.input())
  return Response.json(
    await mutate(ctx, input, async (session) => {
      const row = await d.records.findOne(
        { tenant, kind: 'onboarding' },
        { session },
      )
      const previous = row?.data || defaults
      const data = {
        completedSteps: [
          ...new Set([
            ...(previous.completedSteps as string[]),
            ...(input.completedStep ? [input.completedStep] : []),
          ]),
        ],
        dismissed: input.dismissed ?? previous.dismissed,
      }
      if (row) await updateRecord(row, data, session)
      else await insertRecord(tenant, 'onboarding', data, session)
      return data
    }),
  )
}
