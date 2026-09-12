import { useEffect, useRef, useState } from 'react'
import { request } from './api'
import { shipmentTransitions, type Shipment } from './shipment-contracts'
import type { Snapshot } from './types'
export function ShipmentsPanel({
  remote,
  onRefresh,
}: {
  remote: Snapshot | null
  onRefresh: () => Promise<void>
}) {
  const [rows, setRows] = useState<Shipment[]>([]),
    [locations, setLocations] = useState<
      { id: string; name: string; status: string }[]
    >([]),
    [loading, setLoading] = useState(Boolean(remote)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [reload, setReload] = useState(0)
  const pending = useRef(new Map<string, string>()),
    saving = useRef(false)
  const editable = Boolean(
    remote && ['owner', 'operations_manager'].includes(remote.user.role),
  )
  useEffect(() => {
    if (!remote) return
    let active = true
    Promise.all([
      request<{ shipments: Shipment[] }>('/warehouse/shipments'),
      request<{ locations: typeof locations }>('/warehouse/locations'),
    ])
      .then(([data, places]) => {
        if (active) {
          setRows(data.shipments)
          setLocations(places.locations)
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load shipments.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [remote, reload])
  async function mutate(path: string, method: string, input: unknown) {
    if (!remote || saving.current) return false
    saving.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const body = JSON.stringify(input),
      fingerprint = method + path + body
    let key = pending.current.get(fingerprint)
    if (!key) {
      key = crypto.randomUUID()
      pending.current.set(fingerprint, key)
    }
    try {
      const row = await request<Shipment>(path, {
        method,
        headers: { 'X-CSRF-Token': remote.csrf, 'Idempotency-Key': key },
        body,
      })
      pending.current.delete(fingerprint)
      setRows((current) => [
        row,
        ...current.filter((item) => item.id !== row.id),
      ])
      setNotice(
        row.status === 'dispatched'
          ? 'Shipment dispatched. Stock and cost of goods sold were posted.'
          : 'Shipment saved.',
      )
      if (row.status === 'dispatched')
        try {
          await onRefresh()
        } catch {
          setError(
            'Shipment saved, but dashboard refresh failed. Refresh the workspace to see the latest totals.',
          )
        }
      setReload((value) => value + 1)
      return true
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save shipment.',
      )
      setReload((value) => value + 1)
      return false
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  if (!remote) return <p>Sign in to manage warehouse shipments.</p>
  const stageCount = (stage: Shipment['status']) =>
    rows.filter((row) => row.status === stage).length
  const inProgress = stageCount('picking') + stageCount('packed')
  const visible = rows.filter(
    (row) =>
      (filter === 'all' || row.status === filter) &&
      `${row.order_ref} ${row.customer} ${row.product_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  return (
    <section className="panel">
      <div className="section-top">
        <div>
          <h2>Shipments</h2>
          <p>
            Move an order from picking to dispatch with a traceable stock and
            cost-of-goods posting.
          </p>
        </div>
        <span className="badge">{inProgress} active</span>
      </div>
      <div className="stats-row shipment-stats" aria-label="Shipment summary">
        <div className="stat-card"><span>Picking</span><strong>{stageCount('picking')}</strong><small>Awaiting pack</small></div>
        <div className="stat-card"><span>Packed</span><strong>{stageCount('packed')}</strong><small>Ready to dispatch</small></div>
        <div className="stat-card"><span>Dispatched</span><strong>{stageCount('dispatched')}</strong><small>Posted to inventory</small></div>
      </div>
      <p className="muted">Stock is checked only at dispatch; it is not reserved while a shipment is being picked or packed.</p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      {editable && (
        <form
          className="operations-fields"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = event.currentTarget,
              data = new FormData(form)
            const saved = await mutate('/warehouse/shipments', 'POST', {
              orderRef: data.get('orderRef'),
              customer: data.get('customer'),
              productId: data.get('productId'),
              quantity: Number(data.get('quantity')),
              sourceLocationId: data.get('sourceLocationId') || null,
            })
            if (saved) form.reset()
          }}
        >
          <label>
            Order reference
            <input name="orderRef" required maxLength={160} placeholder="e.g. SO-1042" />
          </label>
          <label>
            Customer
            <input name="customer" required maxLength={160} />
          </label>
          <label>
            Product
            <select name="productId" required defaultValue="">
              <option value="" disabled>
                Select product
              </option>
              {remote.state.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.qty} total)
                </option>
              ))}
            </select>
          </label>
          <label>
            Source stock
            <select name="sourceLocationId">
              <option value="">Unallocated stock</option>
              {locations
                .filter((location) => location.status === 'active')
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              name="quantity"
              type="number"
              min="1"
              max="100000000"
              step="1"
              required
            />
          </label>
          <button className="primary" disabled={busy || !remote.state.products.length}>
            Create picking request
          </button>
        </form>
      )}
      <div className="operations-fields">
        <label>
          Search shipments
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Stage
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {['all', 'picking', 'packed', 'dispatched', 'cancelled'].map(
              (status) => (
                <option key={status}>{status}</option>
              ),
            )}
          </select>
        </label>
        <button disabled={busy} onClick={() => setReload((value) => value + 1)}>
          Refresh shipments
        </button>
      </div>
      {loading ? (
        <p role="status">Loading shipments...</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order / customer</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Source</th>
                <th>Status</th>
                <th>Actions / posting</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.order_ref}
                    <small>{row.customer}</small>
                  </td>
                  <td>{row.product_name}</td>
                  <td>{row.quantity}</td>
                  <td>{row.source_location_name || 'Unallocated stock'}</td>
                  <td><span className={row.status === 'dispatched' ? 'badge green' : row.status === 'cancelled' ? 'badge red' : 'badge'}>{row.status}</span></td>
                  <td>
                    {editable &&
                      (shipmentTransitions[row.status] || []).map((status) => (
                        <button
                          key={status}
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              '/warehouse/shipments/' + row.id,
                              'PATCH',
                              { version: row.version, status },
                            )
                          }
                        >
                          {status === 'dispatched'
                            ? 'Dispatch and post COGS'
                            : status === 'packed'
                              ? 'Mark packed'
                              : 'Cancel shipment'}
                        </button>
                      ))}
                    {row.stock_movement_id && (
                      <>
                        <small>Movement: {row.stock_movement_id}</small>
                        <time>
                          {row.dispatched_at
                            ? new Date(row.dispatched_at).toLocaleString()
                            : ''}
                        </time>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={6}>
                    No shipments {rows.length ? 'match your filters' : 'yet'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
