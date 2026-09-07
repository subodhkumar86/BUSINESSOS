import { useState } from 'react'
import { request } from './api'

export function PasswordReset({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    return params.get('token') || ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand">
          <span className="logo">B</span>BusinessOS
        </div>
        <h1>{complete ? 'Password updated' : 'Reset your password'}</h1>
        {complete ? (
          <p role="status">
            Your previous sessions have ended. Sign in with your new password.
          </p>
        ) : (
          <>
            <p>
              Enter your reset code and choose a new password. Codes expire
              after 30 minutes and can be used once.
            </p>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                if (busy) return
                const values = new FormData(event.currentTarget)
                if (
                  values.get('newPassword') !== values.get('confirmPassword')
                ) {
                  setError('New passwords do not match.')
                  return
                }
                setBusy(true)
                setError('')
                try {
                  await request('/auth/password-reset/confirm', {
                    method: 'POST',
                    body: JSON.stringify({
                      token: token.trim(),
                      newPassword: values.get('newPassword'),
                    }),
                  })
                  setToken('')
                  window.history.replaceState({}, '', '/reset-password')
                  setComplete(true)
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : 'Could not reset your password.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              <label>
                Reset code
                <input
                  name="token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                New password
                <input
                  name="newPassword"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  name="confirmPassword"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? 'Updating password…' : 'Reset password'}
              </button>
            </form>
          </>
        )}
        <button className="text-button" disabled={busy} onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </div>
  )
}
