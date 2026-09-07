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
    [busy, setBusy] = useState(false)
  const pending = useRef<{ body: string; key: string } | null>(null)
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
      <h2>Stock transfers</h2>
      {error && <p role="alert">{error}</p>}
      <p>
        Allocate existing inventory to a warehouse, then transfer between
        locations. Total stock and valuation stay constant.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const body = JSON.stringify({
            sourceLocationId: f.get('source') || null,
            destinationLocationId: f.get('destination'),
            productId: f.get('product'),
            quantity: Number(f.get('quantity')),
          })
          if (pending.current?.body !== body)
            pending.current = { body, key: crypto.randomUUID() }
          setBusy(true)
          setError('')
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
            setRows(
              (
                await request<{ transfers: typeof rows }>(
                  '/warehouse/transfers',
                )
              ).transfers,
            )
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Transfer failed.')
          } finally {
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
          <button className="primary">Transfer stock</button>
        </fieldset>
      </form>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Source</th>
            <th>Destination</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.product_name}</td>
              <td>{row.quantity}</td>
              <td>{locationName(row.source_location_id)}</td>
              <td>{locationName(row.destination_location_id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty">No transfers yet.</p>}
    </section>
  )
}
