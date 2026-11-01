import { useEffect, useRef, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

type Run = {
  id: string
  created_at: string
  matched: number
  created: number
  skipped: number
  deferred: number
  mode: 'manual_run' | 'scheduled_run'
}
type Settings = {
  enabled: boolean
  version: number
  schedule: 'off' | 'hourly' | 'daily'
  nextRunAt: string | null
  scheduleStatus: string
  blockedReason: string
}
export function StockReviewAutomation({
  remote,
  onRefresh,
}: {
  remote: Snapshot
  onRefresh: () => Promise<void>
}) {
  const [enabled, setEnabled] = useState(false),
    [version, setVersion] = useState(0),
    [loaded, setLoaded] = useState(false)
  const [runs, setRuns] = useState<Run[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const retryKey = useRef<string | null>(null)
  const [schedule, setSchedule] = useState<Settings['schedule']>('off'),
    [nextRunAt, setNextRunAt] = useState<string | null>(null),
    [blockedReason, setBlockedReason] = useState('')
  function applySettings(result: Settings) {
    setEnabled(result.enabled)
    setVersion(result.version)
    setSchedule(result.schedule)
    setNextRunAt(result.nextRunAt)
    setBlockedReason(result.blockedReason)
    setLoaded(true)
  }
  const editable = ['owner', 'operations_manager'].includes(remote.user.role)
  useEffect(() => {
    let active = true
    request<Settings & { runs: Run[] }>('/automation/stock-review')
      .then((result) => {
        if (active) {
          applySettings(result)
          setRuns(result.runs)
          setLoaded(true)
        }
      })
      .catch((error) => {
        if (active) setMessage(error.message)
      })
    return () => {
      active = false
    }
  }, [remote.csrf])
  return (
    <section className="card">
      <h2>Low-stock task automation</h2>
      <p>
        Run now checks current quantities below reorder levels and creates
        inventory review tasks. An existing open review task is reused. Each run
        creates up to 50 tasks; run again for deferred items. Completing a task
        allows a new review if the item is still low. This does not place orders
        or send messages.
      </p>
      <p>
        Status: {loaded ? (enabled ? 'Enabled' : 'Paused') : 'Loading'}.
        {nextRunAt
          ? ` Next scheduled eligibility: ${new Date(nextRunAt).toLocaleString('en-IN')}. A configured worker must invoke the schedule.`
          : ' No background run is scheduled.'}
      </p>
      {blockedReason && (
        <p role="alert">
          Schedule blocked: {blockedReason} Review access and save the schedule
          again to resume.
        </p>
      )}
      {editable && (
        <>
          <button
            disabled={busy || !loaded}
            onClick={async () => {
              setBusy(true)
              setMessage('')
              try {
                const result = await request<Settings>(
                  '/automation/stock-review',
                  {
                    method: 'PUT',
                    headers: { 'X-CSRF-Token': remote.csrf },
                    body: JSON.stringify({
                      enabled: !enabled,
                      version,
                      schedule,
                    }),
                  },
                )
                applySettings(result)
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Could not update automation.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            {enabled ? 'Pause stock automation' : 'Enable stock automation'}
          </button>
          <button
            disabled={busy || !loaded || !enabled}
            onClick={async () => {
              setBusy(true)
              setMessage('')
              retryKey.current ??= crypto.randomUUID()
              try {
                const result = await request<{ run: Run }>(
                  '/automation/stock-review/run',
                  {
                    method: 'POST',
                    headers: {
                      'X-CSRF-Token': remote.csrf,
                      'Idempotency-Key': retryKey.current,
                    },
                    body: '{}',
                  },
                )
                setRuns((items) =>
                  [
                    result.run,
                    ...items.filter((item) => item.id !== result.run.id),
                  ].slice(0, 50),
                )
                retryKey.current = null
                setMessage(
                  `Created ${result.run.created} review tasks; ${result.run.skipped} already open; ${result.run.deferred} deferred.`,
                )
                try {
                  await onRefresh()
                } catch {
                  setMessage(
                    'Run saved. Refresh the workspace to see the new tasks.',
                  )
                }
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Could not run stock automation.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Run stock review now
          </button>
        </>
      )}
      {editable && (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setMessage('')
            try {
              const result = await request<Settings>(
                '/automation/stock-review',
                {
                  method: 'PUT',
                  headers: { 'X-CSRF-Token': remote.csrf },
                  body: JSON.stringify({ enabled, version, schedule }),
                },
              )
              applySettings(result)
              setMessage(
                schedule === 'off'
                  ? 'Background schedule disabled.'
                  : 'Schedule saved. Configure the protected worker in your deployment scheduler to execute it.',
              )
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : 'Could not save schedule.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            Stock review schedule
            <select
              aria-label="Stock review schedule"
              value={schedule}
              disabled={busy || !loaded || !enabled}
              onChange={(event) =>
                setSchedule(event.target.value as Settings['schedule'])
              }
            >
              <option value="off">Manual only</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          <button disabled={busy || !loaded || !enabled}>
            Save stock schedule
          </button>
        </form>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setMessage('')
          try {
            const result = await request<Settings & { runs: Run[] }>(
              '/automation/stock-review',
            )
            applySettings(result)
            setRuns(result.runs)
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : 'Could not refresh automation.',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        Refresh automation
      </button>
      {message && <p role="status">{message}</p>}
      {runs.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Run time</th>
                <th>Mode</th>
                <th>Low-stock items</th>
                <th>Tasks created</th>
                <th>Already open</th>
                <th>Deferred</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.created_at).toLocaleString('en-IN')}</td>
                  <td>
                    {run.mode === 'scheduled_run' ? 'Scheduled' : 'Manual'}
                  </td>
                  <td>{run.matched}</td>
                  <td>{run.created}</td>
                  <td>{run.skipped}</td>
                  <td>{run.deferred}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
