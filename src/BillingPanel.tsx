import { useEffect, useState } from 'react'
import { request } from './api'
import type { Entitlements } from './entitlements'

export function BillingPanel() {
  const [plan, setPlan] = useState<Entitlements | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    request<Entitlements>('/billing/entitlements')
      .then((result) => {
        if (active) setPlan(result)
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : 'Could not load your plan.',
          )
      })
    return () => {
      active = false
    }
  }, [revision])
  return (
    <section className="card">
      <div className="section-top">
        <h2>Your workspace plan</h2>
        <button
          onClick={() => {
            setError('')
            setPlan(null)
            setRevision((value) => value + 1)
          }}
        >
          Refresh plan
        </button>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {!plan && !error && <p role="status">Loading plan...</p>}
      {plan && (
        <>
          <h3>{plan.plan.replaceAll('_', ' ')}</h3>
          <p>
            Up to {plan.seatLimit} active team accounts. Disabled accounts do
            not occupy seats.
          </p>
          <h3>Included features</h3>
          <ul>
            {plan.features.map((feature) => (
              <li key={feature}>{feature.replaceAll('_', ' ')}</li>
            ))}
          </ul>
          <p>
            This is your configured access plan. Payment collection and paid
            subscription management are not connected yet. Contact your
            administrator to review your plan.
          </p>
        </>
      )}
    </section>
  )
}
