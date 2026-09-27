import { useState } from 'react'
import {
  generateIncomeStatement,
  generateBalanceSheet,
  generateCashFlowStatement,
} from './domain'
import type { State } from './types'
import { reportingPeriod } from './reporting'

export function FinancialStatements({
  state,
  connected = false,
}: {
  state: State
  connected?: boolean
}) {
  const [tab, setTab] = useState('income')
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('')
  const parsed = reportingPeriod.safeParse({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  })
  const period = parsed.success ? parsed.data : {}
  const income = generateIncomeStatement(state, period),
    balance = generateBalanceSheet(state, period),
    cash = generateCashFlowStatement(state, period)
  const data =
    tab === 'income'
      ? income
      : tab === 'cash'
        ? cash
        : { ...balance.assets, ...balance.liabilities, ...balance.equity }
  return (
    <section className="panel financial-statements">
      <div className="section-top financial-heading">
        <div>
          <p className="eyebrow">Financial reporting</p>
          <h2>Financial statements</h2>
          <p>Review posted journals and opening cash for a selected reporting period.</p>
        </div>
        <span className="financial-period">{from || to ? 'Custom period' : 'All posted data'}</span>
      </div>
      <div className="operations-fields financial-period-fields">
        <label>
          From (UTC)
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Through (UTC)
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button
          onClick={() => {
            setFrom('')
            setTo('')
          }}
        >
          All dates
        </button>
      </div>
      {!parsed.success && (
        <p role="alert" className="notice error">
          Enter valid dates with the start on or before the end.
        </p>
      )}
      {parsed.success && connected && (
        <div className="financial-exports" aria-label="Export financial statement">
          {['csv', 'xlsx', 'pdf'].map((format) => (
            <a
              key={format}
              href={
                (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') +
                '/api/v1/finance/export.' +
                format +
                '?' +
                new URLSearchParams(period)
              }
              target="_blank"
              rel="noreferrer"
            >
              Export {format.toUpperCase()}
            </a>
          ))}
        </div>
      )}
      <p className="financial-note">
        Balance sheet includes all postings through the end date. Cash opening
        balance includes earlier cash movements.
      </p>
      <div role="group" aria-label="Financial statement" className="financial-tabs">
        {[
          ['income', 'Income statement'],
          ['balance', 'Balance sheet'],
          ['cash', 'Cash flow'],
        ].map(([key, title]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={tab === key ? 'is-active' : ''}
          >
            {title}
          </button>
        ))}
      </div>
      {parsed.success && tab === 'balance' && (
        <p role="status" className={balance.isBalanced ? "notice success" : "notice error"}>
          {balance.isBalanced
            ? '✓ Assets equal liabilities plus equity.'
            : '⚠️ The ledger does not balance. Review account classification and postings.'}
        </p>
      )}
      {parsed.success && (
        <div className="table-scroll financial-table">
          <table>
            <thead>
              <tr>
                <th>Line item</th>
                <th>Amount ({state.currency})</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data).map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{key.replace(/([A-Z])/g, ' $1')}</th>
                  <td>
                    {typeof value === 'number'
                      ? value.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      : value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
