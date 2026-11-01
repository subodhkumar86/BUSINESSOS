import { useEffect, useState } from 'react'
import { request } from './api'
import { useRef } from 'react'
import type { Snapshot } from './types'
import { MfaSettings } from './MfaSettings'
import { ControlHistory } from './ControlHistory'
import { DemoControlPreview } from './WorkspaceVisuals'
type OutboxMessage = {
  id: string
  channel: 'email' | 'sms' | 'whatsapp' | 'push'
  recipient: string
  subject: string
  status: 'queued' | 'sent' | 'failed'
  attempts: number
  provider: string
  created_at: string
}

export function CompletionPanel({ remote }: { remote: Snapshot | null }) {
  const [data, setData] = useState<Record<string, unknown[]>>({})
  const [form, setForm] = useState({
    branchName: '',
    branchCode: '',
    chainName: '',
    chainScope: 'purchase_order',
    chainSteps: ['operations_manager', 'owner'],
    notifyChannel: 'email' as OutboxMessage['channel'],
    notifyRecipient: '',
    notifySubject: '',
    notifyBody: '',
  })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(Boolean(remote))
  const saving = useRef(false)
  const [comments, setComments] = useState<Record<string, string>>({})
  const csrf = remote?.csrf || ''
  const authed = Boolean(remote)
  const load = async () => {
    if (!remote) return
    setError('')
    try {
      const [branches, chains, requests, forecasts, outbox] = await Promise.all(
        [
          request<{ branches: unknown[] }>('/branches'),
          request<{ chains: unknown[] }>('/approvals/chains'),
          request<{ requests: unknown[] }>('/approvals/requests'),
          request<{ forecasts: unknown[] }>('/ai/forecasts'),
          request<{ messages: unknown[] }>('/notifications/outbox'),
        ],
      )
      setData({
        branches: branches.branches,
        chains: chains.chains,
        requests: requests.requests,
        forecasts: forecasts.forecasts,
        outbox: outbox.messages,
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load completion data.',
      )
    }
  }
  useEffect(() => {
    if (!remote) return
    let active = true
    Promise.all([
      request<{ branches: unknown[] }>('/branches'),
      request<{ chains: unknown[] }>('/approvals/chains'),
      request<{ requests: unknown[] }>('/approvals/requests'),
      request<{ forecasts: unknown[] }>('/ai/forecasts'),
      request<{ messages: unknown[] }>('/notifications/outbox'),
    ])
      .then(([branches, chains, requests, forecasts, outbox]) => {
        if (!active) return
        setData({
          branches: branches.branches,
          chains: chains.chains,
          requests: requests.requests,
          forecasts: forecasts.forecasts,
          outbox: outbox.messages,
        })
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load completion data.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [remote])
  const post = async (path: string, body: unknown) => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await request(path, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      })
      setNotice('Changes saved successfully.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const deliver = async (message: OutboxMessage) => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{
        status: OutboxMessage['status']
        error?: string
      }>('/notifications/outbox/' + message.id + '/deliver', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
        body: '{}',
      })
      setNotice(
        result.status === 'sent'
          ? 'Notification delivered.'
          : result.error ||
              'Notification was not delivered. Configure a provider and retry.',
      )
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Delivery request failed.',
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  if (!authed)
    return <DemoControlPreview />
  return (
    <section className="panel" aria-busy={busy || loading}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <h2>Approvals, branches, scenarios and delivery</h2>
        {loading && <p role="status">Loading workspace controls…</p>}
        <p>
          Manage approval chains, branch directory labels, recorded scenarios
          and notification delivery.
        </p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <h3>Branches ({(data.branches || []).length})</h3>
        {remote?.user.role === 'owner' && (
          <div className="operations-fields">
            <label>
              Branch name
              <input
                maxLength={160}
                value={form.branchName}
                onChange={(e) =>
                  setForm({ ...form, branchName: e.target.value })
                }
              />
            </label>
            <label>
              Code
              <input
                value={form.branchCode}
                onChange={(e) =>
                  setForm({ ...form, branchCode: e.target.value })
                }
              />
            </label>
            <button
              className="primary"
              disabled={!form.branchName.trim() || !form.branchCode.trim()}
              onClick={() =>
                void post('/branches', {
                  name: form.branchName,
                  code: form.branchCode,
                })
              }
            >
              Add branch
            </button>
          </div>
        )}
        <h3>Approval chains ({(data.chains || []).length})</h3>
        {remote?.user.role === 'owner' && (
          <div className="operations-fields">
            <label>
              Chain name
              <input
                value={form.chainName}
                onChange={(e) =>
                  setForm({ ...form, chainName: e.target.value })
                }
              />
            </label>
            <label>
              Scope
              <select
                value={form.chainScope}
                onChange={(e) =>
                  setForm({ ...form, chainScope: e.target.value })
                }
              >
                <option value="purchase_order">purchase_order</option>
                <option value="payroll">payroll</option>
              </select>
            </label>
            <fieldset>
              <legend>Approval roles (in order)</legend>
              {form.chainSteps.map((role, index) => (
                <label key={index}>
                  Step {index + 1}
                  <select
                    value={role}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        chainSteps: form.chainSteps.map((current, position) =>
                          position === index ? e.target.value : current,
                        ),
                      })
                    }
                  >
                    <option value="finance_admin">Finance admin</option>
                    <option value="hr_admin">HR admin</option>
                    <option value="operations_manager">
                      Operations manager
                    </option>
                    <option value="department_manager">
                      Department manager
                    </option>
                    <option value="owner">Business owner</option>
                  </select>
                  {form.chainSteps.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          chainSteps: form.chainSteps.filter(
                            (_, position) => position !== index,
                          ),
                        })
                      }
                    >
                      Remove step
                    </button>
                  )}
                </label>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    chainSteps: [...form.chainSteps, 'owner'],
                  })
                }
              >
                Add approval step
              </button>
            </fieldset>
            <button
              className="primary"
              disabled={!form.chainSteps.length || !form.chainName.trim()}
              onClick={() =>
                void post('/approvals/chains', {
                  name: form.chainName,
                  scope: form.chainScope,
                  steps: form.chainSteps.map((role) => ({ role })),
                })
              }
            >
              Add chain
            </button>
          </div>
        )}
        <h3>Recorded scenarios ({(data.forecasts || []).length})</h3>
        <p className="muted">
          Scenarios hold current values constant. They are not trained
          predictions.
        </p>
        {remote?.entitlements?.features.includes('forecast') &&
          ['owner', 'finance_admin', 'operations_manager'].includes(
            remote.user.role,
          ) && (
            <div className="operations-fields">
              {['cash', 'pipeline', 'inventory'].map((metric) => (
                <button
                  key={metric}
                  onClick={() => void post('/ai/forecast', { metric })}
                >
                  Record {metric} scenario
                </button>
              ))}
            </div>
          )}
        <h3>Notification outbox ({(data.outbox || []).length})</h3>
        {['owner', 'operations_manager'].includes(remote!.user.role) && (
          <div className="operations-fields">
            <label>
              Channel
              <select
                value={form.notifyChannel}
                onChange={(e) =>
                  setForm({
                    ...form,
                    notifyChannel: e.target.value as OutboxMessage['channel'],
                  })
                }
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="push">Push</option>
              </select>
            </label>
            <label>
              Recipient
              <input
                type={form.notifyChannel === 'email' ? 'email' : 'text'}
                required
                value={form.notifyRecipient}
                onChange={(e) =>
                  setForm({ ...form, notifyRecipient: e.target.value })
                }
              />
            </label>
            <label>
              Subject (optional)
              <input
                value={form.notifySubject}
                onChange={(e) =>
                  setForm({ ...form, notifySubject: e.target.value })
                }
              />
            </label>
            <label>
              Message
              <textarea
                required
                value={form.notifyBody}
                onChange={(e) =>
                  setForm({ ...form, notifyBody: e.target.value })
                }
              />
            </label>
            <button
              className="primary"
              disabled={!form.notifyRecipient.trim() || !form.notifyBody.trim()}
              onClick={() =>
                void post('/notifications/outbox', {
                  channel: form.notifyChannel,
                  recipient: form.notifyRecipient.trim(),
                  subject: form.notifySubject.trim(),
                  body: form.notifyBody.trim(),
                })
              }
            >
              Queue message
            </button>
          </div>
        )}
        <p className="muted">
          A message is marked sent only after the configured server-side
          provider accepts it. Failed messages can be retried after provider
          configuration is corrected.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Provider</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {((data.outbox as OutboxMessage[]) || [])
                .slice(0, 20)
                .map((message) => (
                  <tr key={message.id}>
                    <td>{message.channel}</td>
                    <td>{message.recipient}</td>
                    <td>
                      <span
                        className={
                          message.status === 'sent'
                            ? 'badge green'
                            : message.status === 'failed'
                              ? 'badge red'
                              : 'badge'
                        }
                      >
                        {message.status}
                      </span>
                    </td>
                    <td>{message.attempts}</td>
                    <td>{message.provider}</td>
                    <td>{new Date(message.created_at).toLocaleString('en-IN')}</td>
                    <td>
                      {['queued', 'failed'].includes(message.status) &&
                      ['owner', 'operations_manager'].includes(
                        remote!.user.role,
                      ) ? (
                        <button onClick={() => void deliver(message)}>
                          Deliver / retry
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              {!(data.outbox || []).length && (
                <tr>
                  <td colSpan={7}>No messages have been queued.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <h3>Workspace search</h3>
        <SearchBox csrf={csrf} />
        <h3>Security and backups</h3>
        <SecurityBox csrf={csrf} canBackup={remote?.user.role === 'owner'} />
        <ControlHistory
          remote={remote!}
          branches={data.branches || []}
          chains={data.chains || []}
          forecasts={data.forecasts || []}
          onRefresh={load}
        />
        <h3>Pending approvals ({(data.requests || []).length})</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Entity</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Chain</th>
              </tr>
            </thead>
            <tbody>
              {(
                (data.requests as {
                  id: string
                  version: number
                  entity_id: string
                  entity_type: string
                  status: string
                  chain_name: string
                  requested_by: string
                  step_index: number
                  steps: { role: string }[]
                  decisions: {
                    actor: string
                    decision: string
                    comment: string
                    at: string
                  }[]
                }[]) || []
              ).map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.entity_type} · {row.entity_id.slice(0, 8)}
                  </td>
                  <td>
                    {row.chain_name}
                    <br />
                    {row.status === 'pending' &&
                      `Step ${row.step_index + 1}: ${row.steps[row.step_index]?.role.replaceAll('_', ' ')}`}
                  </td>
                  <td>
                    {row.status}
                    <details>
                      <summary>Decision history</summary>
                      {row.decisions.map((decision, index) => (
                        <p key={index}>
                          {decision.decision} ·{' '}
                          {new Date(decision.at).toLocaleString('en-IN')}
                          <br />
                          {decision.comment}
                        </p>
                      ))}
                    </details>
                  </td>
                  <td>
                    {row.status === 'pending' &&
                    row.requested_by !== remote!.user.id &&
                    row.steps[row.step_index]?.role === remote!.user.role &&
                    !row.decisions.some(
                      (decision) => decision.actor === remote!.user.id,
                    ) ? (
                      <>
                        <label>
                          Decision comment
                          <textarea
                            maxLength={1000}
                            value={comments[row.id] || ''}
                            onChange={(event) =>
                              setComments({
                                ...comments,
                                [row.id]: event.target.value,
                              })
                            }
                          />
                        </label>
                        <button
                          onClick={() =>
                            void post('/approvals/requests/' + row.id, {
                              version: row.version,
                              decision: 'approve',
                              comment: comments[row.id] || '',
                            })
                          }
                        >
                          Approve step
                        </button>
                        <button
                          onClick={() =>
                            void post('/approvals/requests/' + row.id, {
                              version: row.version,
                              decision: 'reject',
                              comment: comments[row.id] || '',
                            })
                          }
                        >
                          Reject
                        </button>
                      </>
                    ) : row.status === 'pending' ? (
                      'Awaiting an eligible approver'
                    ) : (
                      'Completed'
                    )}
                  </td>
                </tr>
              ))}
              {!(data.requests || []).length && (
                <tr>
                  <td colSpan={4}>No approval requests recorded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p>
          <button onClick={() => void load()}>Refresh completion data</button>
        </p>
      </fieldset>
    </section>
  )
}
function SearchBox({ csrf: _csrf }: { csrf: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<
    { kind: string; id: string; name: string }[]
  >([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  return (
    <div className="operations-fields">
      <label>
        Search workspace
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type at least 2 characters"
        />
      </label>
      <button
        disabled={busy || q.trim().length < 2}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const result = await request<{ results: typeof results }>(
              '/search?q=' + encodeURIComponent(q.trim()),
            )
            setResults(result.results)
            setSearched(true)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Search failed.')
            setResults([])
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Searching…' : 'Search'}
      </button>
      {error && <span role="alert">{error}</span>}
      <span role="status">
        {results.length
          ? results.map((r) => `${r.kind}: ${r.name}`).join(' · ')
          : searched && !error
            ? 'No matching records.'
            : 'Enter a search query.'}
      </span>
    </div>
  )
}
function SecurityBox({
  csrf,
  canBackup,
}: {
  csrf: string
  canBackup: boolean
}) {
  const [status, setStatus] = useState(
    'Workspace backups contain business records and exclude account secrets.',
  )
  const [download, setDownload] = useState('')
  const headers = { 'X-CSRF-Token': csrf }
  return (
    <div className="operations-fields">
      <MfaSettings csrf={csrf} />
      {canBackup && (
        <button
          onClick={() =>
            void request<{ download: string }>('/admin/backups', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                label: 'manual-' + new Date().toISOString().slice(0, 10),
              }),
            })
              .then((result) => {
                setDownload(result.download)
                setStatus('Workspace backup saved.')
              })
              .catch((e) =>
                setStatus(e instanceof Error ? e.message : 'Backup failed.'),
              )
          }
        >
          Create backup
        </button>
      )}
      {download && (
        <a href={download} download>
          Download workspace backup
        </a>
      )}
      <span role="status">{status}</span>
    </div>
  )
}
