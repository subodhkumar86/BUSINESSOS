import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

interface RFQ {
  id: string
  rfq_number: string
  supplier_name: string
  product_description: string
  quantity: number
  required_by: string | null
  quoted_amount: number | null
  status: 'draft' | 'sent' | 'quoted' | 'accepted' | 'rejected' | 'expired'
  notes: string
  version: number
}

const statusColors: Record<string, string> = { accepted: 'green', quoted: 'green' }

export function RFQPanel({ remote }: { remote: Snapshot | null }) {
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const readOnly = remote?.user.role === 'auditor'

  useEffect(() => {
    if (!remote) return
    request<{ rfqs: RFQ[] }>('/rfq').then((d) => setRfqs(d.rfqs)).catch((e) => setError(e.message))
  }, [remote])

  const money = (v: number | null) =>
    v == null ? '—' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(v)

  const nextStatus = (s: RFQ['status']): RFQ['status'] | null => {
    const map: Partial<Record<RFQ['status'], RFQ['status']>> = { sent: 'quoted', quoted: 'accepted' }
    return map[s] || null
  }

  return (
    <section className="card">
      <div className="section-top"><h2>Requests for Quotation (RFQ)</h2></div>
      {error && <div role="alert" className="alert">{error}</div>}
      {notice && <div role="status" className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>RFQ #</th><th>Supplier</th><th>Product</th><th>Qty</th><th>Required by</th><th>Quoted</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {rfqs.map((r) => (
              <tr key={r.id}>
                <td><b>{r.rfq_number}</b></td>
                <td>{r.supplier_name}</td>
                <td>{r.product_description}</td>
                <td>{r.quantity}</td>
                <td>{r.required_by || '—'}</td>
                <td>{money(r.quoted_amount)}</td>
                <td><span className={`badge ${statusColors[r.status] || ''}`}>{r.status}</span></td>
                <td>
                  {!readOnly && nextStatus(r.status) && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (!remote) return
                        setBusy(true)
                        try {
                          const next = nextStatus(r.status)!
                          await request(`/rfq/${r.id}`, {
                            method: 'PATCH',
                            headers: { 'X-CSRF-Token': remote.csrf },
                            body: JSON.stringify({ version: r.version, status: next }),
                          })
                          setRfqs((prev) => prev.map((x) => x.id === r.id ? { ...x, status: next, version: x.version + 1 } : x))
                          setNotice(`RFQ ${r.rfq_number} marked as ${next}.`)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not update RFQ.')
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >Mark {nextStatus(r.status)}</button>
                  )}
                  {!readOnly && r.status === 'sent' && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (!remote) return
                        const amt = prompt('Enter quoted amount (NGN):')
                        if (!amt || isNaN(Number(amt))) return
                        setBusy(true)
                        try {
                          await request(`/rfq/${r.id}`, {
                            method: 'PATCH',
                            headers: { 'X-CSRF-Token': remote.csrf },
                            body: JSON.stringify({ version: r.version, quotedAmount: Number(amt), status: 'quoted' }),
                          })
                          setRfqs((prev) => prev.map((x) => x.id === r.id ? { ...x, quoted_amount: Number(amt), status: 'quoted', version: x.version + 1 } : x))
                          setNotice('Quote recorded.')
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not record quote.')
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >Record quote</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rfqs.length && <p className="empty">No RFQs yet. Create one below.</p>}
      </div>
      {!readOnly && remote && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            const data = Object.fromEntries(new FormData(e.currentTarget))
            try {
              const created = await request<RFQ>('/rfq', {
                method: 'POST',
                headers: { 'X-CSRF-Token': remote.csrf },
                body: JSON.stringify({
                  supplierName: data.supplierName,
                  productDescription: data.productDescription,
                  quantity: Number(data.quantity),
                  requiredBy: data.requiredBy || null,
                  notes: data.notes || '',
                }),
              })
              setRfqs((prev) => [created, ...prev])
              e.currentTarget.reset()
              setNotice('RFQ created and sent.')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not create RFQ.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <input name="supplierName" placeholder="Supplier name" required />
          <input name="productDescription" placeholder="Product / service description" required />
          <input name="quantity" type="number" min="1" placeholder="Quantity" required />
          <input name="requiredBy" type="date" aria-label="Required by date" />
          <input name="notes" placeholder="Notes (optional)" />
          <button className="primary" disabled={busy}>+ Send RFQ</button>
        </form>
      )}
    </section>
  )
}
