import { useEffect, useState } from 'react'
import App from './App'
import { request, ApiError } from './api'
import type { Snapshot } from './types'
export default function Workspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [demo, setDemo] = useState(false),
    [loading, setLoading] = useState(true),
    [register, setRegister] = useState(false),
    [recover, setRecover] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    request<Snapshot>('/workspace')
      .then((s) => {
        if (active) setSnapshot(s)
      })
      .catch((e) => {
        if (active && (!(e instanceof ApiError) || e.status !== 401))
          setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    const end = (event: Event) => {
      setSnapshot(null)
      setError(String((event as CustomEvent).detail || 'Sign in again.'))
    }
    window.addEventListener('businessos:session-ended', end)
    return () => window.removeEventListener('businessos:session-ended', end)
  }, [])
  async function logout() {
    if (demo) {
      setDemo(false)
      return
    }
    try {
      await request('/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': snapshot!.csrf },
      })
      setSnapshot(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign out.')
    }
  }
  if (loading)
    return (
      <div className="auth-shell">
        <p role="status">Connecting to your workspace…</p>
      </div>
    )
  if (snapshot || demo)
    return (
      <>
        <div className="session-bar">
          <span>
            {demo
              ? 'Browser demo'
              : `${snapshot!.user.name} · ${snapshot!.user.role} · PostgreSQL workspace`}
          </span>
          {error && <span role="alert">{error}</span>}
          <button onClick={() => void logout()}>
            {demo ? 'Exit demo' : 'Sign out'}
          </button>
        </div>
        <App
          key={snapshot?.user.id || 'demo'}
          remote={snapshot}
          onSnapshot={(next) =>
            setSnapshot((current) =>
              current?.user.id === next.user.id ? next : current,
            )
          }
        />
      </>
    )
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand">
          <span className="logo">B</span>BusinessOS
        </div>
        <h1>{recover ? 'Recover your account' : register ? 'Create your workspace' : 'Welcome back'}</h1>
        <p>
          {recover
            ? 'Enter your email and we will send a secure reset link if the account exists.'
            : register
            ? 'Start with your organisation and owner account.'
            : 'Sign in to your business workspace.'}
        </p>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        {notice && <div role="status" className="notice">{notice}</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy) return
            setBusy(true)
            setError('')
            const values = Object.fromEntries(new FormData(e.currentTarget))
            try {
              if (recover) {
                await request('/auth/password-reset/request', {
                  method: 'POST',
                  body: JSON.stringify(values),
                })
                setNotice('If the account exists, a secure reset link will be sent.')
                return
              }
              const payload = register
                ? { ...values, sample: values.sample === 'on' }
                : values
              setSnapshot(
                await request<Snapshot>(
                  '/auth/' + (register ? 'register' : 'login'),
                  { method: 'POST', body: JSON.stringify(payload) },
                ),
              )
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Sign-in failed.')
            } finally {
              setBusy(false)
            }
          }}
        >
          {register && !recover && (
            <>
              <label>
                Your name
                <input
                  name="name"
                  required
                  maxLength={200}
                  autoComplete="name"
                />
              </label>
              <label>
                Organisation
                <input
                  name="organisation"
                  required
                  maxLength={200}
                  autoComplete="organization"
                />
              </label>
            </>
          )}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          {!recover && <label>
            Password
            <input
              name="password"
              type="password"
              minLength={register ? 12 : 1}
              maxLength={128}
              autoComplete={register ? 'new-password' : 'current-password'}
              required
            />
          </label>}
          {register && !recover && (
            <label className="task">
              <input type="checkbox" name="sample" /> Start with labelled sample
              records
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : recover ? 'Send reset link' : register ? 'Create workspace' : 'Sign in'}
          </button>
        </form>
        {!recover && <button
          className="text-button"
          onClick={() => {
            setRegister(!register)
            setError('')
          }}
        >
          {register
            ? 'Already have an account? Sign in'
            : 'Create a new workspace'}
        </button>}
        <button
          className="text-button"
          onClick={() => {
            setRecover(!recover)
            setRegister(false)
            setError('')
            setNotice('')
          }}
        >
          {recover ? 'Back to sign in' : 'Forgot password?'}
        </button>
        <hr />
        <button
          onClick={() => {
            setDemo(true)
            setError('')
          }}
        >
          Explore browser demo
        </button>
        <small>
          The demo stays in this browser. It is never uploaded automatically.
        </small>
      </div>
    </div>
  )
}
