import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

const STEPS = [
  { id: 'profile', label: 'Set your business name', detail: 'Go to Settings and save your organisation name.' },
  { id: 'employee', label: 'Add your first employee', detail: 'Open HR & Payroll and add an employee record.' },
  { id: 'product', label: 'Add a product or service', detail: 'Open Inventory & Stock and add your first SKU.' },
  { id: 'invoice', label: 'Create your first invoice', detail: 'Open Finance & AR/AP and create a customer invoice.' },
  { id: 'bank', label: 'Connect a bank account', detail: 'Open Banking & Feeds and add a bank account.' },
  { id: 'team', label: 'Invite a team member', detail: 'Open Settings → Team and create a user account.' },
]

interface OnboardingState {
  completedSteps: string[]
  dismissed: boolean
}

export function OnboardingWizard({ remote, onNavigate }: { remote: Snapshot | null; onNavigate: (page: string) => void }) {
  const [state, setState] = useState<OnboardingState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!remote || remote.user.role !== 'owner') return
    request<OnboardingState>('/onboarding').then(setState).catch(() => undefined)
  }, [remote])

  if (!remote || remote.user.role !== 'owner' || !state || state.dismissed) return null
  const remaining = STEPS.filter((s) => !state.completedSteps.includes(s.id))
  if (!remaining.length) return null

  const complete = async (stepId: string) => {
    if (!remote || busy) return
    setBusy(true)
    try {
      await request('/onboarding', {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ completedStep: stepId }),
      })
      setState((prev) => prev ? { ...prev, completedSteps: [...prev.completedSteps, stepId] } : prev)
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async () => {
    if (!remote || busy) return
    setBusy(true)
    try {
      await request('/onboarding', {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ dismissed: true }),
      })
      setState((prev) => prev ? { ...prev, dismissed: true } : prev)
    } finally {
      setBusy(false)
    }
  }

  const done = STEPS.length - remaining.length
  const pct = Math.round((done / STEPS.length) * 100)

  return (
    <div className="card" style={{ borderLeft: '4px solid #6965dc', marginBottom: 16 }}>
      <div className="section-top">
        <div>
          <h2 style={{ margin: 0 }}>🚀 Get started with BusinessOS</h2>
          <small style={{ color: 'var(--text-muted)' }}>{done} of {STEPS.length} steps complete</small>
        </div>
        <button onClick={dismiss} disabled={busy} aria-label="Dismiss onboarding">×</button>
      </div>
      <div style={{ height: 6, background: '#eee', borderRadius: 3, margin: '8px 0 16px' }}>
        <div style={{ width: pct + '%', height: '100%', background: '#6965dc', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STEPS.map((step) => {
          const done = state.completedSteps.includes(step.id)
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: done ? 0.5 : 1 }}>
              <span style={{ fontSize: 18, minWidth: 24 }}>{done ? '✅' : '⬜'}</span>
              <div style={{ flex: 1 }}>
                <b style={{ textDecoration: done ? 'line-through' : 'none' }}>{step.label}</b>
                {!done && <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>{step.detail}</p>}
              </div>
              {!done && (
                <button
                  disabled={busy}
                  onClick={() => complete(step.id)}
                  style={{ fontSize: '0.8rem' }}
                >
                  Mark done
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
