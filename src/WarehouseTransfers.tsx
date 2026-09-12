import { useEffect, useRef, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

export function WarehouseTransfers({ remote }: { remote: Snapshot | null }) {
  const [locations, setLocations] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [rows, setRows] = useState<
      {
        id: string
        product_name: string
        quantity: number
        source_location_id: string | null
        destination_location_id: string
      }[]
    >([])
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const pending = useRef<{ body: string; key: string } | null>(null)
  const saving = useRef(false)
  useEffect(() => {
    let active = true
    if (remote)
      Promise.all([
        request<{ locations: typeof locations }>('/warehouse/locations'),
        request<{ transfers: typeof rows }>('/warehouse/transfers'),
      ])
        .then(([l, t]) => {
          if (active) {
            setLocations(l.locations)
            setRows(t.transfers)
          }
        })
        .catch((e) => {
          if (active) setError(e.message)
        })
    return () => {
      active = false
    }
  }, [remote])
  if (!remote) return <p>Sign in to transfer warehouse stock.</p>
  const locationName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name || (id ? id : 'Unallocated stock')
  return (
    <section className="panel">
      <div className="section-top">
        <div>
          <h2>Stock transfers</h2>
          <p>Allocate existing inventory to a warehouse or move it between locations. Total stock and valuation stay constant.</p>
        </div>
        <span className="badge">{rows.length} recorded</span>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (saving.current) return
          const form = e.currentTarget
          const f = new FormData(form)
          if (f.get('source') === f.get('destination')) {
            setNotice('')
            setError('Choose a destination different from the source.')
            return
          }
          const body = JSON.stringify({
            sourceLocationId: f.get('source') || null,
            destinationLocationId: f.get('destination'),
            productId: f.get('product'),
            quantity: Number(f.get('quantity')),
          })
          if (pending.current?.body !== body)
            pending.current = { body, key: crypto.randomUUID() }
          saving.current = true
          setBusy(true)
          setError('')
          setNotice('')
          try {
            await request('/warehouse/transfers', {
              method: 'POST',
              headers: {
                'X-CSRF-Token': remote.csrf,
                'Idempotency-Key': pending.current.key,
              },
              body,
            })
            pending.current = null
            form.reset()
            setNotice('Stock transfer recorded. Inventory value is unchanged.')
            try {
              setRows(
              (
                await request<{ transfers: typeof rows }>(
                  '/warehouse/transfers',
                )
              ).transfers,
            )
            } catch {
              setError('Transfer saved, but history could not refresh. Reload the page to see it; do not submit the transfer again.')
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Transfer failed.')
          } finally {
            saving.current = false
            setBusy(false)
          }
        }}
      >
        <fieldset
          disabled={busy || remote.user.role === 'auditor'}
          className="operations-fields"
        >
          <legend>Transfer inventory</legend>
          <label>
            Source
            <select name="source">
              <option value="">Unallocated stock</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Destination
            <select name="destination" required>
              <option value="">Select warehouse</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select name="product" required>
              {remote.state.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input name="quantity" type="number" min="1" step="1" required />
          </label>
          <button className="primary" disabled={!locations.length || !remote.state.products.length}>{busy ? 'Transferring...' : 'Transfer stock'}</button>
        </fieldset>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Quantity</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><b>{row.product_name}</b></td>
                <td>{row.quantity}</td>
                <td>{locationName(row.source_location_id)}</td>
                <td>{locationName(row.destination_location_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="empty">No transfers yet.</p>}
    </section>
  )
}
