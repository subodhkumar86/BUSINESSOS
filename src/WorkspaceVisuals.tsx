import type { State } from './types'
import { useState } from 'react'
import { formatMoney } from './currency'

export function AuthPreview() {
  return (
    <div className="auth-preview" aria-hidden="true">
      <div className="preview-top">
        <span>
          <i /> ACME WORKSPACE
        </span>
        <span>Sample overview ↗</span>
      </div>
      <div className="preview-balance">
        <span>Everything, in perspective.</span>
        <strong>
          ₹52,28,500<span>Cash position</span>
        </strong>
        <span className="preview-pill">A clear view of your business</span>
      </div>
      <svg viewBox="0 0 480 130" fill="none">
        <defs>
          <linearGradient id="auth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#7be0c3" stopOpacity=".3" />
            <stop offset="1" stopColor="#7be0c3" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 110C40 115 45 64 90 78S135 95 180 52S230 85 275 47S330 65 375 25S435 36 480 8V130H0Z"
          fill="url(#auth-fill)"
        />
        <path
          d="M0 110C40 115 45 64 90 78S135 95 180 52S230 85 275 47S330 65 375 25S435 36 480 8"
          stroke="#8ce8cc"
          strokeWidth="3"
        />
      </svg>
      <div className="preview-bottom">
        <span>
          <b>Finance</b>In balance
        </span>
        <span>
          <b>Operations</b>In motion
        </span>
        <span>
          <b>Your team</b>In sync
        </span>
      </div>
    </div>
  )
}

export function DemoInsights({ state }: { state: State }) {
  const [selectedMonth, setSelectedMonth] = useState('Nov')
  const money = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: state.currency,
      maximumFractionDigits: 0,
    }).format(value)
  const values = [
    { month: 'Jun', revenue: 320, expenses: 180 },
    { month: 'Jul', revenue: 410, expenses: 240 },
    { month: 'Aug', revenue: 365, expenses: 205 },
    { month: 'Sep', revenue: 560, expenses: 295 },
    { month: 'Oct', revenue: 485, expenses: 250 },
    { month: 'Nov', revenue: 640, expenses: 315 },
  ]
  const selected = values.find((value) => value.month === selectedMonth)!
  return (
    <div className="insight-grid">
      <section className="card cashflow-card">
        <div className="section-top">
          <div>
            <span className="eyebrow">THE BIGGER PICTURE</span>
            <h2>Business momentum</h2>
            <p>Illustrative monthly cash flow · demo data</p>
          </div>
          <span className="chart-period">Last 6 months ↘</span>
        </div>
        <div className="chart-legend">
          <span>
            <i />
            Revenue
          </span>
          <span>
            <i />
            Expenses
          </span>
          <small>{state.currency} · select a month</small>
        </div>
        <div
          className="cashflow-plot"
          role="group"
          aria-label="Sample monthly revenue and expenses chart from June to November"
        >
          <div className="chart-gridlines">
            <span>7.5L</span>
            <span>5L</span>
            <span>2.5L</span>
            <span>0</span>
          </div>
          <div className="cashflow-bars">
            {values.map((value) => (
              <button type="button" className="month-bars" key={value.month}
                aria-label={`${value.month}: revenue ${formatMoney(value.revenue * 1000, state.currency)}, expenses ${formatMoney(value.expenses * 1000, state.currency)}`}
                aria-pressed={selectedMonth === value.month}
                onClick={() => setSelectedMonth(value.month)}>
                <div>
                  <i
                    style={{ height: `${value.revenue / 7.5}%` }}
                    title={`Revenue ${value.revenue}k`}
                  />
                  <i
                    style={{ height: `${value.expenses / 7.5}%` }}
                    title={`Expenses ${value.expenses}k`}
                  />
                </div>
                <span>{value.month}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="cashflow-detail" aria-live="polite" aria-atomic="true">
          <span><small>{selected.month} revenue</small><b>{formatMoney(selected.revenue * 1000, state.currency)}</b></span>
          <span><small>Expenses</small><b>{formatMoney(selected.expenses * 1000, state.currency)}</b></span>
          <span><small>Net cash flow</small><b>{formatMoney((selected.revenue - selected.expenses) * 1000, state.currency)}</b></span>
        </div>
      </section>
      <section className="card priorities-card">
        <div className="section-top">
          <div>
            <span className="eyebrow">YOUR NEXT MOVES</span>
            <h2>A little focus goes a long way.</h2>
          </div>
          <span className="focus-mark">↗</span>
        </div>
        <div className="focus-item">
          <span className="focus-icon amber">↙</span>
          <div>
            <b>Bring collections forward</b>
            <p>
              {state.invoices.filter((row) => row.status === 'Unpaid').length}{' '}
              invoices ready for follow-up
            </p>
          </div>
        </div>
        <div className="focus-item">
          <span className="focus-icon teal">▦</span>
          <div>
            <b>Keep shelves ready</b>
            <p>
              {state.products.filter((row) => row.qty < row.min).length}{' '}
              products below reorder level
            </p>
          </div>
        </div>
        <div className="focus-total">
          <span>Open pipeline</span>
          <strong>
            {money(
              state.leads
                .filter((row) => !['Won', 'Lost'].includes(row.status))
                .reduce((sum, row) => sum + row.amount, 0),
            )}
          </strong>
          <span>Small actions. Steady progress.</span>
        </div>
      </section>
    </div>
  )
}

export function DemoControlPreview() {
  return (
    <section className="panel">
      <div className="section-top">
        <div>
          <p className="eyebrow">SAMPLE WORKSPACE CONTROLS</p>
          <h2>Approvals & branch directory</h2>
          <p>Explore an example of how your workspace stays organised.</p>
        </div>
        <span className="badge green">Demo data</span>
      </div>
      <div className="demo-control-grid">
        <article className="card">
          <span className="eyebrow">BRANCHES</span>
          <h3>Head office</h3>
          <p>HO-001 · Main operations</p>
          <hr />
          <h3>Distribution hub</h3>
          <p>WH-002 · Inventory & dispatch</p>
        </article>
        <article className="card">
          <span className="eyebrow">PURCHASE APPROVAL</span>
          <h3>Standard purchasing</h3>
          <p>Orders above ₹1,00,000</p>
          <ol className="approval-steps">
            <li>Operations manager review</li>
            <li>Business owner approval</li>
            <li>Goods receipt & stock update</li>
          </ol>
        </article>
        <article className="card">
          <span className="eyebrow">RECENT ACTIVITY</span>
          <h3>Keeping everyone in the loop.</h3>
          <p>Quarterly supplier review · Pending</p>
          <p>Branch stock audit · Approved</p>
          <p>Team equipment request · Approved</p>
          <small>Sign in to configure real approval chains.</small>
        </article>
      </div>
    </section>
  )
}
