import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

const STEPS = [
  { id: 'profile', page: 'settings', label: 'Set your business name', detail: 'Go to Settings and save your organisation name.' },
  { id: 'employee', page: 'hr', label: 'Add your first employee', detail: 'Open HR & Payroll and add an employee record.' },
  { id: 'product', page: 'inventory', label: 'Add a product or service', detail: 'Open Inventory & Stock and add your first SKU.' },
  { id: 'invoice', page: 'finance', label: 'Create your first invoice', detail: 'Open Finance & AR/AP and create a customer invoice.' },
  { id: 'bank', page: 'banking', label: 'Connect a bank account', detail: 'Open Banking & Feeds and add a bank account.' },
  { id: 'team', page: 'settings', label: 'Invite a team member', detail: 'Open Settings and create a user account.' },
]

interface OnboardingState {
  completedSteps: string[]
  dismissed: boolean
}

export function OnboardingWizard({
  remote,
  onNavigate,
}: {
  remote: Snapshot | null
  onNavigate: (page: string) => void
}) {
  const [state, setState] = useState<OnboardingState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!remote || remote.user.role !== 'owner') return
    request<OnboardingState>('/onboarding').then(setState).catch(() => undefined)
  }, [remote])

  if (!remote || remote.user.role !== 'owner' || !state || state.dismissed) return null
  const remaining = STEPS.filter((step) => !state.completedSteps.includes(step.id))
  if (!remaining.length) return null

  async function complete(stepId: string) {
    if (!remote || busy) return
    setBusy(true)
    try {
      await request('/onboarding', {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ completedStep: stepId }),
      })
      setState((previous) =>
        previous
          ? { ...previous, completedSteps: [...previous.completedSteps, stepId] }
          : previous,
      )
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    if (!remote || busy) return
    setBusy(true)
    try {
      await request('/onboarding', {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ dismissed: true }),
      })
      setState((previous) => (previous ? { ...previous, dismissed: true } : previous))
    } finally {
      setBusy(false)
    }
  }

  const completed = STEPS.length - remaining.length
  const progress = Math.round((completed / STEPS.length) * 100)

  return (
    <section className="card onboarding-card" aria-label="Workspace onboarding">
      <div className="section-top onboarding-header">
        <div>
          <h2>Get started with BusinessOS</h2>
          <small>{completed} of {STEPS.length} steps complete</small>
        </div>
        <button
          className="onboarding-dismiss"
          onClick={dismiss}
          disabled={busy}
          aria-label="Dismiss onboarding"
        >
          ×
        </button>
      </div>
      <div
        className="onboarding-progress"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div style={{ width: progress + '%' }} />
      </div>
      <div className="onboarding-steps">
        {STEPS.map((step) => {
          const isComplete = state.completedSteps.includes(step.id)
          const stepClass = isComplete
            ? 'onboarding-step is-done'
            : 'onboarding-step'
          return (
            <div key={step.id} className={stepClass}>
              <span className="onboarding-check" aria-hidden="true">
                {isComplete ? 'Done' : 'To do'}
              </span>
              <div className="onboarding-copy">
                <button
                  className="onboarding-link"
                  type="button"
                  onClick={() => onNavigate(step.page)}
                >
                  {step.label}
                </button>
                {!isComplete && <p>{step.detail}</p>}
              </div>
              {!isComplete && (
                <button
                  className="onboarding-action"
                  disabled={busy}
                  onClick={() => void complete(step.id)}
                >
                  Mark done
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
