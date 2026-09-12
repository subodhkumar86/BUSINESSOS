import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

export interface Supplier {
  id: string
  name: string
  contact: string
  lead_days: number
  status: 'active' | 'review' | 'inactive'
  created_at?: string
  updated_at?: string
}

const demoSuppliers: Supplier[] = [
  {
    id: 'sup-1',
    name: 'Kora Imports & Logistics Ltd',
    contact: 'Ibrahim Musa · supplies@koraimports.ng',
    lead_days: 14,
    status: 'active',
  },
  {
    id: 'sup-2',
    name: 'Brightline Displays & Peripherals',
    contact: 'Ngozi Eze · orders@brightline.com',
    lead_days: 21,
    status: 'review',
  },
  {
    id: 'sup-3',
    name: 'TechHub Hardware Distribution',
    contact: 'Femi Alabi · sales@techhub.ng',
    lead_days: 7,
    status: 'active',
  },
  {
    id: 'sup-4',
    name: 'Apex Industrial Packaging',
    contact: 'Chioma Okeke · procurement@apexpack.com',
    lead_days: 5,
    status: 'active',
  },
]

export function SuppliersPanel({
  remote,
  onNavigateToProcurement,
}: {
  remote: Snapshot | null
  onNavigateToProcurement?: () => void
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>(() =>
    remote ? [] : demoSuppliers,
  )
  const [loading, setLoading] = useState(Boolean(remote))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'review' | 'inactive'>('all')
  const [revision, setRevision] = useState(0)

  const editable =
    !remote ||
    ['owner', 'operations_manager'].includes(remote.user.role)

  useEffect(() => {
    let active = true
    if (!remote) return
    request<{ suppliers: Supplier[] }>('/suppliers')
      .then((data) => {
        if (active) setSuppliers(data.suppliers)
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

  async function handleCreateSupplier(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const leadDays = Number(values.leadDays) || 7
    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      const newSup: Supplier = {
        id: 'sup-' + Date.now(),
        name: String(values.name),
        contact: String(values.contact || ''),
        lead_days: leadDays,
        status: 'active',
      }
      setSuppliers((prev) => [newSup, ...prev])
      form.reset()
      setNotice('Supplier registered successfully (demo session).')
      setBusy(false)
      return
    }

    try {
      await request('/suppliers', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          name: values.name,
          contact: values.contact,
          leadDays,
        }),
      })
      form.reset()
      setNotice('Supplier registered and recorded in audit log.')
      setRevision((r) => r + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add supplier.')
    } finally {
      setBusy(false)
    }
  }

  async function handleStatusChange(
    supplierId: string,
    newStatus: 'active' | 'review' | 'inactive',
  ) {
    if (!editable) return
    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      setSuppliers((prev) =>
        prev.map((s) => (s.id === supplierId ? { ...s, status: newStatus } : s)),
      )
      setNotice(`Supplier status updated to ${newStatus} (demo).`)
      setBusy(false)
      return
    }

    try {
      await request(`/suppliers/${supplierId}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ status: newStatus }),
      })
      setSuppliers((prev) =>
        prev.map((s) => (s.id === supplierId ? { ...s, status: newStatus } : s)),
      )
      setNotice(`Supplier status changed to ${newStatus}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.')
    } finally {
      setBusy(false)
    }
  }

  const filtered = suppliers.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.contact.toLowerCase().includes(search.toLowerCase())
    const matchesStatus =
      statusFilter === 'all' || s.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const avgLeadTime = suppliers.length
    ? Math.round(
        suppliers.reduce((acc, s) => acc + s.lead_days, 0) / suppliers.length,
      )
    : 0

  return (
    <div className="module-panel">
      {/* Metrics Banner */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Total Suppliers</span>
          <b className="stat-value">{suppliers.length}</b>
          <small>Registered procurement vendors</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Vendors</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>
            {suppliers.filter((s) => s.status === 'active').length}
          </b>
          <small>Eligible for purchase orders</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg Lead Time</span>
          <b className="stat-value">{avgLeadTime} days</b>
          <small>Average transit from PO to dock</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Under Review</span>
          <b className="stat-value" style={{ color: '#eab308' }}>
            {suppliers.filter((s) => s.status === 'review').length}
          </b>
          <small>Compliance or delivery review</small>
        </div>
      </div>

      {error && <p role="alert" className="notice error">{error}</p>}
      {notice && <p role="status" className="notice success">{notice}</p>}

      {/* Directory Section */}
      <section className="card">
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2>Supplier & Vendor Directory</h2>
            <small>Profiles, lead times, compliance standing, and delivery commitments.</small>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Search suppliers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: '200px' }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label="Filter suppliers by status"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="review">Under review</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="empty">Loading suppliers…</p>
        ) : filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Primary Contact</th>
                  <th>Lead Time</th>
                  <th>Compliance & Standing</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b>
                    </td>
                    <td>
                      <small>{s.contact || 'No contact specified'}</small>
                    </td>
                    <td>
                      <span className="badge" style={{ background: s.lead_days <= 7 ? '#f0fdf4' : s.lead_days <= 14 ? '#fefce8' : '#fef2f2', color: s.lead_days <= 7 ? '#15803d' : s.lead_days <= 14 ? '#a16207' : '#b91c1c' }}>
                        ⏱ {s.lead_days} days
                      </span>
                    </td>
                    <td>
                      <select
                        disabled={busy || !editable}
                        value={s.status}
                        onChange={(e) =>
                          void handleStatusChange(
                            s.id,
                            e.target.value as Supplier['status'],
                          )
                        }
                        aria-label={`Status for ${s.name}`}
                      >
                        <option value="active">Active (Approved)</option>
                        <option value="review">Under review</option>
                        <option value="inactive">Inactive (Blocked)</option>
                      </select>
                    </td>
                    <td>
                      {onNavigateToProcurement && (
                        <button
                          type="button"
                          onClick={onNavigateToProcurement}
                          title="Create Purchase Order"
                        >
                          + Create PO
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No suppliers match the current query.</p>
        )}
      </section>

      {/* Supplier Registration Form */}
      {editable && (
        <section className="card">
          <h2>Register New Supplier</h2>
          <form className="inline-form" onSubmit={handleCreateSupplier}>
            <input
              name="name"
              placeholder="Company / Vendor Name (e.g. Lagos Spares Co)"
              required
            />
            <input
              name="contact"
              placeholder="Contact Person, Phone or Email"
              required
            />
            <input
              name="leadDays"
              type="number"
              min="1"
              max="365"
              defaultValue="14"
              placeholder="Lead time (days)"
              required
              style={{ width: '120px' }}
            />
            <button className="primary" disabled={busy} type="submit">
              + Add Supplier
            </button>
          </form>
        </section>
      )}

      {/* Supplier operating cues use the current directory, not invented service metrics. */}
      <div className="two-col supplier-cues">
        <section className="card">
          <h2>Supplier operating cues</h2>
          <div className="telemetry-list">
            <div className="telemetry-item">
              <span>Active vendors available</span>
              <b>{suppliers.filter((s) => s.status === 'active').length}</b>
            </div>
            <div className="telemetry-item">
              <span>Suppliers under review</span>
              <b>{suppliers.filter((s) => s.status === 'review').length}</b>
            </div>
            <div className="telemetry-item">
              <span>Typical listed lead time</span>
              <b>{avgLeadTime || '—'}{avgLeadTime ? ' days' : ''}</b>
            </div>
            <div className="telemetry-item">
              <span>Fastest listed lead time</span>
              <b>{suppliers.length ? Math.min(...suppliers.map((s) => s.lead_days)) + ' days' : '—'}</b>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Procurement controls</h2>
          <div className="preview-list">
            <div className="preview-row">
              <div>
                <b>Review suppliers before ordering</b>
                <small>Use the directory status to keep suppliers under review out of normal purchasing decisions.</small>
              </div>
              <span className="badge">Directory control</span>
            </div>
            <div className="preview-row">
              <div>
                <b>Keep source documents with the purchase</b>
                <small>Use Documents & Media to retain supplier agreements, tax records and delivery evidence.</small>
              </div>
              <span className="badge">Workflow guidance</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
