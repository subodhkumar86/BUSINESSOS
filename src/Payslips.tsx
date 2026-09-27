import { useState } from 'react'
import { generatePayslips } from './domain'
import type { State } from './types'

export function Payslips({ state }: { state: State }) {
  const [runId, setRunId] = useState('')
  const runs = state.payroll.filter((run) => run.status === 'Approved')
  const slips = generatePayslips(state, runId)
  return (
    <section className="panel payslips-panel">
      <div className="section-top payslips-heading">
        <div>
          <p className="eyebrow">Payroll records</p>
          <h2>Employee payslips</h2>
          <p>Review approved payroll records. Approval does not confirm payment.</p>
        </div>
        {runId && <span className="payslips-count"><b>{slips.length}</b> payslips</span>}
      </div>
      <label className="payslip-period-picker">
        Approved payroll period
        <select value={runId} onChange={(e) => setRunId(e.target.value)}>
          <option value="">Select a period</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.period}
            </option>
          ))}
        </select>
      </label>
      <p className="payslip-note">
        Pension uses gross pay as the configured pensionable base. Additional
        personal reliefs are not configured. Approval does not confirm payment.
      </p>
      {!runs.length && (
        <p className="empty">Approve a payroll run to view payslips.</p>
      )}
      {runId && !slips.length && (
        <p>
          This historical run has no versioned statutory rules. No deductions
          have been inferred.
        </p>
      )}
      <div className="payslip-list">
      {slips.map((slip) => (
        <details key={slip.id} className="payslip-item">
          <summary>
            {slip.employeeName} · Net pay {state.currency}{' '}
            {slip.netPay.toLocaleString()}
          </summary>
          <dl>
            {[
              ['Department', slip.department],
              ['Gross pay', slip.grossPay],
              ['Employee pension', slip.employeePension],
              ['Employer pension', slip.employerPension],
              ['PAYE', slip.payeTax],
              ['Total deductions', slip.totalDeductions],
              ['Net pay', slip.netPay],
            ].map(([title, value]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      </div>
    </section>
  )
}
