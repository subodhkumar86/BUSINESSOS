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
interface PlatformOverview {
  tenantsCount: number
  usersCount: number
  version: string
  status: string
  database: string
  redis: string
  aiEngine: string
}
interface Health {
  status: string
  uptime: number
  timestamp: string
  checks: Record<string, { ok: boolean; latencyMs: number; engine: string }>
  tenant: { active_users: number; audit_events: number; bank_transactions: number }
}
const sections = [
  ['overview', 'Overview'], ['tenants', 'Tenants & users'], ['plans', 'Plans'],
  ['integrations', 'Integrations'], ['connectors', 'Bank connectors'], ['ai-controls', 'AI controls'],
  ['support', 'Support'], ['audit', 'Audit logs'], ['security', 'Security & settings'],
] as const
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
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [overview, setOverview] = useState<PlatformOverview | null>(null),
    [health, setHealth] = useState<Health | null>(null),
    [integrationCount, setIntegrationCount] = useState<number | null>(null),
    [aiSettings, setAiSettings] = useState<Record<string, unknown> | null>(null),
    [section, setSection] = useState(() => location.pathname.split('/')[2] || 'overview')
  useEffect(() => {
    if (currentRole !== 'super_admin') return
    let active = true
    Promise.all([
      request<{ plans: Plan[] }>('/admin/plans'),
      request<{ tenants: Tenant[]; nextOffset: number | null }>(
        '/admin/tenants?offset=' + offset,
      ),
      request<PlatformOverview>('/admin/overview'),
      request<Health>('/admin/health/detailed'),
      request<{ integrations: unknown[] }>('/admin/integrations'),
      request<{ settings: Record<string, unknown> }>('/admin/ai-controls'),
    ])
      .then(([planData, tenantData, overviewData, healthData, integrationsData, aiData]) => {
        if (active) {
          setPlans(planData.plans)
          setTenants(tenantData.tenants)
          setNextOffset(tenantData.nextOffset)
          setOverview(overviewData)
          setHealth(healthData)
          setIntegrationCount(integrationsData.integrations.length)
          setAiSettings(aiData.settings)
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
  useEffect(() => {
    const syncSection = () => setSection(location.pathname.split('/')[2] || 'overview')
    addEventListener('popstate', syncSection)
    return () => removeEventListener('popstate', syncSection)
  }, [])
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
  function selectSection(id: string) {
    history.pushState({}, '', id === 'overview' ? '/admin' : '/admin/' + id)
    setSection(id)
  }
  return (
    <div className="admin-console">
      <h2>Platform administration</h2>
      <p>
        Govern tenants, subscriptions, operational controls and platform health
        from one restricted workspace.
      </p>
      <nav className="flex flex-wrap gap-2" aria-label="Platform administration sections">
        {sections.map(([id, label]) => (
          <button key={id} className={section === id ? 'is-active' : ''} onClick={() => selectSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy} onClick={() => setRevision((v) => v + 1)}>
        Refresh
      </button>
      {loading && <p role="status">Loading platform data...</p>}
      {(section === 'overview' || section === 'security' || section === 'audit') && <section className="card">
        <h3>{section === 'overview' ? 'Platform overview' : section === 'audit' ? 'Audit-ready platform status' : 'Security & service health'}</h3>
        {overview && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <p><strong>{overview.tenantsCount}</strong><br />tenants visible</p>
          <p><strong>{overview.usersCount}</strong><br />users in administrator tenant</p>
          <p><strong>{overview.status}</strong><br />service state</p>
          <p><strong>v{overview.version}</strong><br />application version</p>
        </div>}
        {health && <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {Object.entries(health.checks).map(([name, check]) => <p key={name}><strong>{name}: {check.ok ? 'healthy' : 'attention needed'}</strong><br />{check.engine} · {check.latencyMs} ms</p>)}
          <p><strong>{health.tenant.audit_events}</strong><br />tenant audit events retained</p>
          <p><strong>{health.tenant.bank_transactions}</strong><br />bank transactions monitored</p>
        </div>}
      </section>}
      {(section === 'overview' || section === 'tenants') && <section className="card">
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
      </section>}
      {(section === 'overview' || section === 'plans') && <section className="card">
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
              {['core', 'operations', 'reports', 'automation', 'forecast', 'bank_feeds'].map(
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
      </section>}
      {(section === 'integrations' || section === 'connectors' || section === 'ai-controls' || section === 'support') && <section className="card">
        {section === 'integrations' && <><h3>Integration governance</h3><p>{integrationCount ?? 0} provider integrations are configured. Provider credentials stay server-side and are never exposed in this console.</p></>}
        {section === 'connectors' && <><h3>Bank connector control</h3><p>Bank feeds are tenant-scoped. Connectors require provider credentials and consent configuration before live synchronisation can be enabled.</p></>}
        {section === 'ai-controls' && <><h3>AI controls</h3>{aiSettings && <dl>{Object.entries(aiSettings).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}<p>AI responses are traceable and advisory; no high-impact action is automatically approved.</p></>}
        {section === 'support' && <><h3>Support operations</h3><p>Use the Support workspace to triage tenant tickets, customer feedback and service response targets. No customer message is shared between tenants.</p></>}
      </section>}
    </div>
  )
}
