import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

import { operations } from './operations'
const label = (value: string) => value.replaceAll('_', ' ')
export function OperationsPanel({
  module,
  remote,
}: {
  module: string
  remote: Snapshot | null
}) {
  const config = operations[module]
  const editFields: [string, string, string][] =
    module === 'production'
      ? [
          ['completedQty', 'completed_qty', 'number'],
          ['defectCount', 'defect_count', 'number'],
        ]
      : module === 'campaigns'
        ? [
            ['spend', 'spend', 'number'],
            ['leadsCount', 'leads_count', 'number'],
            ['revenueGenerated', 'revenue_generated', 'number'],
          ]
        : module === 'compliance'
          ? [['mitigationPlan', 'mitigation_plan', 'text']]
          : module === 'assets'
            ? [['location', 'location', 'text']]
            : []
  const [rows, setRows] = useState<Record<string, string | number | null>[]>([])
  const [busy, setBusy] = useState(Boolean(remote)),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const editable = remote && remote.user.role !== 'auditor'
  useEffect(() => {
    let active = true
    if (remote) {
      request<Record<string, typeof rows>>(config.path)
        .then((data) => {
          if (active) setRows(data[config.key])
        })
        .catch((e) => {
          if (active) setError(e.message)
        })
        .finally(() => {
          if (active) setBusy(false)
        })
    }
    return () => {
      active = false
    }
  }, [config, remote])
  async function save(data: Record<string, unknown>, id?: string) {
    if (!remote) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await request(config.path + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify(data),
      })
      const result = await request<Record<string, typeof rows>>(config.path)
      setRows(result[config.key])
      setNotice('Changes saved successfully.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel operations-panel">
      <h2>{config.title}</h2>
      {!remote && <p className="notice">Sign in to manage tenant records.</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {editable && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            void save(
              Object.fromEntries(
                config.fields.map(([name, , type]) => [
                  name,
                  type === 'number' ? Number(form.get(name)) : form.get(name),
                ]),
              ),
            )
          }}
        >
          <fieldset disabled={busy} className="operations-fields">
            <legend>Add {config.title.toLowerCase()}</legend>
            {config.fields.map(([name, title, type]) => (
              <label key={name}>
                {title}
                {Array.isArray(type) ? (
                  <select name={name}>
                    {type.map((option) => (
                      <option key={option} value={option}>
                        {label(option)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={name}
                    type={type}
                    min="0"
                    step={type === 'number' ? 'any' : undefined}
                    required
                  />
                )}
              </label>
            ))}
            <button className="primary">Create record</button>
          </fieldset>
        </form>
      )}
      <label>
        Search records{' '}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {busy && <p role="status">Loading data…</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {config.columns.map((column) => (
                <th key={column}>{label(column)}</th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) =>
                Object.values(row)
                  .join(' ')
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((row) => (
                <tr key={row.id}>
                  {config.columns.map((column) => (
                    <td key={column}>{row[column] ?? '—'}</td>
                  ))}
                  <td>
                    <select
                      aria-label={`Status for ${row.name || row.title || row.id}`}
                      value={String(row.status)}
                      disabled={!editable || busy}
                      onChange={(e) =>
                        void save({ status: e.target.value }, String(row.id))
                      }
                    >
                      {config.statuses.map((status) => (
                        <option key={status} value={status}>
                          {label(status)}
                        </option>
                      ))}
                    </select>
                    {editable && editFields.length > 0 && (
                      <details>
                        <summary>Edit record</summary>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault()
                            const form = new FormData(event.currentTarget)
                            void save(
                              {
                                ...Object.fromEntries(
                                  editFields.map(([name, , type]) => [
                                    name,
                                    type === 'number'
                                      ? Number(form.get(name))
                                      : form.get(name),
                                  ]),
                                ),
                                status: row.status,
                              },
                              String(row.id),
                            )
                          }}
                        >
                          {editFields.map(([name, column, type]) => (
                            <label key={name}>
                              {label(column)}
                              <input
                                name={name}
                                type={type}
                                min="0"
                                step="any"
                                defaultValue={row[column] ?? ''}
                                required
                              />
                            </label>
                          ))}
                          <button disabled={busy}>Save changes</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!busy && !rows.length && (
        <p className="empty">
          No records yet. Add your first record to get started.
        </p>
      )}
    </section>
  )
}
