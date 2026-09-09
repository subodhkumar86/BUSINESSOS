import { useEffect, useRef, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'
import type { Shipment } from './shipment-contracts'
import type { ShipmentReturn } from './return-contracts'
export function ReturnsPanel({
  remote,
  onRefresh,
}: {
  remote: Snapshot | null
  onRefresh: () => Promise<void>
}) {
  const [rows, setRows] = useState<ShipmentReturn[]>([]),
    [shipments, setShipments] = useState<Shipment[]>([]),
    [locations, setLocations] = useState<
      { id: string; name: string; status: string }[]
    >([]),
    [loading, setLoading] = useState(Boolean(remote)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0),
    [filter, setFilter] = useState('all')
  const saving = useRef(false),
    pending = useRef(new Map<string, string>())
  const editable = Boolean(
    remote && ['owner', 'operations_manager'].includes(remote.user.role),
  )
  useEffect(() => {
    if (!remote) return
    let active = true
    Promise.all([
      request<{ returns: ShipmentReturn[] }>('/warehouse/shipment-returns'),
      request<{ shipments: Shipment[] }>('/warehouse/shipments'),
      request<{ locations: typeof locations }>('/warehouse/locations'),
    ])
      .then(([r, s, l]) => {
        if (active) {
          setRows(r.returns)
          setShipments(s.shipments)
          setLocations(l.locations)
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'Could not load returns.',
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
      const row = await request<ShipmentReturn>(path, {
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
        row.status === 'restocked'
          ? 'Return restocked. Inventory and COGS reversal were posted.'
          : 'Return record saved.',
      )
      if (row.status === 'restocked')
        try {
          await onRefresh()
        } catch {
          setError(
            'Return was saved. Refresh the workspace to update dashboard totals.',
          )
        }
      setReload((value) => value + 1)
      return true
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save return.',
      )
      setReload((value) => value + 1)
      return false
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  if (!remote) return <p>Sign in to manage shipment returns.</p>
  const remaining = (shipment: Shipment) =>
    shipment.quantity -
    rows
      .filter(
        (row) => row.shipment_id === shipment.id && row.status !== 'cancelled',
      )
      .reduce((total, row) => total + row.quantity, 0)
  const eligible = shipments.filter(
    (shipment) => shipment.status === 'dispatched' && remaining(shipment) > 0,
  )
  const visible = rows.filter(
    (row) => filter === 'all' || row.status === filter,
  )
  return (
    <section className="panel">
      <h2>Shipment returns and inspection</h2>
      <p>
        Record returned goods against a dispatched shipment. Restockable goods
        restore inventory at the original dispatch cost. Customer refunds and
        credits require a separate finance workflow.
      </p>
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
            if (
              await mutate('/warehouse/shipment-returns', 'POST', {
                shipmentId: data.get('shipmentId'),
                quantity: Number(data.get('quantity')),
                reason: data.get('reason'),
                destinationLocationId:
                  data.get('destinationLocationId') || null,
              })
            )
              form.reset()
          }}
        >
          <label>
            Dispatched shipment
            <select name="shipmentId" required defaultValue="">
              <option value="" disabled>
                Select shipment
              </option>
              {eligible.map((shipment) => (
                <option value={shipment.id} key={shipment.id}>
                  {shipment.order_ref} · {shipment.product_name} ·{' '}
                  {remaining(shipment)} returnable
                </option>
              ))}
            </select>
          </label>
          <label>
            Returned quantity
            <input
              name="quantity"
              type="number"
              min="1"
              max="100000000"
              step="1"
              required
            />
          </label>
          <label>
            Reason
            <textarea name="reason" required maxLength={1000} />
          </label>
          <label>
            Restock destination
            <select name="destinationLocationId">
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
          <button disabled={busy || !eligible.length} className="primary">
            Register return
          </button>
        </form>
      )}
      <div className="operations-fields">
        <label>
          Return status
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {[
              'all',
              'inspecting',
              'inspected',
              'restocked',
              'closed_damaged',
              'cancelled',
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={() => setReload((value) => value + 1)}>
          Refresh returns
        </button>
      </div>
      {loading ? (
        <p role="status">Loading returns...</p>
      ) : visible.length ? (
        visible.map((row) => (
          <article className="card" key={row.id}>
            <h3>
              {row.order_ref} · {row.product_name}
            </h3>
            <p>
              {row.customer} · {row.quantity} units ·{' '}
              {row.status.replaceAll('_', ' ')}
            </p>
            <p>Reason: {row.reason}</p>
            <p>
              Destination:{' '}
              {row.destination_location_name || 'Unallocated stock'}
            </p>
            {row.condition && (
              <p>
                Inspection: {row.condition} — {row.inspection_notes}
              </p>
            )}
            {editable && row.status === 'inspecting' && (
              <form
                className="operations-fields"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  await mutate(
                    '/warehouse/shipment-returns/' + row.id,
                    'PATCH',
                    {
                      version: row.version,
                      status: 'inspected',
                      condition: data.get('condition'),
                      inspectionNotes: data.get('inspectionNotes'),
                    },
                  )
                }}
              >
                <label>
                  Condition
                  <select name="condition" required defaultValue="">
                    <option value="" disabled>
                      Select inspected condition
                    </option>
                    <option value="restockable">Restockable</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </label>
                <label>
                  Inspection notes
                  <textarea name="inspectionNotes" required maxLength={1000} />
                </label>
                <button disabled={busy}>Save inspection</button>
              </form>
            )}
            {editable && row.status === 'inspected' && (
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    '/warehouse/shipment-returns/' + row.id,
                    'PATCH',
                    {
                      version: row.version,
                      status:
                        row.condition === 'restockable'
                          ? 'restocked'
                          : 'closed_damaged',
                    },
                  )
                }
              >
                {row.condition === 'restockable'
                  ? 'Restock and reverse COGS'
                  : 'Close damaged return'}
              </button>
            )}
            {editable && ['inspecting', 'inspected'].includes(row.status) && (
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    '/warehouse/shipment-returns/' + row.id,
                    'PATCH',
                    { version: row.version, status: 'cancelled' },
                  )
                }
              >
                Cancel return
              </button>
            )}
            {row.stock_movement_id && (
              <small>Stock movement: {row.stock_movement_id}</small>
            )}
          </article>
        ))
      ) : (
        <p>No returns {rows.length ? 'match this status' : 'yet'}.</p>
      )}
    </section>
  )
}
