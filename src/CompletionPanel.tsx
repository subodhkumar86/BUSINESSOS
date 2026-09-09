import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

export function CompletionPanel({ remote }: { remote: Snapshot | null }) {
  const [data, setData] = useState<Record<string, unknown[]>>({})
  const [form, setForm] = useState({ branchName: '', branchCode: '', chainName: '', chainScope: 'purchase_order', notifyRecipient: '', notifyBody: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const csrf = remote?.csrf || ''
  const authed = Boolean(remote)
  const load = async () => {
    if (!remote) return
    setError('')
    try {
      const [branches, chains, requests, forecasts, outbox] = await Promise.all([
        request<{ branches: unknown[] }>('/branches'),
        request<{ chains: unknown[] }>('/approvals/chains'),
        request<{ requests: unknown[] }>('/approvals/requests'),
        request<{ forecasts: unknown[] }>('/ai/forecasts'),
        request<{ messages: unknown[] }>('/notifications/outbox').catch(() => ({ messages: [] as unknown[] })),
      ])
      setData({ branches: branches.branches, chains: chains.chains, requests: requests.requests, forecasts: forecasts.forecasts, outbox: outbox.messages })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load completion data.') }
  }
  useEffect(() => { void load() }, [remote])
  const post = async (path: string, body: unknown) => {
    setError(''); setNotice('')
    try {
      await request(path, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })
      setNotice('Changes saved successfully.')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed.') }
  }
  if (!authed) return <section className="panel"><h2>Approvals, branches and delivery</h2><p>Sign in to manage completion workflows.</p></section>
  return (
    <section className="panel">
      <h2>Approvals, branches, forecasts and delivery</h2>
      <p>Configurable approval chains, branch scoping, reproducible forecasts and the notification outbox share one audited screen.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3>Branches ({(data.branches || []).length})</h3>
      <div className="operations-fields">
        <label>Branch name<input value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })} /></label>
        <label>Code<input value={form.branchCode} onChange={(e) => setForm({ ...form, branchCode: e.target.value })} /></label>
        <button className="primary" onClick={() => void post('/branches', { name: form.branchName || 'New branch', code: form.branchCode || 'NB1' })}>Add branch</button>
      </div>
      <h3>Approval chains ({(data.chains || []).length})</h3>
      <div className="operations-fields">
        <label>Chain name<input value={form.chainName} onChange={(e) => setForm({ ...form, chainName: e.target.value })} /></label>
        <label>Scope<select value={form.chainScope} onChange={(e) => setForm({ ...form, chainScope: e.target.value })}><option value="purchase_order">purchase_order</option><option value="payroll">payroll</option><option value="payment">payment</option><option value="master_data">master_data</option></select></label>
        <button className="primary" onClick={() => void post('/approvals/chains', { name: form.chainName || 'Custom chain', scope: form.chainScope, steps: [{ role: 'operations_manager' }, { role: 'owner' }] })}>Add chain</button>
      </div>
      <h3>Forecast runs ({(data.forecasts || []).length})</h3>
      <div className="operations-fields">
        {['cash', 'pipeline', 'inventory'].map((metric) => (
          <button key={metric} onClick={() => void post('/ai/forecast', { metric })}>Run {metric} forecast</button>
        ))}
      </div>
      <h3>Notification outbox ({(data.outbox || []).length})</h3>
      <div className="operations-fields">
        <label>Recipient<input value={form.notifyRecipient} onChange={(e) => setForm({ ...form, notifyRecipient: e.target.value })} /></label>
        <label>Message<input value={form.notifyBody} onChange={(e) => setForm({ ...form, notifyBody: e.target.value })} /></label>
        <button className="primary" onClick={() => void post('/notifications/outbox', { channel: 'email', recipient: form.notifyRecipient || 'ops@example.test', body: form.notifyBody || 'Operational update' })}>Queue message</button>
      </div>
      <h3>Pending approvals ({(data.requests || []).length})</h3>
      <div className="table-scroll"><table><thead><tr><th>Entity</th><th>Scope</th><th>Status</th><th>Chain</th></tr></thead><tbody>
        {(data.requests as { id: string; entity_id: string; entity_type: string; status: string; chain_name: string }[] || []).slice(0, 20).map((row) => (
          <tr key={row.id}><td>{row.entity_type} · {row.entity_id.slice(0, 8)}</td><td>{row.chain_name}</td><td>{row.status}</td><td><button onClick={() => void post('/approvals/requests/' + row.id, { version: 1, decision: 'approve' })}>Approve step</button></td></tr>
        ))}
      </tbody></table></div>
      <p><button onClick={() => void load()}>Refresh completion data</button></p>
    </section>
  )
}
