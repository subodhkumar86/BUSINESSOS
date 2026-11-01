import { useEffect, useRef, useState } from 'react'
import { request } from './api'

type Connector = {
  id: string
  version: number
  category: string
  provider: string
  status: string
  configuration: Record<string, string>
}
export function ConnectorsPanel({
  csrf,
  plan,
}: {
  csrf: string
  plan?: string
}) {
  const [items, setItems] = useState<Connector[]>([])
  const [selected, setSelected] = useState<Connector | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const saving = useRef(false)
  const load = async () =>
    setItems(
      (await request<{ connectors: Connector[] }>('/connectors')).connectors,
    )
  useEffect(() => {
    let active = true
    void request<{ connectors: Connector[] }>('/connectors')
      .then((result) => {
        if (active) setItems(result.connectors)
      })
      .catch((cause) => {
        if (active) setError(cause.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current) return
    const form = event.currentTarget,
      values = new FormData(form)
    saving.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request('/connectors', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          category: values.get('category'),
          provider: values.get('provider'),
          status: values.get('status'),
          ...(selected ? { version: selected.version } : {}),
          configuration: {
            sender: String(values.get('sender') || ''),
            webhookUrl: String(values.get('webhookUrl') || ''),
          },
          ...(values.get('apiKey')
            ? { credentials: { apiKey: String(values.get('apiKey')) } }
            : {}),
        }),
      })
      form.reset()
      setSelected(null)
      setMessage('Connector saved. Stored credentials remain hidden.')
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save connector.',
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card" aria-busy={busy || loading}>
      <h2>Tenant provider connectors</h2>
      <p>
        Save provider configuration and encrypted credentials here. Activating a
        record does not connect a provider; delivery uses the configured server
        adapter. Bank feeds require Enterprise.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">Loading connectors…</p>}
      <button
        disabled={busy || loading}
        onClick={async () => {
          setError('')
          setLoading(true)
          try {
            await load()
            setSelected(null)
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : 'Could not refresh connectors.',
            )
          } finally {
            setLoading(false)
          }
        }}
      >
        Refresh connectors
      </button>
      <form
        key={selected ? selected.id + selected.version : 'new'}
        onSubmit={(event) => void submit(event)}
      >
        <fieldset className="operations-fields" disabled={busy || loading}>
          <legend>
            {selected ? 'Edit ' + selected.provider : 'New connector'}
          </legend>
          <label>
            Category
            <select
              name="category"
              defaultValue={selected?.category || 'email'}
              aria-readonly={Boolean(selected)}
              onChange={(event) => {
                if (selected) event.target.value = selected.category
              }}
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="payment">Payment gateway</option>
              <option value="three_pl">3PL logistics</option>
              {(plan === 'enterprise' ||
                selected?.category === 'bank_feed') && (
                <option value="bank_feed">Live bank feed</option>
              )}
            </select>
          </label>
          <label>
            Provider
            <input
              name="provider"
              required
              maxLength={200}
              readOnly={Boolean(selected)}
              defaultValue={selected?.provider || ''}
              placeholder="e.g. SendGrid, Twilio, Meta"
            />
          </label>
          <label>
            Status
            <select
              name="status"
              aria-label="Status"
              defaultValue={selected?.status || 'draft'}
            >
              <option value="draft">Draft</option>
              <option value="sandbox">Sandbox</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            Sender / account ID
            <input
              name="sender"
              maxLength={200}
              defaultValue={selected?.configuration.sender || ''}
            />
          </label>
          <label>
            Webhook URL
            <input
              name="webhookUrl"
              type="url"
              maxLength={1000}
              defaultValue={selected?.configuration.webhookUrl || ''}
            />
          </label>
          <label>
            {selected
              ? 'Replace API key (leave blank to keep)'
              : 'API key / secret'}
            <input
              name="apiKey"
              type="password"
              maxLength={4000}
              autoComplete="new-password"
            />
          </label>
          <button className="primary">
            {busy
              ? 'Saving…'
              : selected
                ? 'Save connector changes'
                : 'Save connector'}
          </button>
          {selected && (
            <button type="button" onClick={() => setSelected(null)}>
              Cancel connector edit
            </button>
          )}
        </fieldset>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{row.category}</td>
                <td>{row.provider}</td>
                <td>{row.status}</td>
                <td>
                  <button
                    disabled={busy || loading}
                    onClick={() => {
                      setSelected(row)
                      setError('')
                      setMessage('')
                    }}
                  >
                    Edit {row.provider}
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && !loading && (
              <tr>
                <td colSpan={4}>No connectors configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
