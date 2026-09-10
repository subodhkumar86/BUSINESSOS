import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'
import {
  calculateVAT,
  calculateWHT,
  calculateCIT,
  WHT_RATES,
  type WhtCategory,
} from './tax'

export interface TaxFiling {
  id: string
  name: string
  territory: string
  due_date: string
  amount: number
  status: 'draft' | 'ready' | 'filed' | 'paid' | 'overdue'
  created_at?: string
  updated_at?: string
}

const demoFilings: TaxFiling[] = [
  {
    id: 'tf-1',
    name: 'Value Added Tax (VAT) Return · September 2026',
    territory: 'Nigeria',
    due_date: '2026-10-21',
    amount: 145000,
    status: 'ready',
  },
  {
    id: 'tf-2',
    name: 'Withholding Tax (WHT) Monthly Remittance Schedule',
    territory: 'Nigeria',
    due_date: '2026-10-21',
    amount: 85000,
    status: 'draft',
  },
  {
    id: 'tf-3',
    name: 'State Internal Revenue PAYE Remittance (LIRS/FIRS)',
    territory: 'Nigeria',
    due_date: '2026-10-10',
    amount: 320000,
    status: 'paid',
  },
  {
    id: 'tf-4',
    name: 'Company Income Tax (CIT) Provisional Q3 Return',
    territory: 'Nigeria',
    due_date: '2026-12-31',
    amount: 600000,
    status: 'draft',
  },
]

export function TaxPanel({ remote }: { remote: Snapshot | null }) {
  const [filings, setFilings] = useState<TaxFiling[]>(() =>
    remote ? [] : demoFilings,
  )
  const [loading, setLoading] = useState(Boolean(remote))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const territory = 'Nigeria'
  const [revision, setRevision] = useState(0)

  // Tax Calculator States
  const [vatAmount, setVatAmount] = useState<number>(500000)
  const [vatInclusive, setVatInclusive] = useState<boolean>(false)
  const [whtGross, setWhtGross] = useState<number>(1200000)
  const [whtCategory, setWhtCategory] = useState<WhtCategory>('contracts_supplies')
  const [citTurnover, setCitTurnover] = useState<number>(45000000)
  const [citProfit, setCitProfit] = useState<number>(8000000)

  const editable =
    !remote ||
    ['owner', 'finance_admin'].includes(remote.user.role)

  useEffect(() => {
    let active = true
    if (!remote) return
    request<{ filings: TaxFiling[] }>('/tax/filings')
      .then((data) => {
        if (active) setFilings(data.filings)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [remote, revision])

  async function handleCreateFiling(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const name = String(values.name).trim()
    const dueDate = String(values.dueDate).trim()
    const amount = Number(values.amount) || 0

    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      const newFiling: TaxFiling = {
        id: 'tf-' + Date.now(),
        name,
        territory,
        due_date: dueDate,
        amount,
        status: 'draft',
      }
      setFilings((prev) => [newFiling, ...prev])
      form.reset()
      setNotice('Tax filing scheduled in workspace calendar (demo).')
      setBusy(false)
      return
    }

    try {
      await request('/tax/filings', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          name,
          territory,
          dueDate,
          amount,
        }),
      })
      form.reset()
      setNotice('Tax filing created and audited on server.')
      setRevision((r) => r + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create filing.')
    } finally {
      setBusy(false)
    }
  }

  async function handleStatusChange(id: string, nextStatus: TaxFiling['status']) {
    if (!editable) return
    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      setFilings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: nextStatus } : f)),
      )
      setNotice(`Filing marked as ${nextStatus} (demo).`)
      setBusy(false)
      return
    }

    try {
      await request(`/tax/filings/${id}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ status: nextStatus }),
      })
      setFilings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: nextStatus } : f)),
      )
      setNotice(`Filing status updated to ${nextStatus}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.')
    } finally {
      setBusy(false)
    }
  }

  const vatCalc = calculateVAT(vatAmount || 0, vatInclusive)
  const whtCalc = calculateWHT(whtGross || 0, whtCategory)
  const citCalc = calculateCIT(citTurnover || 0, citProfit || 0)

  const pendingTotal = filings
    .filter((f) => f.status !== 'paid')
    .reduce((acc, f) => acc + f.amount, 0)

  return (
    <div className="module-panel">
      {/* Telemetry Row */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Tax Territory</span>
          <b className="stat-value">{territory}</b>
          <small>FIRS / Tax Act 2026 rules</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pending Filings</span>
          <b className="stat-value" style={{ color: '#b45309' }}>
            ₦{pendingTotal.toLocaleString()}
          </b>
          <small>{filings.filter((f) => f.status !== 'paid').length} returns due</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Standard VAT Rate</span>
          <b className="stat-value">7.5%</b>
          <small>Applicable on vatable supplies</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Remittance Integrity</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>Audit Ready</b>
          <small>Reconciled with general ledger</small>
        </div>
      </div>

      {error && <p role="alert" className="notice error">{error}</p>}
      {notice && <p role="status" className="notice success">{notice}</p>}

      {/* Interactive Nigerian Tax Calculation Simulator */}
      <div className="two-col">
        <section className="card">
          <div className="section-header">
            <h2>Value Added Tax (VAT) Calculator</h2>
            <small>Standard 7.5% Nigerian statutory rate with inclusive or exclusive pricing.</small>
          </div>
          <div className="operations-fields">
            <label>
              Supply Amount (₦)
              <input
                type="number"
                min="0"
                step="100"
                value={vatAmount}
                onChange={(e) => setVatAmount(Number(e.target.value) || 0)}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <input
                type="checkbox"
                checked={vatInclusive}
                onChange={(e) => setVatInclusive(e.target.checked)}
              />
              Amount is VAT-inclusive (net base back-calculated)
            </label>
          </div>
          <div className="telemetry-list" style={{ marginTop: '12px' }}>
            <div className="telemetry-item">
              <span>Net Base Amount</span>
              <b>₦{vatCalc.baseAmount.toLocaleString()}</b>
            </div>
            <div className="telemetry-item">
              <span>VAT at 7.5%</span>
              <b style={{ color: '#2563eb' }}>₦{vatCalc.vatAmount.toLocaleString()}</b>
            </div>
            <div className="telemetry-item">
              <span>Gross Total Amount</span>
              <b style={{ color: '#16a34a' }}>₦{vatCalc.totalAmount.toLocaleString()}</b>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <h2>Withholding Tax (WHT) Deduction</h2>
            <small>Withhold at statutory rates (5% or 10%) before vendor disbursement.</small>
          </div>
          <div className="operations-fields">
            <label>
              Gross Invoice Amount (₦)
              <input
                type="number"
                min="0"
                step="500"
                value={whtGross}
                onChange={(e) => setWhtGross(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              Contract / Payment Type
              <select
                value={whtCategory}
                onChange={(e) => setWhtCategory(e.target.value as WhtCategory)}
                aria-label="WHT Category"
              >
                {Object.entries(WHT_RATES).map(([k, cfg]) => (
                  <option key={k} value={k}>
                    {cfg.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="telemetry-list" style={{ marginTop: '12px' }}>
            <div className="telemetry-item">
              <span>WHT Deducted ({whtCalc.whtRate * 100}%)</span>
              <b style={{ color: '#dc2626' }}>-₦{whtCalc.whtDeducted.toLocaleString()}</b>
            </div>
            <div className="telemetry-item">
              <span>Net Disbursement to Vendor</span>
              <b style={{ color: '#16a34a' }}>₦{whtCalc.netPayable.toLocaleString()}</b>
            </div>
          </div>
        </section>
      </div>

      {/* CIT Estimator */}
      <section className="card" style={{ marginTop: '16px' }}>
        <div className="section-header">
          <h2>Company Income Tax (CIT) Bracket Assessment</h2>
          <small>Determine enterprise tax bracket and estimate liability under Nigerian Companies Income Tax rules.</small>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <label>
            Annual Turnover (₦)
            <input
              type="number"
              min="0"
              step="1000000"
              value={citTurnover}
              onChange={(e) => setCitTurnover(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Estimated Taxable Profit (₦)
            <input
              type="number"
              min="0"
              step="500000"
              value={citProfit}
              onChange={(e) => setCitProfit(Number(e.target.value) || 0)}
            />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Assessed Scale & Bracket:</span>
            <b style={{ fontSize: '15px', color: '#4338ca' }}>{citCalc.label}</b>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Estimated CIT Liability:</span>
            <b style={{ fontSize: '18px', color: citCalc.citPayable === 0 ? '#16a34a' : '#b45309' }}>
              ₦{citCalc.citPayable.toLocaleString()}
            </b>
          </div>
        </div>
      </section>

      {/* Filing Schedule Table */}
      <section className="card" style={{ marginTop: '16px' }}>
        <div className="section-header">
          <h2>Statutory Tax Filing & Remittance Schedule</h2>
          <small>Track compliance deadlines, preparation readiness, and banking payment records.</small>
        </div>

        {loading ? (
          <p className="empty">Loading tax filings…</p>
        ) : filings.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Filing / Return Name</th>
                  <th>Territory</th>
                  <th>Due Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.id}>
                    <td><b>{f.name}</b></td>
                    <td>{f.territory}</td>
                    <td>{new Date(f.due_date).toLocaleDateString()}</td>
                    <td>₦{f.amount.toLocaleString()}</td>
                    <td>
                      <span className={f.status === 'paid' ? 'badge green' : f.status === 'overdue' ? 'badge red' : 'badge'}>
                        {f.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <select
                        disabled={busy || !editable}
                        value={f.status}
                        onChange={(e) =>
                          void handleStatusChange(
                            f.id,
                            e.target.value as TaxFiling['status'],
                          )
                        }
                        aria-label={`Status for ${f.name}`}
                      >
                        <option value="draft">Draft</option>
                        <option value="ready">Ready to File</option>
                        <option value="filed">Filed with Authority</option>
                        <option value="paid">Paid & Remitted</option>
                        <option value="overdue">Overdue</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No tax filings recorded yet.</p>
        )}
      </section>

      {/* Create Filing Form */}
      {editable && (
        <section className="card" style={{ marginTop: '16px' }}>
          <h2>Schedule New Tax Filing Return</h2>
          <form className="inline-form" onSubmit={handleCreateFiling}>
            <input name="name" placeholder="Filing Name (e.g. Q4 VAT Return)" required />
            <input name="dueDate" type="date" required />
            <input
              name="amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="Estimated Amount (₦)"
              required
            />
            <button className="primary" disabled={busy} type="submit">
              + Schedule Filing
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
