import { database, transaction } from './database'
import { updateRecord } from './records'
import { appendEvent } from './workspace'
import { fail } from './security'
import { requireWorker } from './worker-security'
import { runStockReview } from './stock-review'
import { nextStockRun, type StockSchedule } from '../automation-schedule'

export async function runScheduledStockReviews() {
  const d = await database(),
    started = Date.now(),
    now = new Date(started).toISOString()
  const candidates = await d.records
    .find({
      kind: 'automation:stock_settings',
      'data.enabled': true,
      'data.schedule': { $in: ['hourly', 'daily'] },
      'data.next_run_at': { $type: 'string', $lte: now },
    })
    .sort({ 'data.next_run_at': 1, _id: 1 })
    .limit(3)
    .toArray()
  const results: string[] = []
  for (const candidate of candidates) {
    if (Date.now() - started >= 25000) break
    try {
      results.push(
        await transaction(async (session) => {
          const locked = await d.tenants.updateOne(
            { _id: candidate.tenant },
            { $inc: { securityRevision: 1 } },
            { session },
          )
          if (!locked.matchedCount) return 'deferred'
          const settings = await d.records.findOne(
            {
              _id: candidate._id,
              tenant: candidate.tenant,
              kind: 'automation:stock_settings',
            },
            { session },
          )
          if (
            !settings ||
            settings.data.enabled !== true ||
            !['hourly', 'daily'].includes(String(settings.data.schedule)) ||
            typeof settings.data.next_run_at !== 'string' ||
            settings.data.next_run_at > now
          )
            return 'deferred'
          const tenant = await d.tenants.findOne(
            { _id: candidate.tenant },
            { session },
          )
          const plan = await d.plans.findOne({ _id: tenant!.plan }, { session })
          const user = await d.users.findOne(
            {
              _id: String(settings.data.scheduled_by_id),
              tenant: candidate.tenant,
              active: true,
              role: { $in: ['owner', 'operations_manager'] },
            },
            { session },
          )
          if (
            !user ||
            !plan?.features.includes('automation') ||
            !plan.features.includes('operations')
          ) {
            const reason = !user
              ? 'The scheduling account is inactive or no longer authorised.'
              : 'The current plan no longer includes automation and operations.'
            await updateRecord(
              settings,
              {
                schedule_status: 'blocked',
                blocked_reason: reason,
                next_run_at: null,
              },
              session,
            )
            await appendEvent(
              candidate.tenant,
              'Automation worker',
              'automation_schedule_blocked',
              settings._id,
              reason,
              session,
            )
            return 'blocked'
          }
          const run = await runStockReview(
            candidate.tenant,
            user.email,
            session,
            'scheduled_run',
            10,
          )
          await updateRecord(
            settings,
            {
              last_run_at: new Date().toISOString(),
              next_run_at: nextStockRun(
                settings.data.schedule as StockSchedule,
                Date.now(),
                run.deferred > 0,
              ),
              schedule_status: 'waiting',
              blocked_reason: '',
            },
            session,
          )
          await appendEvent(
            candidate.tenant,
            'Automation worker',
            'automation_scheduled_run',
            run.id,
            'Scheduled low-stock review committed',
            session,
          )
          return 'completed'
        }),
      )
    } catch {
      results.push('failed')
    }
  }
  return {
    processed: results.length,
    completed: results.filter((result) => result === 'completed').length,
    blocked: results.filter((result) => result === 'blocked').length,
    failed: results.filter((result) => result === 'failed').length,
    deferred:
      candidates.length -
      results.length +
      results.filter((result) => result === 'deferred').length,
  }
}

export async function handleAutomationWorker(
  request: Request,
  path: string,
): Promise<Response | undefined> {
  if (path !== '/internal/automation/run') return
  requireWorker(request)
  if (!['GET', 'POST'].includes(request.method))
    fail(405, 'Method not allowed.')
  return Response.json(await runScheduledStockReviews())
}
