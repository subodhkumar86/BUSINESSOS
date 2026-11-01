import { useEffect, useState } from 'react'
import { request } from './api'
import { formatMoney } from './currency'
import type { Snapshot, UserRole } from './types'

import { operations } from './operations'
import {
  allowedDemoStatuses,
  demoOperationChange,
  loadDemoOperations,
  resetDemoOperations,
  storeDemoOperations,
} from './demo-operations'
const label = (value: string) => value.replaceAll('_', ' ')
export function OperationsPanel({
  module,
  remote,
  onRefresh,
  demoRole = 'owner',
}: {
  module: string
  remote: Snapshot | null
  onRefresh?: () => Promise<void>
  demoRole?: UserRole
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
  const [initialDemo] = useState(() =>
    remote ? { rows: [], error: '' } : loadDemoOperations(module),
  )
  const [rows, setRows] = useState<Record<string, string | number | null>[]>(
    initialDemo.rows,
  )
  const [busy, setBusy] = useState(Boolean(remote)),
    [error, setError] = useState(initialDemo.error),
    [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [outputProduct, setOutputProduct] = useState('')
  const [materials, setMaterials] = useState<
    { productId: string; quantity: string }[]
  >([])
  const writers =
    module === 'frontoffice'
      ? ['owner', 'sales_crm_user', 'department_manager', 'employee']
      : module === 'campaigns'
        ? ['owner', 'sales_crm_user']
        : ['owner', 'operations_manager']
  const readable = !remote || [...writers, 'auditor'].includes(remote.user.role)
  const editable = writers.includes(remote?.user.role || demoRole)
  useEffect(() => {
    let active = true
    if (remote && readable) {
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
  }, [config, remote, readable])
  async function save(data: Record<string, unknown>, id?: string) {
    if (busy || !editable) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (!remote) {
        const current = loadDemoOperations(module)
        if (current.error) throw Error(current.error)
        if (JSON.stringify(current.rows) !== JSON.stringify(rows))
          throw Error(
            'Demo records changed in another tab. Refresh demo records before saving.',
          )
        const next = demoOperationChange(module, rows, data, id)
        storeDemoOperations(module, next)
        setRows(next)
        setNotice(
          'Demo changes saved in this browser. No inventory or financial postings were made.',
        )
        return true
      }
      await request(config.path + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify(data),
      })
      const result = await request<Record<string, typeof rows>>(config.path)
      setRows(result[config.key])
      if (module === 'production') await onRefresh?.()
      setNotice('Changes saved successfully.')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes.')
      return false
    } finally {
      setBusy(false)
    }
  }
  async function queueCampaign(id: string, form: HTMLFormElement) {
    if (!remote || busy) return
    const data = new FormData(form)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ queued: number; skipped: number }>(
        config.path + '/' + id + '/queue',
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': remote.csrf },
          body: JSON.stringify({
            subject: data.get('subject'),
            body: data.get('body'),
          }),
        },
      )
      setNotice(
        `${result.queued} opted-in contact${result.queued === 1 ? '' : 's'} queued${result.skipped ? `; ${result.skipped} already queued.` : '.'}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue campaign.')
    } finally {
      setBusy(false)
    }
  }
  if (!readable) return null
  return (
    <section className="panel operations-panel operations-workspace mx-auto w-full space-y-5">
      <div className="section-top operations-heading">
        <div>
          <p className="eyebrow">Operations workspace</p>
          <h2>{config.title}</h2>
          <p>
            Create records, keep their status current, and resolve operational
            work from one view.
          </p>
        </div>
        <span className="operations-count">
          <b>{rows.length}</b> records
        </span>
      </div>
      {!remote && (
        <p className="notice rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Interactive demo · Changes stay in this browser. Production is
          tracking-only; messages, inventory and financial postings require a
          signed-in workspace.
        </p>
      )}
      {!remote && (
        <div className="operations-fields">
          <button
            disabled={busy}
            onClick={() => {
              const loaded = loadDemoOperations(module)
              setRows(loaded.rows)
              setError(loaded.error)
              setNotice(loaded.error ? '' : 'Demo records refreshed.')
            }}
          >
            Refresh demo records
          </button>
          {editable && (
            <button
              disabled={busy}
              onClick={() => {
                try {
                  setRows(resetDemoOperations(module))
                  setError('')
                  setNotice(
                    'This demo section has been reset to sample records.',
                  )
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not reset demo records.',
                  )
                }
              }}
            >
              Reset this demo section
            </button>
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
        >
          {notice}
        </p>
      )}
      {editable && (
        <form
          className="inline-form operations-create"
          onSubmit={(event) => {
            event.preventDefault()
            const createForm = event.currentTarget
            const form = new FormData(createForm)
            if (module === 'production' && outputProduct && !materials.length) {
              setError('Add at least one material for inventory production.')
              return
            }
            void save(
              Object.fromEntries(
                config.fields.map(([name, , type]) => [
                  name,
                  type === 'number'
                    ? Number(form.get(name))
                    : name === 'materials'
                      ? materials.map((row) => ({
                          productId: row.productId,
                          quantity: Number(row.quantity),
                        }))
                      : form.get(name),
                ]),
              ),
            ).then((saved) => {
              if (saved) {
                createForm.reset()
                setOutputProduct('')
                setMaterials([])
              }
            })
          }}
        >
          <fieldset disabled={busy} className="operations-fields">
            <legend>Add {config.title.toLowerCase()}</legend>
            {config.fields
              .filter(([name]) => name !== 'materials')
              .map(([name, title, type]) => (
                <label key={name}>
                  {title}
                  {name === 'outputProductId' ? (
                    <select
                      name={name}
                      aria-label={title}
                      value={outputProduct}
                      onChange={(event) => {
                        setOutputProduct(event.target.value)
                        setMaterials([])
                      }}
                    >
                      <option value="">
                        Tracking only (no inventory posting)
                      </option>
                      {remote?.state.products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} · {product.sku}
                        </option>
                      ))}
                    </select>
                  ) : Array.isArray(type) ? (
                    <select name={name} aria-label={title}>
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
                      required={name !== 'outputProductId'}
                      defaultValue={name === 'materials' ? '[]' : undefined}
                    />
                  )}
                </label>
              ))}
            {module === 'production' && (
              <fieldset disabled={busy || !outputProduct}>
                <legend>Materials consumed for the whole batch</legend>
                <p className="muted">
                  Select a finished-good product to post inventory on
                  completion. Material quantities are totals for this batch.
                </p>
                {materials.map((material, index) => (
                  <div className="operations-fields" key={index}>
                    <label>
                      Material {index + 1}
                      <select
                        required
                        value={material.productId}
                        onChange={(event) =>
                          setMaterials(
                            materials.map((row, position) =>
                              position === index
                                ? { ...row, productId: event.target.value }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="">Select a product</option>
                        {remote?.state.products
                          .filter(
                            (product) =>
                              product.id !== outputProduct &&
                              (product.id === material.productId ||
                                !materials.some(
                                  (row) => row.productId === product.id,
                                )),
                          )
                          .map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} · {product.sku}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Material quantity {index + 1}
                      <input
                        type="number"
                        min={1}
                        max={100000000}
                        step={1}
                        required
                        value={material.quantity}
                        onChange={(event) =>
                          setMaterials(
                            materials.map((row, position) =>
                              position === index
                                ? { ...row, quantity: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setMaterials(
                          materials.filter((_, position) => position !== index),
                        )
                      }
                    >
                      Remove material {index + 1}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={materials.length >= 50}
                  onClick={() =>
                    setMaterials([
                      ...materials,
                      { productId: '', quantity: '1' },
                    ])
                  }
                >
                  Add material
                </button>
              </fieldset>
            )}
            <button className="primary inline-flex items-center justify-center gap-2 shadow-sm">
              Create record
            </button>
          </fieldset>
        </form>
      )}
      <div className="operations-search">
        <label>
          Search records
          <input
            type="search"
            placeholder="Search by name, status or reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {busy && (
        <p role="status" className="empty">
          Loading operational records…
        </p>
      )}
      <div className="table-wrap overflow-hidden shadow-sm">
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
                    <td key={column}>{row[column] == null ? '—' : ['cost', 'book_value', 'budget', 'spend', 'revenue_generated'].includes(column) ? formatMoney(Number(row[column]), remote?.state.currency || 'INR') : row[column]}</td>
                  ))}
                  <td className="operations-status-cell">
                    <select
                      aria-label={`Status for ${row.name || row.title || row.id}`}
                      value={String(row.status)}
                      disabled={!editable || busy}
                      onChange={(e) =>
                        void save({ status: e.target.value }, String(row.id))
                      }
                    >
                      {config.statuses.map((status) => (
                        <option
                          key={status}
                          value={status}
                          disabled={
                            !remote &&
                            !allowedDemoStatuses(
                              module,
                              String(row.status),
                            ).includes(status)
                          }
                        >
                          {label(status)}
                        </option>
                      ))}
                    </select>
                    {editable &&
                      editFields.length > 0 &&
                      (remote ||
                        allowedDemoStatuses(module, String(row.status)).length >
                          1) && (
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
                    {editable &&
                      remote &&
                      module === 'campaigns' &&
                      ['planning', 'active'].includes(String(row.status)) && (
                        <details>
                          <summary>Queue opted-in contacts</summary>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault()
                              void queueCampaign(
                                String(row.id),
                                event.currentTarget,
                              )
                            }}
                          >
                            <p>
                              Only active customers with recorded marketing
                              consent and an email address will be queued.
                            </p>
                            <label>
                              Subject
                              <input
                                name="subject"
                                required
                                maxLength={200}
                                defaultValue={String(
                                  row.name || 'Business update',
                                )}
                              />
                            </label>
                            <label>
                              Message
                              <textarea name="body" required maxLength={8000} />
                            </label>
                            <button disabled={busy}>Queue campaign</button>
                          </form>
                        </details>
                      )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!busy && !rows.length && (
          <p className="empty">
            No records yet. Add your first record to get started.
          </p>
        )}
      </div>
    </section>
  )
}
