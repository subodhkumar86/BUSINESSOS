import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

export interface SupportTicket {
  id: string
  ticket_number: string
  subject: string
  customer: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'pending' | 'resolved' | 'closed'
  sla_due_at: string | null
  created_at?: string
  updated_at?: string
}

const demoTickets: SupportTicket[] = [
  {
    id: 't-1',
    ticket_number: 'T-2048',
    subject: 'Urgent: Bulk invoice delivery update requested',
    customer: 'Northstar Limited',
    priority: 'urgent',
    status: 'open',
    sla_due_at: new Date(Date.now() + 3600000 * 2).toISOString(),
  },
  {
    id: 't-2',
    ticket_number: 'T-2046',
    subject: 'Request for signed tax clearance copy',
    customer: 'Greenfield Studio',
    priority: 'medium',
    status: 'pending',
    sla_due_at: new Date(Date.now() + 3600000 * 18).toISOString(),
  },
  {
    id: 't-3',
    ticket_number: 'T-2042',
    subject: 'Defective dock station warranty replacement',
    customer: 'Victoria Island Tech',
    priority: 'high',
    status: 'resolved',
    sla_due_at: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
]

const kbArticles = [
  {
    title: 'How to download statutory withholding tax receipts (WHT)',
    category: 'Finance & Tax',
    snippet: 'Go to Finance & AR/AP, open the collection record, and click "Download WHT Remittance Schedule" for the corresponding reporting quarter.',
  },
  {
    title: 'Warehouse goods receipt and discrepancy inspection procedure',
    category: 'Warehouse & Logistics',
    snippet: 'All inbound goods must be matched against the purchase order reference. If damaged during transit, select "Damaged" in the RMA inspection queue.',
  },
  {
    title: 'Employee pension contribution remit schedules (PenCom)',
    category: 'HR & Payroll',
    snippet: 'Pension calculations follow the 8% employee and 10% employer statutory minimums. Approved payroll batches generate payment confirmation keys.',
  },
]

export function SupportPanel({ remote }: { remote: Snapshot | null }) {
  const [tickets, setTickets] = useState<SupportTicket[]>(() =>
    remote ? [] : demoTickets,
  )
  const [loading, setLoading] = useState(Boolean(remote))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'pending' | 'resolved' | 'closed'>('all')
  const [activeKb, setActiveKb] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)

  const editable = !remote || remote.user.role !== 'auditor'

  useEffect(() => {
    let active = true
    if (!remote) return
    request<{ tickets: SupportTicket[] }>('/support/tickets')
      .then((data) => {
        if (active) setTickets(data.tickets)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [remote, revision])

  async function handleCreateTicket(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const subject = String(values.subject).trim()
    const customer = String(values.customer).trim()
    const priority = values.priority as SupportTicket['priority']
    const slaDueAt = values.slaDueAt ? new Date(String(values.slaDueAt)).toISOString() : null

    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      const newTicket: SupportTicket = {
        id: 't-' + Date.now(),
        ticket_number: 'T-' + Math.floor(1000 + Math.random() * 9000),
        subject,
        customer,
        priority,
        status: 'open',
        sla_due_at: slaDueAt,
      }
      setTickets((prev) => [newTicket, ...prev])
      form.reset()
      setNotice('Support ticket created (demo).')
      setBusy(false)
      return
    }

    try {
      await request('/support/tickets', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          subject,
          customer,
          priority,
          slaDueAt,
        }),
      })
      form.reset()
      setNotice('Support ticket created and audited on server.')
      setRevision((r) => r + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ticket.')
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdateTicket(id: string, status: SupportTicket['status']) {
    if (!editable) return
    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status } : t)),
      )
      setNotice(`Ticket status changed to ${status} (demo).`)
      setBusy(false)
      return
    }

    try {
      await request(`/support/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ status }),
      })
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status } : t)),
      )
      setNotice(`Ticket ${id.slice(0, 8)} updated to ${status}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update ticket.')
    } finally {
      setBusy(false)
    }
  }

  const filtered = tickets.filter((t) => {
    const matchesSearch =
      t.subject.toLowerCase().includes(search.toLowerCase()) ||
      t.customer.toLowerCase().includes(search.toLowerCase()) ||
      t.ticket_number.toLowerCase().includes(search.toLowerCase())
    const matchesStatus =
      statusFilter === 'all' || t.status === statusFilter
    return matchesSearch && matchesStatus
  })

  function getSlaIndicator(slaDateStr: string | null, status: string) {
    if (status === 'resolved' || status === 'closed') {
      return <span className="badge green">✓ Resolved</span>
    }
    if (!slaDateStr) return <span className="badge">No SLA</span>
    const diff = new Date(slaDateStr).getTime() - Date.now()
    const hours = Math.round(diff / (1000 * 3600))
    if (hours < 0) {
      return (
        <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>
          🚨 Breached ({Math.abs(hours)}h ago)
        </span>
      )
    }
    if (hours <= 4) {
      return (
        <span className="badge" style={{ background: '#fef3c7', color: '#b45309' }}>
          ⏳ {hours}h remaining
        </span>
      )
    }
    return (
      <span className="badge" style={{ background: '#f0fdf4', color: '#15803d' }}>
        ✓ {hours}h SLA
      </span>
    )
  }

  return (
    <div className="module-panel">
      {/* Telemetry Row */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Open Tickets</span>
          <b className="stat-value">{tickets.filter((t) => t.status === 'open').length}</b>
          <small>Awaiting operator triage</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg First Response</span>
          <b className="stat-value">1h 45m</b>
          <small>Under 2h target SLA</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">CSAT Score</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>4.8 / 5.0</b>
          <small>96% satisfaction rate</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">SLA Compliance</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>97.4%</b>
          <small>Resolution within service agreement</small>
        </div>
      </div>

      {error && <p role="alert" className="notice error">{error}</p>}
      {notice && <p role="status" className="notice success">{notice}</p>}

      {/* Ticket Queue */}
      <section className="card">
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2>Customer Support Ticketing Queue</h2>
            <small>SLA tracking, priority escalation, and accountable inquiry resolution.</small>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Search tickets or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: '220px' }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label="Filter tickets by status"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="empty">Loading tickets…</p>
        ) : filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Customer</th>
                  <th>Subject</th>
                  <th>Priority</th>
                  <th>SLA Standing</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.ticket_number}</b></td>
                    <td>{t.customer}</td>
                    <td>{t.subject}</td>
                    <td>
                      <span className={`badge ${t.priority === 'urgent' ? 'red' : t.priority === 'high' ? 'yellow' : ''}`}>
                        {t.priority.toUpperCase()}
                      </span>
                    </td>
                    <td>{getSlaIndicator(t.sla_due_at, t.status)}</td>
                    <td>
                      <span className={t.status === 'resolved' || t.status === 'closed' ? 'badge green' : 'badge'}>
                        {t.status}
                      </span>
                    </td>
                    <td>
                      <select
                        disabled={busy || !editable}
                        value={t.status}
                        onChange={(e) =>
                          void handleUpdateTicket(
                            t.id,
                            e.target.value as SupportTicket['status'],
                          )
                        }
                        aria-label={`Update status for ${t.ticket_number}`}
                      >
                        <option value="open">Open</option>
                        <option value="pending">Pending</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No tickets match the query.</p>
        )}
      </section>

      {/* Ticket Creation */}
      {editable && (
        <section className="card">
          <h2>Create Support Ticket</h2>
          <form className="inline-form" onSubmit={handleCreateTicket}>
            <input name="subject" placeholder="Ticket Subject / Summary" required />
            <input name="customer" placeholder="Customer or Account Name" required />
            <select name="priority" defaultValue="medium" aria-label="Ticket priority">
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
              <option value="urgent">Urgent priority</option>
            </select>
            <input
              name="slaDueAt"
              type="datetime-local"
              aria-label="SLA resolution deadline"
            />
            <button className="primary" disabled={busy} type="submit">
              + File Ticket
            </button>
          </form>
        </section>
      )}

      {/* Knowledge Base Self-Service */}
      <section className="card" style={{ marginTop: '16px' }}>
        <h2>Knowledge Base & Resolution Playbooks</h2>
        <small style={{ display: 'block', marginBottom: '12px' }}>
          Standardized resolution articles to resolve customer inquiries quickly and accurately.
        </small>
        <div className="preview-list">
          {kbArticles.map((kb, idx) => (
            <div
              className="preview-row"
              key={kb.title}
              onClick={() => setActiveKb(activeKb === idx ? null : idx)}
              style={{ cursor: 'pointer' }}
            >
              <div>
                <b>{kb.title}</b>
                <small>{kb.category}</small>
                {activeKb === idx && (
                  <p style={{ marginTop: '6px', fontSize: '13px', color: '#4b5563' }}>
                    {kb.snippet}
                  </p>
                )}
              </div>
              <span className="badge">
                {activeKb === idx ? 'Collapse ▴' : 'Read Article ▾'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
