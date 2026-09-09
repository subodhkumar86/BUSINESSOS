import { useEffect, useState } from 'react'
import { request } from './api'
interface Plan {
  id: string
  name: string
  price: string
  features: string[]
  seat_limit: number
}
interface Tenant {
  id: string
  name: string
  currency: string
  plan_id: string
  seats: number
}
export function AdminConsole({
  currentRole,
  csrf,
}: {
  currentRole?: string
  csrf?: string
}) {
  const [plans, setPlans] = useState<Plan[]>([]),
    [tenants, setTenants] = useState<Tenant[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [offset, setOffset] = useState(0),
    [nextOffset, setNextOffset] = useState<number | null>(null)
  useEffect(() => {
    if (currentRole !== 'super_admin') return
    let active = true
    Promise.all([
      request<{ plans: Plan[] }>('/admin/plans'),
      request<{ tenants: Tenant[]; nextOffset: number | null }>(
        '/admin/tenants?offset=' + offset,
      ),
    ])
      .then(([planData, tenantData]) => {
        if (active) {
          setPlans(planData.plans)
          setTenants(tenantData.tenants)
          setNextOffset(tenantData.nextOffset)
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load platform data.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [currentRole, revision, offset])
  if (currentRole !== 'super_admin')
    return <p role="alert">Platform administrator access is required.</p>
  async function save(
    event: React.FormEvent<HTMLFormElement>,
    path: string,
    data: (form: FormData) => unknown,
  ) {
    event.preventDefault()
    if (busy || !csrf) return
    const input = data(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await request(path, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': csrf },
        body: JSON.stringify(input),
      })
      setNotice('Changes saved.')
      setRevision((v) => v + 1)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save changes.',
      )
      setRevision((v) => v + 1)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="admin-console">
      <h2>Platform administration</h2>
      <p>
        Manage tenant subscriptions and plan entitlements. The directory exposes
        business identity and seat counts.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy} onClick={() => setRevision((v) => v + 1)}>
        Refresh
      </button>
      {loading && <p role="status">Loading platform data...</p>}
      <section className="card">
        <h3>Tenant directory</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Currency</th>
                <th>Active seats</th>
                <th>Assigned plan</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    {tenant.name}
                    <small>{tenant.id}</small>
                  </td>
                  <td>{tenant.currency}</td>
                  <td>{tenant.seats}</td>
                  <td>
                    <form
                      key={tenant.plan_id}
                      onSubmit={(event) =>
                        void save(
                          event,
                          '/admin/tenants/' + tenant.id + '/plan',
                          (form) => ({
                            planId: form.get('planId'),
                            expectedPlanId: tenant.plan_id,
                          }),
                        )
                      }
                    >
                      <label>
                        Plan for {tenant.name}
                        <select name="planId" defaultValue={tenant.plan_id}>
                          {plans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button disabled={busy || !csrf}>Assign plan</button>
                    </form>
                  </td>
                </tr>
              ))}
              {!loading && !tenants.length && (
                <tr>
                  <td colSpan={4}>No tenants found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          disabled={offset === 0}
          onClick={() => setOffset((v) => Math.max(0, v - 100))}
        >
          Previous
        </button>
        <button
          disabled={nextOffset === null}
          onClick={() => setOffset(nextOffset!)}
        >
          Next
        </button>
      </section>
      <section className="card">
        <h3>Plan configuration</h3>
        <p>
          Prices are configuration values. Saving them does not collect
          subscription payments.
        </p>
        {plans.map((plan) => (
          <form
            key={plan.id + '-' + revision}
            className="operations-fields"
            onSubmit={(event) =>
              void save(event, '/admin/plans', (form) => ({
                id: plan.id,
                price: form.get('price'),
                seatLimit: Number(form.get('seatLimit')),
                features: form.getAll('features'),
              }))
            }
          >
            <h4>{plan.name}</h4>
            <label>
              Price label
              <input
                name="price"
                defaultValue={plan.price}
                required
                maxLength={160}
              />
            </label>
            <label>
              Seat limit
              <input
                name="seatLimit"
                type="number"
                min="1"
                max="100000"
                defaultValue={plan.seat_limit}
                required
              />
            </label>
            <fieldset>
              <legend>Enabled features</legend>
              {['core', 'operations', 'reports', 'automation', 'forecast'].map(
                (feature) => (
                  <label key={feature}>
                    <input
                      name="features"
                      type="checkbox"
                      value={feature}
                      defaultChecked={plan.features.includes(feature)}
                    />
                    {feature}
                  </label>
                ),
              )}
            </fieldset>
            <button disabled={busy || !csrf}>Save {plan.name}</button>
          </form>
        ))}
      </section>
    </div>
  )
}
