import { useEffect, useState } from 'react'
import { request } from './api'
import {
  workflowStates,
  workflowWriters,
  type WorkflowKind,
  type WorkflowRecord,
} from './workflow-contracts'
import type { Snapshot, State } from './types'
type Field = [string, string, string]
const config: Record<WorkflowKind, { title: string; fields: Field[] }> = {
  leave: {
    title: 'Leave requests',
    fields: [
      ['employeeId', 'Employee', 'employee'],
      ['startDate', 'From', 'date'],
      ['endDate', 'Through', 'date'],
      ['reason', 'Reason', 'textarea'],
    ],
  },
  goals: {
    title: 'Performance goals',
    fields: [
      ['employeeId', 'Employee', 'employee'],
      ['title', 'Goal', 'text'],
      ['target', 'Target', 'number'],
      ['unit', 'Unit (for example, sales or tasks)', 'text'],
      ['dueDate', 'Due date', 'date'],
    ],
  },
  reviews: {
    title: 'Performance reviews and rewards',
    fields: [
      ['employeeId', 'Employee', 'employee'],
      ['periodStart', 'Review period starts', 'date'],
      ['periodEnd', 'Review period ends', 'date'],
      ['rating', 'Rating (1–5)', 'rating'],
      ['summary', 'Evaluation summary', 'textarea'],
      ['rewardAmount', 'Reward amount (NGN, optional)', 'number'],
      ['rewardNote', 'Reward note', 'text'],
    ],
  },
  appointments: {
    title: 'Appointments',
    fields: [
      ['title', 'Meeting title', 'text'],
      ['guest', 'Guest', 'text'],
      ['guestEmail', 'Guest email for reminders (optional)', 'email'],
      ['host', 'Host', 'text'],
      ['room', 'Room', 'text'],
      ['startAt', 'Start (your local time)', 'datetime-local'],
      ['endAt', 'End (your local time)', 'datetime-local'],
      ['reminderAt', 'Reminder time (optional)', 'datetime-local'],
    ],
  },
  certifications: {
    title: 'Certifications and policies',
    fields: [
      ['title', 'Certification / policy', 'text'],
      ['issuer', 'Issuer', 'text'],
      ['reference', 'Reference', 'text'],
      ['expiresOn', 'Expiry date', 'date'],
    ],
  },
  findings: {
    title: 'Audit findings',
    fields: [
      ['title', 'Finding', 'text'],
      ['assignee', 'Responsible person', 'text'],
      ['severity', 'Severity', 'severity'],
      ['dueDate', 'Due date', 'date'],
      ['correctiveAction', 'Corrective action', 'textarea'],
    ],
  },
  knowledge: {
    title: 'Knowledge base',
    fields: [
      ['title', 'Article title', 'text'],
      ['category', 'Category', 'text'],
      ['content', 'Article content', 'textarea'],
    ],
  },
}
const workflowCopy: Partial<Record<WorkflowKind, string>> = {
  leave: 'Create, review and close leave requests without losing approval context.',
  goals: 'Turn priorities into measurable goals and keep progress visible.',
  reviews: 'Capture reviews, ratings and rewards in a structured employee record.',
  appointments: 'Keep meetings, guests and reminders organised in one place.',
  certifications: 'Track policy and certification evidence before it becomes overdue.',
  findings: 'Assign corrective actions and retain evidence through resolution.',
  knowledge: 'Build a searchable internal knowledge base for repeatable work.',
}
const workflowTone = (status: string) => {
  if (['approved', 'completed', 'closed', 'active'].includes(status)) return 'green'
  if (['rejected', 'cancelled', 'overdue'].includes(status)) return 'red'
  if (['draft', 'pending'].includes(status)) return 'amber'
  return 'blue'
}
export function WorkflowPanel({
  kind,
  remote,
  state,
}: {
  kind: WorkflowKind
  remote: Snapshot | null
  state: State
}) {
  const spec = config[kind]
  const [records, setRecords] = useState<WorkflowRecord[]>([]),
    [loading, setLoading] = useState(Boolean(remote)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [revision, setRevision] = useState(0)
  const [progress, setProgress] = useState<Record<string, string>>({}),
    [evidence, setEvidence] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<{
    fingerprint: string
    key: string
  } | null>(null)
  const editable = Boolean(
    remote && workflowWriters[kind].includes(remote.user.role),
  )
  useEffect(() => {
    if (!remote) return
    let active = true
    request<{ records: WorkflowRecord[] }>('/workflows/' + kind)
      .then((data) => {
        if (active) setRecords(data.records)
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'Could not load records.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [kind, remote, revision])
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!remote || busy) return
    const form = event.currentTarget,
      input: Record<string, unknown> = Object.fromEntries(new FormData(form))
    for (const [name, , type] of spec.fields) {
      if (type === 'number') input[name] = Number(input[name])
      if (type === 'datetime-local')
        input[name] = input[name] ? new Date(String(input[name])).toISOString() : undefined
      if (input[name] === '') delete input[name]
    }
    const fingerprint = JSON.stringify(input),
      key =
        pending?.fingerprint === fingerprint ? pending.key : crypto.randomUUID()
    setPending({ fingerprint, key })
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const row = await request<WorkflowRecord>('/workflows/' + kind, {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf, 'Idempotency-Key': key },
        body: fingerprint,
      })
      setRecords((current) => [
        row,
        ...current.filter((item) => item.id !== row.id),
      ])
      setPending(null)
      form.reset()
      setNotice('Record saved.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save record.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function update(row: WorkflowRecord, status?: string) {
    if (!remote || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    const input = {
      version: row.version,
      ...(status ? { status } : {}),
      ...(kind === 'goals' &&
      progress[row.id] !== undefined &&
      progress[row.id] !== ''
        ? { progress: Number(progress[row.id]) }
        : {}),
      ...(kind === 'findings' && evidence[row.id]?.trim()
        ? { evidence: evidence[row.id] }
        : {}),
    }
    try {
      const saved = await request<WorkflowRecord>(
        '/workflows/' + kind + '/' + row.id,
        {
          method: 'PATCH',
          headers: { 'X-CSRF-Token': remote.csrf },
          body: JSON.stringify(input),
        },
      )
      setRecords((current) =>
        current.map((item) => (item.id === row.id ? saved : item)),
      )
      setNotice('Changes saved.')
      setProgress((current) => {
        const next = { ...current }
        delete next[row.id]
        return next
      })
      setEvidence((current) => {
        const next = { ...current }
        delete next[row.id]
        return next
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update record.',
      )
      setRevision((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }
  async function runAppointmentReminders() {
    if (!remote || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ queued: number }>('/workflows/appointments/reminders/run', { method: 'POST', headers: { 'X-CSRF-Token': remote.csrf }, body: '{}' })
      setNotice(result.queued ? `${result.queued} appointment reminder${result.queued === 1 ? '' : 's'} queued.` : 'No appointment reminders are due.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not queue appointment reminders.')
    } finally {
      setBusy(false)
    }
  }
  const visible = records.filter(
    (row) =>
      (filter === 'all' || row.status === filter) &&
      Object.values(row.data)
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  function value(name: string, value: unknown) {
    if (name === 'employeeId')
      return (
        state.employees.find((employee) => employee.id === value)?.name ||
        'Employee record unavailable'
      )
    if (name === 'startAt' || name === 'endAt')
      return new Date(String(value)).toLocaleString()
    return String(value)
  }
  return (
    <section className="panel workflow-panel" aria-label={spec.title}>
      <div className="section-top workflow-heading">
        <div>
          <p className="eyebrow">Workflow centre</p>
          <h2>{spec.title}</h2>
          <p>{workflowCopy[kind]}</p>
        </div>
        <span className="workflow-count"><b>{records.length}</b> records</span>
      </div>
      {!remote && <p>Sign in to manage these records.</p>}
      {kind === 'leave' && (
        <p>
          A different authorised owner or HR administrator must approve
          requests. Approval does not change payroll.
        </p>
      )}
      {kind === 'appointments' && editable && <p className="workflow-utility"><button onClick={() => void runAppointmentReminders()} disabled={busy}>Queue due reminders</button></p>}
      {error && (
        <p className="notice error" role="alert">
          {error}{' '}
          <button onClick={() => setRevision((v) => v + 1)}>
            Refresh records
          </button>
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {editable && (
        <form
          className="operations-fields workflow-create"
          onSubmit={(event) => void create(event)}
        >
          {spec.fields.map(([name, label, type]) => (
            <label key={name}>
              {label}
              {type === 'employee' ? (
                <select name={name} required defaultValue="">
                  <option value="" disabled>
                    Select employee
                  </option>
                  {state.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              ) : type === 'severity' ? (
                <select name={name}>
                  {['low', 'medium', 'high', 'critical'].map((level) => (
                    <option key={level}>{level}</option>
                  ))}
                </select>
              ) : type === 'rating' ? (
                <select name={name} defaultValue="3">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <option key={rating} value={rating}>{rating}</option>
                  ))}
                </select>
              ) : type === 'textarea' ? (
                <textarea name={name} required maxLength={4000} />
              ) : (
                <input
                  name={name}
                  type={type}
                  required={!['rewardAmount', 'rewardNote', 'guestEmail', 'reminderAt'].includes(name)}
                  maxLength={160}
                  min={type === 'number' ? '0.01' : undefined}
                  max={type === 'number' ? '1000000000' : undefined}
                  step={type === 'number' ? 'any' : undefined}
                />
              )}
            </label>
          ))}
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add record'}
          </button>
        </form>
      )}
      <div className="operations-fields workflow-filters">
        <label>
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Status
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {['all', ...Object.keys(workflowStates[kind])].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <p role="status" className="empty">Loading workflow records...</p>
      ) : visible.length ? (
        visible.map((row) => (
          <article className="card workflow-record" key={row.id}>
            <div className="workflow-record-header">
              <h3>
                {String(
                  row.data.title ||
                    state.employees.find(
                      (employee) => employee.id === row.data.employeeId,
                    )?.name ||
                    spec.title,
                )}
              </h3>
              <span className={`badge ${workflowTone(row.status)}`}>{row.status}</span>
            </div>
            <dl>
              {spec.fields
                .filter(([name]) => name !== 'title')
                .map(([name, label]) => (
                  <div key={name}>
                    <dt>{label}</dt>
                    <dd
                      style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {value(name, row.data[name])}
                    </dd>
                  </div>
                ))}
              {kind === 'goals' && (
                <>
                  <dt>Progress</dt>
                  <dd>
                    {String(row.data.progress || 0)} / {String(row.data.target)}
                  </dd>
                </>
              )}
              {kind === 'reviews' && Number(row.data.rewardAmount || 0) > 0 && (
                <>
                  <dt>Reward</dt>
                  <dd>NGN {Number(row.data.rewardAmount).toLocaleString()} {String(row.data.rewardNote || '')}</dd>
                </>
              )}
              {Boolean(row.data.evidence) && (
                <>
                  <dt>Resolution evidence</dt>
                  <dd>{String(row.data.evidence)}</dd>
                </>
              )}
            </dl>
            {editable && (
              <div className="operations-fields workflow-actions">
                {kind === 'goals' && row.status === 'active' && (
                  <label>
                    Update progress
                    <input
                      aria-label={'Progress for ' + String(row.data.title)}
                      type="number"
                      min="0"
                      max="1000000000"
                      step="any"
                      value={progress[row.id] ?? String(row.data.progress || 0)}
                      onChange={(event) =>
                        setProgress((v) => ({
                          ...v,
                          [row.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      disabled={
                        busy ||
                        progress[row.id] === undefined ||
                        progress[row.id] === ''
                      }
                      onClick={() => void update(row)}
                    >
                      Save progress
                    </button>
                  </label>
                )}
                {kind === 'findings' && row.status !== 'closed' && (
                  <label>
                    Resolution evidence
                    <textarea
                      value={
                        evidence[row.id] ?? String(row.data.evidence || '')
                      }
                      maxLength={4000}
                      onChange={(event) =>
                        setEvidence((v) => ({
                          ...v,
                          [row.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      disabled={busy || !evidence[row.id]?.trim()}
                      onClick={() => void update(row)}
                    >
                      Save evidence
                    </button>
                  </label>
                )}
                {(workflowStates[kind][row.status] || []).map((status) => (
                  <button
                    key={status}
                    disabled={
                      busy ||
                      (kind === 'leave' &&
                        status === 'approved' &&
                        row.created_by === remote?.user.id)
                    }
                    onClick={() => void update(row, status)}
                  >
                    Mark {status}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))
      ) : (
        <p className="empty">No records {records.length ? 'match your filters' : 'yet'}.</p>
      )}
    </section>
  )
}
