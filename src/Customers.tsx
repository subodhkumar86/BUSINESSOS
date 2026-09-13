import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

interface Customer {
  id: string
  name: string
  email: string
  phone: string
  address: string
  tax_reference: string
  status: string
  marketing_opt_in: boolean
  version: number
}
interface Interaction {
  id: string
  kind: string
  summary: string
  occurred_at: string
  follow_up_on: string | null
  actor: string
}
const demoCustomerKey = 'businessos-demo-customers'
const demoInteractionKey = 'businessos-demo-customer-interactions'
export function Customers({ remote }: { remote: Snapshot | null }) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [history, setHistory] = useState<Interaction[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(Boolean(remote)),
    [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const editable = !remote || ['owner', 'sales_crm_user'].includes(remote.user.role)
  useEffect(() => {
    let active = true
    if (!remote) {
      try {
        const saved = JSON.parse(localStorage.getItem(demoCustomerKey) || '[]')
        if (active) setCustomers(Array.isArray(saved) ? saved : [])
      } catch { if (active) setCustomers([]) }
      setBusy(false)
      return
    }
    request<{ customers: Customer[] }>('/crm/customers')
      .then((data) => {
        if (active) setCustomers(data.customers)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [remote, revision])
  useEffect(() => {
    let active = true
    if (!selected) return
    if (!remote) {
      try {
        const saved = JSON.parse(localStorage.getItem(demoInteractionKey) || '{}')
        if (active) setHistory(Array.isArray(saved[selected.id]) ? saved[selected.id] : [])
      } catch { if (active) setHistory([]) }
      if (active) setLoadingHistory(false)
      return
    }
    request<{ interactions: Interaction[] }>(
      `/crm/customers/${selected.id}/interactions`,
    )
      .then((data) => {
        if (active) setHistory(data.interactions)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoadingHistory(false)
      })
    return () => {
      active = false
    }
  }, [selected, revision])
  async function save(form: HTMLFormElement, interaction = false) {
    if (busy) return
    const values = Object.fromEntries(new FormData(form))
    if (!remote) {
      if (interaction && selected) {
        const item: Interaction = { id: crypto.randomUUID(), kind: String(values.kind), summary: String(values.summary), occurred_at: new Date(String(values.occurredAt)).toISOString(), follow_up_on: values.followUpOn ? String(values.followUpOn) : null, actor: 'Demo owner' }
        setHistory((current) => {
          const next = [item, ...current]
          const all = JSON.parse(localStorage.getItem(demoInteractionKey) || '{}'); all[selected.id] = next
          localStorage.setItem(demoInteractionKey, JSON.stringify(all)); return next
        })
      } else {
        const customer: Customer = { id: selected?.id || crypto.randomUUID(), name: String(values.name), email: String(values.email || ''), phone: String(values.phone || ''), address: String(values.address || ''), tax_reference: String(values.taxReference || ''), status: String(values.status || 'active'), marketing_opt_in: values.marketingOptIn === 'on', version: (selected?.version || 0) + 1 }
        setCustomers((current) => {
          const next = selected ? current.map((item) => item.id === customer.id ? customer : item) : [customer, ...current]
          localStorage.setItem(demoCustomerKey, JSON.stringify(next)); return next
        })
        setSelected(null)
      }
      form.reset(); setNotice(interaction ? 'Demo interaction logged.' : 'Demo customer saved successfully.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const path =
        '/crm/customers' +
        (selected ? '/' + selected.id : '') +
        (interaction ? '/interactions' : '')
      await request(path, {
        method: selected && !interaction ? 'PATCH' : 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify(
          interaction
            ? {
                ...values,
                occurredAt: new Date(String(values.occurredAt)).toISOString(),
                followUpOn: values.followUpOn || null,
              }
            : { ...values, marketingOptIn: values.marketingOptIn === 'on', ...(selected ? { version: selected.version } : {}) },
        ),
      })
      if (!interaction) setSelected(null)
      form.reset()
      setNotice('Changes saved successfully.')
      setRevision((value) => value + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel operations-panel">
      <h2>Customers & interaction history</h2>
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            onClick={() => {
              setSelected(null)
              setError('')
              setRevision((v) => v + 1)
            }}
          >
            Refresh customers
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label>
        Search customers
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {busy && <p role="status">Loading data...</p>}
      {!busy && !customers.length && (
        <p>No records yet. Add your first customer to get started.</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Status</th>
            <th>Marketing</th>
            <th>Profile</th>
          </tr>
        </thead>
        <tbody>
          {customers
            .filter((customer) =>
              `${customer.name} ${customer.email} ${customer.phone}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((customer) => (
              <tr key={customer.id}>
                <td>{customer.name}</td>
                <td>{customer.email || '—'}</td>
                <td>{customer.phone || '—'}</td>
                <td>{customer.status}</td>
                <td>{customer.marketing_opt_in ? 'Opted in' : 'No consent'}</td>
                <td>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setHistory([])
                      setLoadingHistory(true)
                      setSelected(customer)
                      setError('')
                      setNotice('')
                    }}
                  >
                    Open {customer.name}
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {selected && (
        <>
          <h3>{selected.name}</h3>
          <p>{selected.address || 'No address recorded.'}</p>
          <p>Tax reference: {selected.tax_reference || 'Not recorded'}</p>
          <button onClick={() => setSelected(null)}>
            Close profile / add customer
          </button>
        </>
      )}
      {editable && (
        <form
          key={selected?.id || 'new'}
          onSubmit={(event) => {
            event.preventDefault()
            void save(event.currentTarget)
          }}
        >
          <fieldset disabled={busy} className="operations-fields">
            <legend>{selected ? 'Edit customer' : 'Add customer'}</legend>
            <label>
              Name
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={selected?.name}
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                maxLength={254}
                defaultValue={selected?.email}
              />
            </label>
            <label>
              Phone
              <input
                name="phone"
                maxLength={50}
                defaultValue={selected?.phone}
              />
            </label>
            <label>
              Address
              <input
                name="address"
                maxLength={1000}
                defaultValue={selected?.address}
              />
            </label>
            <label>
              Tax reference
              <input
                name="taxReference"
                maxLength={200}
                defaultValue={selected?.tax_reference}
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={selected?.status || 'active'}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label><input name="marketingOptIn" type="checkbox" defaultChecked={selected?.marketing_opt_in || false} /> Customer has consented to marketing messages</label>
            <button type="submit">Save customer</button>
          </fieldset>
        </form>
      )}
      {selected && (
        <>
          <h3>Interaction history</h3>
          {loadingHistory ? (
            <p role="status">Loading interactions...</p>
          ) : !history.length ? (
            <p>No interactions recorded.</p>
          ) : (
            <ul>
              {history.map((item) => (
                <li key={item.id}>
                  <strong>{item.kind}</strong> ·{' '}
                  {new Date(item.occurred_at).toLocaleString()} · {item.actor}
                  <p>{item.summary}</p>
                  {item.follow_up_on && (
                    <p>Follow up: {item.follow_up_on.slice(0, 10)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void save(event.currentTarget, true)
              }}
            >
              <fieldset disabled={busy} className="operations-fields">
                <legend>Log interaction</legend>
                <label>
                  Type
                  <select name="kind">
                    {['note', 'call', 'email', 'meeting'].map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Occurred at (local time)
                  <input name="occurredAt" type="datetime-local" required />
                </label>
                <label>
                  Summary
                  <textarea name="summary" required maxLength={2000} />
                </label>
                <label>
                  Follow-up date
                  <input name="followUpOn" type="date" />
                </label>
                <button type="submit">Log interaction</button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </section>
  )
}
