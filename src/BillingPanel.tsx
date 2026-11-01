import { useEffect, useState } from 'react'
import { request } from './api'
import type { Entitlements } from './entitlements'
import type { Snapshot } from './types'

interface PlanTier {
  id: string
  name: string
  price: string
  period: string
  seats: number
  badge?: string
  features: string[]
}

const planTiers: PlanTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '₹45,000',
    period: 'per month',
    seats: 5,
    features: [
      'Core Finance, Invoices & Expenses',
      'Sales Pipeline & CRM Leads',
      'Inventory Control & Alerts',
      'Document Vault & Audit Trail',
      'Up to 5 Team Seats',
    ],
  },
  {
    id: 'business',
    name: 'Growth',
    price: '₹1,20,000',
    period: 'per month',
    seats: 25,
    badge: 'Popular',
    features: [
      'Everything in Starter, plus:',
      'HR & Statutory Payroll (PAYE/PenCom)',
      'Procurement & PO Approvals',
      'Multi-Location Warehouse Management',
      'Up to 25 Team Seats',
    ],
  },
  {
    id: 'business_pro',
    name: 'Business Pro',
    price: '₹2,80,000',
    period: 'per month',
    seats: 100,
    badge: 'Intelligence Tier',
    features: [
      'Everything in Growth, plus:',
      'Baseline financial scenarios',
      'Workflow rules and manual evaluations',
      'Branch directory and ordered approvals',
      'Up to 100 Team Seats',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: 'annual contract',
    seats: 1000,
    features: [
      'Dedicated instance & customisation options',
      'Optional live bank feeds and custom banking integrations',
      'Up to 1,000 team seats; capacity depends on deployment',
      '24/7 Dedicated Support SLA',
    ],
  },
]

const billingHistory = [
  {
    id: 'inv-2026-09',
    date: '1 Sep 2026',
    description: 'Business Pro Subscription · September 2026',
    amount: '₹2,80,000',
    status: 'Paid',
    method: 'Paystack Corporate Direct Debit',
  },
  {
    id: 'inv-2026-08',
    date: '1 Aug 2026',
    description: 'Business Pro Subscription · August 2026',
    amount: '₹2,80,000',
    status: 'Paid',
    method: 'Paystack Corporate Direct Debit',
  },
]

export function BillingPanel({ remote }: { remote: Snapshot | null }) {
  const [plan, setPlan] = useState<Entitlements | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    if (!remote) return
    request<Entitlements>('/billing/entitlements')
      .then((result) => {
        if (active) setPlan(result)
      })
      .catch((err) => {
        if (active) {
          setPlan(null)
          if (err instanceof Error && !err.message.includes('Sign in')) {
            setError(err.message)
          }
        }
      })
    return () => {
      active = false
    }
  }, [revision, remote])

  const activePlanId = plan?.plan || (remote ? 'Loading' : 'business_pro')
  const activeSeats = plan?.activeSeats ?? (remote ? 0 : 8)
  const maxSeats = plan?.seatLimit || (remote ? 0 : 100)
  const usagePercent = maxSeats ? Math.round((activeSeats / maxSeats) * 100) : 0
  const tiers = planTiers.map((tier) => {
    const configured = plan?.availablePlans?.find(
      (candidate) => candidate.id === tier.id,
    )
    if (!configured) return tier
    const labels: Record<string, string> = {
      core: 'Core workspace records',
      operations: 'Operational workflows',
      reports: 'Financial reports and exports',
      automation: 'Workflow rules and manual evaluations',
      forecast: 'Baseline scenario runs',
      bank_feeds:
        'Bank-feed adapter entitlement; provider configuration required',
    }
    return {
      ...tier,
      price: configured.price || tier.price,
      seats: configured.seatLimit,
      features: [
        ...configured.features.map((feature) => labels[feature] || feature),
        `Up to ${configured.seatLimit} team seats`,
      ],
    }
  })

  return (
    <div className="module-panel billing-panel">
      {/* Telemetry Row */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Current Plan</span>
          <b
            className="stat-value"
            style={{ textTransform: 'capitalize', color: '#4338ca' }}
          >
            {activePlanId.replace('_', ' ')}
          </b>
          <small>Active workspace license</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Team Seats</span>
          <b className="stat-value">
            {activeSeats} / {maxSeats}
          </b>
          <small>{maxSeats - activeSeats} seats available</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Subscription Status</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>
            Active
          </b>
          <small>Renews automatically 30 Sep</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Billing Currency</span>
          <b className="stat-value">INR (₹)</b>
          <small>
            {remote
              ? 'Subscription payment processing requires a billing provider.'
              : 'Browser demo'}
          </small>
        </div>
      </div>

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

      {/* Seat Utilization Bar */}
      <section className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <b>Seat Capacity Utilization</b>
          <span>
            {activeSeats} of {maxSeats} seats assigned ({usagePercent}%)
          </span>
        </div>
        <div
          style={{
            width: '100%',
            height: '10px',
            background: '#e2e8f0',
            borderRadius: '5px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${usagePercent}%`,
              height: '100%',
              background: '#6366f1',
              borderRadius: '5px',
            }}
          />
        </div>
        <small
          style={{
            display: 'block',
            marginTop: '6px',
            color: 'var(--text-muted)',
          }}
        >
          Disabled accounts do not consume seats. To add more users, invite team
          members from Settings or upgrade your plan.
        </small>
      </section>

      {/* Plan Tier Matrix */}
      <section className="card" style={{ marginTop: '16px' }}>
        <div
          className="section-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <h2>Subscription Tiers & Entitlements</h2>
            <small>
              Feature access and active seat caps are validated server-side
              across all API endpoints.
            </small>
          </div>
          <button type="button" onClick={() => setRevision((r) => r + 1)}>
            ↻ Refresh Entitlements
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginTop: '12px',
          }}
        >
          {tiers.map((tier) => {
            const isCurrent = tier.id === activePlanId
            return (
              <div
                key={tier.id}
                style={{
                  border: isCurrent ? '2px solid #6366f1' : '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '16px',
                  background: isCurrent ? '#fbfbfe' : 'white',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  {isCurrent && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '-10px',
                        right: '12px',
                        background: '#6366f1',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      CURRENT PLAN
                    </span>
                  )}
                  {tier.badge && !isCurrent && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '-10px',
                        right: '12px',
                        background: '#e0e7ff',
                        color: '#4338ca',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      {tier.badge}
                    </span>
                  )}
                  <h3 style={{ margin: '0 0 4px' }}>{tier.name}</h3>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      color: '#1e293b',
                    }}
                  >
                    {tier.price}
                  </div>
                  <small style={{ color: 'var(--text-muted)' }}>
                    {tier.period}
                  </small>

                  <ul
                    style={{
                      paddingLeft: '18px',
                      marginTop: '12px',
                      fontSize: '13px',
                      lineHeight: '1.5',
                    }}
                  >
                    {tier.features.map((f) => (
                      <li key={f} style={{ marginBottom: '4px' }}>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginTop: '16px' }}>
                  {isCurrent ? (
                    <button disabled style={{ width: '100%' }}>
                      ✓ Active Tier
                    </button>
                  ) : (
                    <button
                      className="primary"
                      style={{ width: '100%' }}
                      onClick={async () => {
                        if (!remote) {
                          setNotice(`Demo plan selection: ${tier.name}.`)
                          return
                        }
                        setError('')
                        setNotice('')
                        try {
                          await request('/billing/change-requests', {
                            method: 'POST',
                            headers: { 'X-CSRF-Token': remote.csrf },
                            body: JSON.stringify({ plan: tier.id }),
                          })
                          setNotice(
                            `Plan change request for ${tier.name} saved for administrator review. Your plan remains active until approved.`,
                          )
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : 'Could not request a plan change.',
                          )
                        }
                      }}
                    >
                      Select {tier.name}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Invoicing History */}
      <section className="card" style={{ marginTop: '16px' }}>
        <h2>Billing & Invoicing History</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Payment Method</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(remote ? [] : billingHistory).map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <b>{inv.id}</b>
                  </td>
                  <td>{inv.date}</td>
                  <td>{inv.description}</td>
                  <td>{inv.amount}</td>
                  <td>
                    <small>{inv.method}</small>
                  </td>
                  <td>
                    <span className="badge green">{inv.status}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        const url = URL.createObjectURL(
                          new Blob(
                            [
                              'BusinessOS demo receipt — no payment was processed.\n' +
                                inv.description +
                                '\n' +
                                inv.amount,
                            ],
                            { type: 'text/plain' },
                          ),
                        )
                        const link = document.createElement('a')
                        link.href = url
                        link.download = inv.id + '-demo.txt'
                        link.click()
                        setTimeout(() => URL.revokeObjectURL(url), 1000)
                      }}
                    >
                      Download demo receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {remote && (
            <p className="empty">
              No subscription invoices have been issued by a connected billing
              provider.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
