import { useState } from 'react'
import { request } from './api'
export function Security({ csrf }: { csrf: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(path: string, body: unknown) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await request(path, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      })
      window.dispatchEvent(
        new CustomEvent('businessos:session-ended', {
          detail: 'All sessions have been signed out. Sign in again.',
        }),
      )
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not update security settings.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <h2>Account security</h2>
      <p>Changing your password signs you out on every device.</p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const values = Object.fromEntries(new FormData(e.currentTarget))
          if (values.newPassword !== values.confirmPassword) {
            setError('New passwords do not match.')
            return
          }
          void submit('/auth/password', {
            currentPassword: values.currentPassword,
            newPassword: values.newPassword,
          })
        }}
      >
        <label>
          Current password
          <input
            required
            name="currentPassword"
            type="password"
            maxLength={128}
            autoComplete="current-password"
          />
        </label>
        <label>
          New password
          <input
            required
            name="newPassword"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm new password
          <input
            required
            name="confirmPassword"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Please wait...' : 'Change password'}
        </button>
      </form>
      <hr />
      <h3>Sign out everywhere</h3>
      <p>End every existing session, including this one.</p>
      <button
        disabled={busy}
        onClick={() => void submit('/auth/revoke-sessions', {})}
      >
        Sign out all devices
      </button>
    </section>
  )
}
