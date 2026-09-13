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
interface StatutorySettings {
  country_code: string
  jurisdiction: string
  currency: string
  financial_year_start_month: number
  vat_rate: number
  withholding_rate: number
  income_tax_rate: number
  payroll_employee_rate: number
  payroll_employer_rate: number
  invoice_prefix: string
  tax_inclusive: boolean
  compliance_notes: string
}
const defaultSettings: StatutorySettings = {
  country_code: 'NG', jurisdiction: 'Nigeria', currency: 'NGN', financial_year_start_month: 1,
  vat_rate: 0.075, withholding_rate: 0.05, income_tax_rate: 0.3,
  payroll_employee_rate: 0, payroll_employer_rate: 0, invoice_prefix: 'INV',
  tax_inclusive: false, compliance_notes: '',
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
  const [settings, setSettings] = useState<StatutorySettings>(defaultSettings)
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
    Promise.all([request<{ filings: TaxFiling[] }>('/tax/filings'), request<{ settings: StatutorySettings }>('/tax/settings')])
      .then(([data, settingsData]) => {
        if (active) setFilings(data.filings)
        if (active) setSettings({ ...defaultSettings, ...settingsData.settings, vat_rate: Number(settingsData.settings.vat_rate), withholding_rate: Number(settingsData.settings.withholding_rate), income_tax_rate: Number(settingsData.settings.income_tax_rate), payroll_employee_rate: Number(settingsData.settings.payroll_employee_rate), payroll_employer_rate: Number(settingsData.settings.payroll_employer_rate) })
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
        territory: settings.jurisdiction,
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
          territory: settings.jurisdiction,
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

  const vatCalc = calculateVAT(vatAmount || 0, vatInclusive, settings.vat_rate)
  const whtCalc = calculateWHT(whtGross || 0, whtCategory, settings.withholding_rate)
  const citCalc = calculateCIT(citTurnover || 0, citProfit || 0, settings.income_tax_rate)

  const pendingTotal = filings
    .filter((f) => f.status !== 'paid')
    .reduce((acc, f) => acc + f.amount, 0)

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || busy) return
    const values = new FormData(event.currentTarget)
    const next: StatutorySettings = {
      country_code: String(values.get('countryCode')).toUpperCase(), jurisdiction: String(values.get('jurisdiction')).trim(),
      currency: String(values.get('currency')).toUpperCase(), financial_year_start_month: Number(values.get('financialYearStartMonth')),
      vat_rate: Number(values.get('vatRate')) / 100, withholding_rate: Number(values.get('withholdingRate')) / 100,
      income_tax_rate: Number(values.get('incomeTaxRate')) / 100, payroll_employee_rate: Number(values.get('payrollEmployeeRate')) / 100,
      payroll_employer_rate: Number(values.get('payrollEmployerRate')) / 100, invoice_prefix: String(values.get('invoicePrefix')).toUpperCase(),
      tax_inclusive: values.get('taxInclusive') === 'on', compliance_notes: String(values.get('complianceNotes')).trim(),
    }
    setBusy(true); setError(''); setNotice('')
    try {
      if (remote) await request('/tax/settings', { method: 'PATCH', headers: { 'X-CSRF-Token': remote.csrf }, body: JSON.stringify({ countryCode: next.country_code, jurisdiction: next.jurisdiction, currency: next.currency, financialYearStartMonth: next.financial_year_start_month, vatRate: next.vat_rate, withholdingRate: next.withholding_rate, incomeTaxRate: next.income_tax_rate, payrollEmployeeRate: next.payroll_employee_rate, payrollEmployerRate: next.payroll_employer_rate, invoicePrefix: next.invoice_prefix, taxInclusive: next.tax_inclusive, complianceNotes: next.compliance_notes }) })
      setSettings(next); setNotice(remote ? 'Tenant statutory settings saved and audited.' : 'Demo tenant statutory settings saved.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save statutory settings.') } finally { setBusy(false) }
  }

  return (
    <div className="module-panel">
      {/* Telemetry Row */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Tax Territory</span>
          <b className="stat-value">{settings.jurisdiction}</b>
          <small>{settings.country_code} · tenant-configured rules</small>
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
          <b className="stat-value">{(settings.vat_rate * 100).toFixed(2)}%</b>
          <small>Tenant configured VAT/GST rate</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Remittance Integrity</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>Audit Ready</b>
          <small>Reconciled with general ledger</small>
        </div>
      </div>

      {error && <p role="alert" className="notice error">{error}</p>}
      {notice && <p role="status" className="notice success">{notice}</p>}

      {editable && <section className="card" style={{ marginBottom: '16px' }}>
        <div className="section-header"><h2>Tenant tax, payroll & invoice configuration</h2><small>These rules apply only to this tenant. Confirm rates with a qualified local adviser before filing.</small></div>
        <form className="operations-fields" onSubmit={(event) => void saveSettings(event)}>
          <label>Country code<input name="countryCode" defaultValue={settings.country_code} pattern="[A-Z]{2}" required /></label>
          <label>Tax jurisdiction<input name="jurisdiction" defaultValue={settings.jurisdiction} required /></label>
          <label>Currency<input name="currency" defaultValue={settings.currency} pattern="[A-Z]{3}" required /></label>
          <label>Financial year starts (month)<input name="financialYearStartMonth" type="number" min="1" max="12" defaultValue={settings.financial_year_start_month} required /></label>
          <label>VAT / GST rate (%)<input name="vatRate" type="number" min="0" max="100" step="0.001" defaultValue={settings.vat_rate * 100} required /></label>
          <label>Withholding rate (%)<input name="withholdingRate" type="number" min="0" max="100" step="0.001" defaultValue={settings.withholding_rate * 100} required /></label>
          <label>Income tax rate (%)<input name="incomeTaxRate" type="number" min="0" max="100" step="0.001" defaultValue={settings.income_tax_rate * 100} required /></label>
          <label>Employee payroll deduction (%)<input name="payrollEmployeeRate" type="number" min="0" max="100" step="0.001" defaultValue={settings.payroll_employee_rate * 100} required /></label>
          <label>Employer payroll contribution (%)<input name="payrollEmployerRate" type="number" min="0" max="100" step="0.001" defaultValue={settings.payroll_employer_rate * 100} required /></label>
          <label>Invoice prefix<input name="invoicePrefix" defaultValue={settings.invoice_prefix} pattern="[A-Z0-9-]{1,16}" required /></label>
          <label><input name="taxInclusive" type="checkbox" defaultChecked={settings.tax_inclusive} /> Invoice amounts include tax by default</label>
          <label>Compliance notes<textarea name="complianceNotes" defaultValue={settings.compliance_notes} maxLength={2000} /></label>
          <button className="primary" disabled={busy}>Save tenant settings</button>
        </form>
      </section>}

      {/* Interactive tenant-configured tax calculator */}
      <div className="two-col">
        <section className="card">
          <div className="section-header">
            <h2>Value Added Tax (VAT) Calculator</h2>
            <small>Uses this tenant's configured VAT/GST rate and inclusive/exclusive pricing selection.</small>
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
              <span>VAT at {(settings.vat_rate * 100).toFixed(2)}%</span>
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
            <small>Uses this tenant's configured withholding rate before vendor disbursement.</small>
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
          <small>Estimate a liability using tenant inputs. Obtain local professional approval before filing.</small>
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
