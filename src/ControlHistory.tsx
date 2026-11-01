import { useCallback, useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

type Chain = {
  id: string
  version: number
  name: string
  scope: string
  active: boolean
  minAmount: number
  steps: { role: string }[]
}
type Branch = { id: string; name: string; code: string }
type Scenario = {
  id: string
  created_at: string
  metric: string
  value: number
  engine: string
  assumptions: string
  source_version: number
  points: { month: number; value: number }[]
}
type Backup = { id: string; label: string; created_at: string; scope: string }
const roles = [
  'owner',
  'finance_admin',
  'hr_admin',
  'operations_manager',
  'department_manager',
]
const label = (value: string) => value.replaceAll('_', ' ')

export function ControlHistory({
  remote,
  branches,
  chains,
  forecasts,
  onRefresh,
}: {
  remote: Snapshot
  branches: unknown[]
  chains: unknown[]
  forecasts: unknown[]
  onRefresh: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Chain | null>(null)
  const [backups, setBackups] = useState<Backup[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const owner = remote.user.role === 'owner'
  const money = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: remote.state.currency,
    }).format(value)
  const loadBackups = useCallback(async () => {
    if (owner)
      setBackups(
        (await request<{ backups: Backup[] }>('/admin/backups')).backups,
      )
  }, [owner])
  useEffect(() => {
    if (!owner) return
    let active = true
    void request<{ backups: Backup[] }>('/admin/backups')
      .then((result) => {
        if (active) setBackups(result.backups)
      })
      .catch((cause) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
    }
  }, [owner])
  return (
    <section aria-label="Saved workspace controls">
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3>Branch directory</h3>
      <p className="muted">
        Branches are directory labels and do not restrict access to records.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Branch</th>
              <th>Code</th>
            </tr>
          </thead>
          <tbody>
            {(branches as Branch[]).map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.code}</td>
              </tr>
            ))}
            {!branches.length && (
              <tr>
                <td colSpan={2}>No branches recorded.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h3>Configured approval chains</h3>
      <p className="muted">
        Editing a chain affects new requests. Existing requests retain their
        original steps.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Minimum</th>
              <th>Ordered steps</th>
              <th>Status</th>
              {owner && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {(chains as Chain[]).map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{label(row.scope)}</td>
                <td>{money(row.minAmount)}</td>
                <td>{row.steps.map((step) => label(step.role)).join(' → ')}</td>
                <td>{row.active ? 'Active' : 'Paused'}</td>
                {owner && (
                  <td>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setError('')
                        setNotice('')
                        setEditing({
                          ...row,
                          steps: row.steps.map((step) => ({ ...step })),
                        })
                      }}
                    >
                      Edit {row.name}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!chains.length && (
              <tr>
                <td colSpan={owner ? 6 : 5}>No approval chains configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {owner && editing && (
        <form
          className="operations-fields"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setBusy(true)
            setError('')
            setNotice('')
            try {
              await request('/approvals/chains/' + editing.id, {
                method: 'PATCH',
                headers: { 'X-CSRF-Token': remote.csrf },
                body: JSON.stringify({
                  version: editing.version,
                  active: editing.active,
                  minAmount: editing.minAmount,
                  steps: editing.steps,
                }),
              })
              setEditing(null)
              setNotice('Approval chain saved.')
              await onRefresh()
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Could not save chain.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          <fieldset disabled={busy}>
            <legend>Edit {editing.name}</legend>
            <label>
              Minimum approval amount
              <input
                type="number"
                min={0}
                max={1e12}
                step="0.01"
                required
                value={editing.minAmount}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    minAmount: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(event) =>
                  setEditing({ ...editing, active: event.target.checked })
                }
              />
              Active approval chain
            </label>
            {editing.steps.map((step, index) => (
              <label key={index}>
                Approval step {index + 1}
                <select
                  value={step.role}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      steps: editing.steps.map((value, position) =>
                        position === index
                          ? { role: event.target.value }
                          : value,
                      ),
                    })
                  }
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {label(role)}
                    </option>
                  ))}
                </select>
                {editing.steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        steps: editing.steps.filter(
                          (_, position) => index !== position,
                        ),
                      })
                    }
                  >
                    Remove step {index + 1}
                  </button>
                )}
              </label>
            ))}
            <button
              type="button"
              disabled={editing.steps.length >= 5}
              onClick={() =>
                setEditing({
                  ...editing,
                  steps: [...editing.steps, { role: 'owner' }],
                })
              }
            >
              Add chain step
            </button>
            <button>Save approval chain</button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel chain edit
            </button>
          </fieldset>
        </form>
      )}
      <h3>Scenario history</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Recorded</th>
              <th>Metric</th>
              <th>Value</th>
              <th>Source and assumptions</th>
            </tr>
          </thead>
          <tbody>
            {(forecasts as Scenario[]).map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString('en-IN')}</td>
                <td>{row.metric}</td>
                <td>{money(row.value)}</td>
                <td>
                  <details>
                    <summary>Source version {row.source_version}</summary>
                    <p>{row.engine}</p>
                    <p>{row.assumptions}</p>
                    {row.points.map((point) => (
                      <p key={point.month}>
                        Month {point.month}: {money(point.value)}
                      </p>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
            {!forecasts.length && (
              <tr>
                <td colSpan={4}>No scenarios recorded.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {owner && (
        <>
          <h3>Saved workspace backups</h3>
          <p className="muted">
            Snapshots contain business records and exclude account and connector
            secrets. Full recovery requires database-managed backups.
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await loadBackups()
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Could not load backups.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Refresh saved backups
          </button>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Scope</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{new Date(row.created_at).toLocaleString('en-IN')}</td>
                    <td>{row.scope}</td>
                    <td>
                      <a href={'/api/v1/admin/backups/' + row.id} download>
                        Download {row.label}
                      </a>
                    </td>
                  </tr>
                ))}
                {!backups.length && (
                  <tr>
                    <td colSpan={4}>No backups saved.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
