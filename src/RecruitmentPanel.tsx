import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

interface Candidate {
  id: string
  name: string
  email: string
  position: string
  notes: string
  status: string
  version: number
}
const nextStage: Record<string, string> = {
  applied: 'screening',
  screening: 'interview',
  interview: 'offer',
  offer: 'hired',
}
export function RecruitmentPanel({ remote }: { remote: Snapshot | null }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(Boolean(remote))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('all')
  const editable = Boolean(
    remote && ['owner', 'hr_admin'].includes(remote.user.role),
  )
  useEffect(() => {
    if (!remote) return
    let active = true
    request<{ candidates: Candidate[] }>('/hr/candidates')
      .then((data) => {
        if (active) setCandidates(data.candidates)
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load candidates.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [remote])
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const candidate = await request<Candidate>('/hr/candidates', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote!.csrf },
        body: JSON.stringify(data),
      })
      setCandidates((current) => [candidate, ...current])
      form.reset()
      setNotice('Candidate added.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not add candidate.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function advance(candidate: Candidate, status: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await request<Candidate>(
        '/hr/candidates/' + candidate.id,
        {
          method: 'PATCH',
          headers: { 'X-CSRF-Token': remote!.csrf },
          body: JSON.stringify({ version: candidate.version, status }),
        },
      )
      setCandidates((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      )
      setNotice('Hiring stage updated.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update candidate.',
      )
      try {
        const data = await request<{ candidates: Candidate[] }>(
          '/hr/candidates',
        )
        setCandidates(data.candidates)
      } catch {
        /* Preserve the original mutation error. */
      }
    } finally {
      setBusy(false)
    }
  }
  const visible = candidates.filter(
    (row) =>
      (stage === 'all' || row.status === stage) &&
      `${row.name} ${row.email} ${row.position}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  return (
    <section className="panel" aria-label="Recruitment">
      <h2>Recruitment</h2>
      <p>
        Track candidates from application to hiring. Create the employee record
        separately after a hire is confirmed.
      </p>
      {!remote && <p>Sign in to manage your recruitment pipeline.</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      {editable && (
        <form
          onSubmit={(event) => void create(event)}
          className="operations-fields"
        >
          <label>
            Candidate name
            <input name="name" required maxLength={160} />
          </label>
          <label>
            Email
            <input name="email" type="email" required maxLength={254} />
          </label>
          <label>
            Position
            <input name="position" required maxLength={160} />
          </label>
          <label>
            Application notes
            <textarea name="notes" maxLength={2000} />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add candidate'}
          </button>
        </form>
      )}
      <div className="operations-fields">
        <label>
          Search candidates
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Hiring stage
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {[
              'all',
              'applied',
              'screening',
              'interview',
              'offer',
              'hired',
              'rejected',
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <p role="status">Loading candidates…</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Position</th>
                <th>Notes</th>
                <th>Stage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    {candidate.name}
                    <small>{candidate.email}</small>
                  </td>
                  <td>{candidate.position}</td>
                  <td>{candidate.notes || '—'}</td>
                  <td>{candidate.status}</td>
                  <td>
                    {editable && nextStage[candidate.status] ? (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void advance(candidate, nextStage[candidate.status])
                          }
                        >
                          Move to {nextStage[candidate.status]}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void advance(candidate, 'rejected')}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <span>
                        {nextStage[candidate.status] ? 'Read-only' : 'Closed'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={5}>
                    {candidates.length
                      ? 'No candidates match your filters.'
                      : 'No candidates yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
