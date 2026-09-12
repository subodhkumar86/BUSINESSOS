import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

interface Budget {
  id: string
  name: string
  department: string
  period_from: string
  period_to: string
  total_amount: number
  spent_amount: number
  status: 'active' | 'closed' | 'draft'
  version: number
}

export function BudgetPanel({ remote }: { remote: Snapshot | null }) {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const readOnly = remote?.user.role === 'auditor'

  useEffect(() => {
    if (!remote) return
    request<{ budgets: Budget[] }>('/budgets').then((d) => setBudgets(d.budgets)).catch((e) => setError(e.message))
  }, [remote])

  const money = (v: number) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(v)

  const variance = (b: Budget) => b.total_amount - b.spent_amount
  const pct = (b: Budget) => b.total_amount > 0 ? Math.min(100, Math.round((b.spent_amount / b.total_amount) * 100)) : 0

  return (
    <section className="card">
      <div className="section-top"><h2>Budget Management</h2></div>
      {error && <div role="alert" className="alert">{error}</div>}
      {notice && <div role="status" className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Name</th><th>Department</th><th>Period</th><th>Budget</th><th>Spent</th><th>Variance</th><th>Utilisation</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {budgets.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b></td>
                <td>{b.department || '—'}</td>
                <td>{b.period_from} → {b.period_to}</td>
                <td>{money(b.total_amount)}</td>
                <td>{money(b.spent_amount)}</td>
                <td style={{ color: variance(b) < 0 ? '#c0392b' : '#27ae60' }}>{money(variance(b))}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 8, background: '#eee', borderRadius: 4 }}>
                      <div style={{ width: pct(b) + '%', height: '100%', background: pct(b) > 90 ? '#e74c3c' : '#6965dc', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: '0.8rem' }}>{pct(b)}%</span>
                  </div>
                </td>
                <td><span className={`badge ${b.status === 'active' ? 'green' : ''}`}>{b.status}</span></td>
                <td>
                  {!readOnly && b.status === 'active' && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (!remote) return
                        setBusy(true)
                        try {
                          await request(`/budgets/${b.id}`, {
                            method: 'PATCH',
                            headers: { 'X-CSRF-Token': remote.csrf },
                            body: JSON.stringify({ version: b.version, status: 'closed' }),
                          })
                          setBudgets((prev) => prev.map((x) => x.id === b.id ? { ...x, status: 'closed', version: x.version + 1 } : x))
                          setNotice('Budget closed.')
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not close budget.')
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >Close</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!budgets.length && <p className="empty">No budgets yet. Create one below.</p>}
      </div>
      {!readOnly && remote && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            const form = e.currentTarget
            const data = Object.fromEntries(new FormData(form))
            try {
              const created = await request<Budget>('/budgets', {
                method: 'POST',
                headers: { 'X-CSRF-Token': remote.csrf },
                body: JSON.stringify({
                  name: data.name,
                  department: data.department,
                  periodFrom: data.periodFrom,
                  periodTo: data.periodTo,
                  totalAmount: Number(data.totalAmount),
                }),
              })
              setBudgets((prev) => [created, ...prev])
              form.reset()
              setNotice('Budget created.')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not create budget.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <input name="name" placeholder="Budget name" required />
          <input name="department" placeholder="Department (optional)" />
          <input name="periodFrom" type="date" required aria-label="Period start" />
          <input name="periodTo" type="date" required aria-label="Period end" />
          <input name="totalAmount" type="number" min="0" step="0.01" placeholder="Total amount" required />
          <button className="primary" disabled={busy}>+ Create budget</button>
        </form>
      )}
    </section>
  )
}
