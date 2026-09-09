import { useEffect, useMemo, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

type Status = 'active' | 'paused'
interface Rule { id: string; name: string; trigger: string; action: string; target: string; status: Status; updatedAt?: string }
interface Log { id: string; ruleName: string; details: string; status: string; createdAt?: string }
interface Stored { id: string; name: string; detail: string; status: string; metadata: Record<string, unknown>; created_at: string; updated_at: string }

const demoRules: Rule[] = [
  { id: 'demo-stock', name: 'Low-stock review', trigger: 'Inventory falls below reorder level', action: 'Create a procurement review task', target: 'Inventory', status: 'active' },
  { id: 'demo-invoice', name: 'Overdue receivable reminder', trigger: 'Invoice is overdue', action: 'Queue a customer reminder for review', target: 'Finance & CRM', status: 'active' },
]
const dateLabel = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet run'
function storedRule(row: Stored): Rule | null { if (row.metadata.kind !== 'rule') return null; return { id: row.id, name: row.name, trigger: String(row.metadata.trigger || row.detail), action: String(row.metadata.action || ''), target: String(row.metadata.target || 'Operations'), status: row.status === 'paused' ? 'paused' : 'active', updatedAt: row.updated_at } }
function storedLog(row: Stored): Log | null { if (row.metadata.kind !== 'execution') return null; return { id: row.id, ruleName: row.name, details: row.detail, status: row.status, createdAt: row.created_at } }

export function AutomationPanel({ remote }: { remote: Snapshot | null }) {
  const [rules, setRules] = useState<Rule[]>(remote ? [] : demoRules)
  const [logs, setLogs] = useState<Log[]>([])
  const [name, setName] = useState(''), [trigger, setTrigger] = useState(''), [action, setAction] = useState(''), [target, setTarget] = useState('Operations')
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const editable = !remote || remote.user.role !== 'auditor'
  const headers: Record<string, string> = remote ? { 'X-CSRF-Token': remote.csrf } : {}
  async function load() {
    if (!remote) return
    try { const data = await request<{ records: Stored[] }>('/modules/automation'); setRules(data.records.map(storedRule).filter((item): item is Rule => Boolean(item))); setLogs(data.records.map(storedLog).filter((item): item is Log => Boolean(item))) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load automation.') }
  }
  useEffect(() => { void load() }, [remote])
  const active = useMemo(() => rules.filter(rule => rule.status === 'active').length, [rules])
  async function createRule(event: React.FormEvent) {
    event.preventDefault(); if (!name.trim() || !trigger.trim() || !action.trim()) return setError('Enter a name, trigger, and action.')
    setBusy(true); setError(''); setNotice(''); const rule: Rule = { id: 'local-' + Date.now(), name: name.trim(), trigger: trigger.trim(), action: action.trim(), target, status: 'active' }
    try { if (remote) { const saved = await request<Stored>('/modules/automation', { method: 'POST', headers, body: JSON.stringify({ name: rule.name, detail: rule.trigger, status: rule.status, metadata: { kind: 'rule', trigger: rule.trigger, action: rule.action, target: rule.target } }) }); rule.id = saved.id }; setRules(current => [rule, ...current]); setName(''); setTrigger(''); setAction(''); setNotice('Workflow rule saved.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save workflow.') } finally { setBusy(false) }
  }
  async function toggle(rule: Rule) { const status: Status = rule.status === 'active' ? 'paused' : 'active'; try { if (remote) await request('/modules/automation/' + rule.id, { method: 'PATCH', headers, body: JSON.stringify({ status }) }); setRules(current => current.map(item => item.id === rule.id ? { ...item, status } : item)); setNotice(`Workflow ${status}.`) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update workflow.') } }
  async function testRun(rule: Rule) { const log: Log = { id: 'local-log-' + Date.now(), ruleName: rule.name, status: 'success', details: 'Manual evaluation completed. No external message or payment was dispatched.', createdAt: new Date().toISOString() }; try { if (remote) { const saved = await request<Stored>('/modules/automation', { method: 'POST', headers, body: JSON.stringify({ name: rule.name, detail: log.details, status: log.status, metadata: { kind: 'execution', ruleId: rule.id, manual: true } }) }); log.id = saved.id; log.createdAt = saved.created_at }; setLogs(current => [log, ...current]); setNotice('Test run recorded. It did not perform an external action.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record test run.') } }
  return <div className="module-panel">
    <div className="stats-row"><div className="stat-card"><span className="stat-label">Active workflows</span><b className="stat-value">{active}</b><small>Persisted rules</small></div><div className="stat-card"><span className="stat-label">Recorded runs</span><b className="stat-value">{logs.length}</b><small>Manual evaluation history</small></div><div className="stat-card"><span className="stat-label">Delivery</span><b className="stat-value">Review-only</b><small>External notifications are not configured</small></div></div>
    {notice && <p className="notice success" role="status">{notice}</p>}{error && <p className="notice error" role="alert">{error}</p>}
    {editable && <form className="card inline-form" onSubmit={createRule}><h2>Create workflow rule</h2><input value={name} onChange={e => setName(e.target.value)} placeholder="Rule name" maxLength={120} /><input value={trigger} onChange={e => setTrigger(e.target.value)} placeholder="Trigger condition" maxLength={500} /><input value={action} onChange={e => setAction(e.target.value)} placeholder="Review action" maxLength={500} /><select value={target} onChange={e => setTarget(e.target.value)}><option>Operations</option><option>Finance</option><option>CRM</option><option>Inventory</option><option>HR</option></select><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Add workflow'}</button></form>}
    <section className="card"><div className="section-header"><h2>Workflow rules</h2><small>Rules and test runs are stored per workspace. Test runs never dispatch payments or messages.</small></div><div className="table-scroll"><table><thead><tr><th>Name</th><th>Trigger</th><th>Review action</th><th>Area</th><th>Status</th><th>Controls</th></tr></thead><tbody>{rules.length ? rules.map(rule => <tr key={rule.id}><td><b>{rule.name}</b><small>{dateLabel(rule.updatedAt)}</small></td><td>{rule.trigger}</td><td>{rule.action}</td><td><span className="badge">{rule.target}</span></td><td><span className={rule.status === 'active' ? 'badge green' : 'badge'}>{rule.status}</span></td><td>{editable ? <><button type="button" onClick={() => void testRun(rule)}>Test run</button><button type="button" onClick={() => void toggle(rule)}>{rule.status === 'active' ? 'Pause' : 'Activate'}</button></> : <small>Read-only</small>}</td></tr>) : <tr><td colSpan={6}>No workflow rules yet. Create one to begin.</td></tr>}</tbody></table></div></section>
    <section className="card"><h2>Execution history</h2>{logs.length ? <div className="preview-list">{logs.map(log => <div className="preview-row" key={log.id}><div><b>{log.ruleName}</b><small>{log.details}</small></div><div><span className="badge green">{log.status}</span><small>{dateLabel(log.createdAt)}</small></div></div>)}</div> : <p className="muted">No test runs have been recorded.</p>}</section>
  </div>
}
