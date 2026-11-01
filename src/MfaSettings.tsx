import { useEffect, useState } from 'react'
import { request } from './api'

export function MfaSettings({ csrf }: { csrf: string }) {
  const [enabled, setEnabled] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState(''),
    [message, setMessage] = useState('')
  const headers = { 'X-CSRF-Token': csrf }
  useEffect(() => {
    let active = true
    request<{ enabled: boolean }>('/auth/mfa')
      .then((result) => {
        if (active) setEnabled(result.enabled)
      })
      .catch((error) => {
        if (active) setMessage(error.message)
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <section className="mfa-settings">
      <h3>Authenticator app</h3>
      <p>
        {loaded
          ? enabled
            ? 'MFA is enabled for your account.'
            : 'MFA is not enabled for your account.'
          : 'Loading MFA settings…'}
      </p>
      {!enabled && (
        <button
          disabled={busy || !loaded}
          onClick={async () => {
            setBusy(true)
            setMessage('')
            try {
              const result = await request<{ secret: string }>('/auth/mfa', {
                method: 'POST',
                headers,
              })
              setSecret(result.secret)
              setMessage(
                'Add this secret to an authenticator app and confirm its generated code.',
              )
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : 'Could not start MFA setup.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          Set up MFA
        </button>
      )}
      {secret && (
        <p>
          Authenticator secret: <code>{secret}</code>
        </p>
      )}
      {(secret || enabled) && (
        <form
          className="operations-fields"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            const data = new FormData(event.currentTarget)
            setBusy(true)
            setMessage('')
            try {
              await request(enabled ? '/auth/mfa' : '/auth/mfa/confirm', {
                method: enabled ? 'DELETE' : 'POST',
                headers,
                body: JSON.stringify({
                  code: data.get('code'),
                  currentPassword: data.get('currentPassword'),
                }),
              })
              setSecret('')
              window.dispatchEvent(
                new CustomEvent('businessos:session-ended', {
                  detail: 'MFA settings updated. Sign in again.',
                }),
              )
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : 'Could not update MFA.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            Authenticator code
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
          </label>
          <button disabled={busy}>
            {enabled ? 'Disable MFA' : 'Confirm MFA enrollment'}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
