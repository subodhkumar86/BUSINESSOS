import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

export interface DocumentItem {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  version: number
  status: 'active' | 'archived'
  category?: string
  uploaded_by?: string
  created_at?: string
  updated_at?: string
}
interface DocumentComment { id: string; body: string; author: string; created_at: string }

const demoDocuments: DocumentItem[] = [
  {
    id: 'doc-1',
    filename: 'Kora_Imports_Master_Supply_Agreement.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2_450_000,
    storage_key: 'procurement/kora-agreement-v2.pdf',
    version: 2,
    status: 'active',
    category: 'Procurement',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'doc-2',
    filename: 'Nigeria_Tax_Act_2026_Compliance_Policy.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1_120_000,
    storage_key: 'compliance/tax-policy-2026.pdf',
    version: 1,
    status: 'active',
    category: 'Legal',
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'doc-3',
    filename: 'September_Payroll_Breakdown_Audited.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size_bytes: 840_000,
    storage_key: 'hr/payroll-sept-2026.xlsx',
    version: 3,
    status: 'active',
    category: 'HR',
    created_at: new Date(Date.now() - 43200000).toISOString(),
  },
  {
    id: 'doc-4',
    filename: 'Lagos_Warehouse_Lease_Contract_Signed.pdf',
    mime_type: 'application/pdf',
    size_bytes: 4_800_000,
    storage_key: 'operations/warehouse-lease.pdf',
    version: 1,
    status: 'active',
    category: 'Operations',
    created_at: new Date(Date.now() - 604800000).toISOString(),
  },
]

const categories = ['All', 'Procurement', 'HR', 'Legal', 'Finance', 'Operations']

function asBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

export function DocumentsPanel({ remote }: { remote: Snapshot | null }) {
  const [documents, setDocuments] = useState<DocumentItem[]>(() =>
    remote ? [] : demoDocuments,
  )
  const [loading, setLoading] = useState(Boolean(remote))
  const [selectedFolder, setSelectedFolder] = useState('All')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sharedLink, setSharedLink] = useState<{ id: string; url: string; expires: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const [commentDocument, setCommentDocument] = useState<DocumentItem | null>(null)
  const [comments, setComments] = useState<DocumentComment[]>([])
  const [commentText, setCommentText] = useState('')
  const [revisionDocument, setRevisionDocument] = useState<DocumentItem | null>(null)

  const editable = !remote || remote.user.role !== 'auditor'

  useEffect(() => {
    let active = true
    if (!remote) return
    request<{ documents: DocumentItem[] }>('/documents')
      .then((data) => {
        if (active) setDocuments(data.documents)
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

  async function handleRegisterFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const file = values.file
    if (!(file instanceof File) || !file.size) {
      setError('Choose a document to upload.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Document uploads are limited to 2 MB in local storage.')
      return
    }
    const filename = file.name.trim()
    const category = String(values.category || 'Operations')
    const sizeBytes = file.size
    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      const newDoc: DocumentItem = {
        id: 'doc-' + Date.now(),
        filename,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: sizeBytes,
        storage_key: `${category.toLowerCase()}/${filename}`,
        version: 1,
        status: 'active',
        category,
        created_at: new Date().toISOString(),
      }
      setDocuments((prev) => [newDoc, ...prev])
      form.reset()
      setNotice('Document registered in workspace vault (demo).')
      setBusy(false)
      return
    }

    try {
      await request('/documents', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          filename,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes,
          contentBase64: await asBase64(file),
        }),
      })
      form.reset()
      setNotice('Document uploaded, stored, and audited on the server.')
      setRevision((r) => r + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register document.')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleStatus(doc: DocumentItem) {
    if (!editable) return
    const nextStatus = doc.status === 'active' ? 'archived' : 'active'
    setBusy(true)
    setError('')
    setNotice('')

    if (!remote) {
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, status: nextStatus } : d)),
      )
      setNotice(`Document marked as ${nextStatus} (demo).`)
      setBusy(false)
      return
    }

    try {
      await request(`/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ status: nextStatus }),
      })
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, status: nextStatus } : d)),
      )
      setNotice(`Document status updated to ${nextStatus}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update document status.')
    } finally {
      setBusy(false)
    }
  }

  async function generateSecureShareLink(doc: DocumentItem, hours = 24) {
    if (!remote) {
      const token = crypto.randomUUID().replace(/-/g, '')
      const expiresMs = Date.now() + hours * 3600 * 1000
      setSharedLink({
        id: doc.id,
        url: `${window.location.origin}/share/doc/${doc.id}?token=${token}&exp=${expiresMs}`,
        expires: new Date(expiresMs).toLocaleString(),
      })
      setNotice(`Demo share link generated (valid for ${hours}h).`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await request<{ token: string; expiresAt: string }>(
        `/documents/${doc.id}/shares`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': remote.csrf },
          body: JSON.stringify({ expiresHours: hours }),
        },
      )
      const apiOrigin = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '')
      setSharedLink({
        id: doc.id,
        url: `${apiOrigin}/api/v1/shared-documents/${result.token}`,
        expires: new Date(result.expiresAt).toLocaleString(),
      })
      setNotice(`Secure share link generated (valid for ${hours}h).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a secure share link.')
    } finally {
      setBusy(false)
    }
  }

  async function openComments(doc: DocumentItem) {
    setCommentDocument(doc); setComments([]); setCommentText(''); setError('')
    if (!remote) return
    try { const result = await request<{ comments: DocumentComment[] }>(`/documents/${doc.id}/comments`); setComments(result.comments) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load comments.') }
  }
  async function addComment(event: React.FormEvent) {
    event.preventDefault()
    if (!commentDocument || !commentText.trim()) return
    if (!remote) { setComments(current => [{ id: 'comment-' + Date.now(), body: commentText.trim(), author: 'Demo user', created_at: new Date().toISOString() }, ...current]); setCommentText(''); return }
    setBusy(true); setError('')
    try { await request(`/documents/${commentDocument.id}/comments`, { method: 'POST', headers: { 'X-CSRF-Token': remote.csrf }, body: JSON.stringify({ body: commentText.trim() }) }); setCommentText(''); await openComments(commentDocument) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add comment.') } finally { setBusy(false) }
  }
  async function uploadRevision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!revisionDocument) return
    const file = new FormData(event.currentTarget).get('revision')
    if (!(file instanceof File) || !file.size) return setError('Choose a replacement file.')
    if (file.size > 2 * 1024 * 1024) return setError('Document revisions are limited to 2 MB.')
    setBusy(true); setError('')
    try {
      if (remote) await request(`/documents/${revisionDocument.id}/versions`, { method: 'POST', headers: { 'X-CSRF-Token': remote.csrf }, body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, contentBase64: await asBase64(file) }) })
      else setDocuments(current => current.map(doc => doc.id === revisionDocument.id ? { ...doc, filename: file.name, size_bytes: file.size, version: doc.version + 1, updated_at: new Date().toISOString() } : doc))
      setNotice('New document version saved. The prior binary remains in history.'); setRevisionDocument(null); setRevision(rev => rev + 1)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not upload revision.') } finally { setBusy(false) }
  }

  const filtered = documents.filter((d) => {
    const matchesSearch = d.filename.toLowerCase().includes(search.toLowerCase())
    const matchesFolder =
      selectedFolder === 'All' || (d.category || 'Operations') === selectedFolder
    return matchesSearch && matchesFolder
  })

  const totalBytes = documents.reduce((acc, d) => acc + d.size_bytes, 0)
  const mbFormatted = (totalBytes / (1024 * 1024)).toFixed(1)

  return (
    <div className="module-panel">
      {/* Telemetry Row */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Total Documents</span>
          <b className="stat-value">{documents.length}</b>
          <small>Indexed master records</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Vault Storage</span>
          <b className="stat-value">{mbFormatted} MB</b>
          <small>Of 10.0 GB tenant quota</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Folders</span>
          <b className="stat-value">{categories.length - 1}</b>
          <small>Procurement, HR, Legal, etc.</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Access Policy</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>Audited</b>
          <small>Tenant-scoped RLS security</small>
        </div>
      </div>

      {error && <p role="alert" className="notice error">{error}</p>}
      {notice && <p role="status" className="notice success">{notice}</p>}

      {/* Share Link Modal / Banner */}
      {sharedLink && (
        <div className="notice" style={{ background: '#f5f3ff', borderColor: '#c4b5fd' }}>
          <b>Secure external share link</b>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              readOnly
              value={sharedLink.url}
              style={{ flex: 1, minWidth: '240px', fontSize: '12px' }}
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(sharedLink.url)
                setNotice('Link copied to clipboard!')
              }}
            >
              Copy link
            </button>
            <button onClick={() => setSharedLink(null)}>Dismiss</button>
          </div>
          <small style={{ display: 'block', marginTop: '4px', color: '#6d28d9' }}>
            Token expires on {sharedLink.expires}. Access is strictly read-only and logged in the immutable audit trail.
          </small>
        </div>
      )}

      {/* Main Folder + Document Browser */}
      <section className="card">
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2>Document Vault & Repository</h2>
            <small>Contracts, policies, receipts, statements, and verifiable operating records.</small>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: '200px' }}
            />
          </div>
        </div>

        {/* Folder Pills */}
        <div style={{ display: 'flex', gap: '8px', margin: '12px 0', flexWrap: 'wrap' }}>
          {categories.map((folder) => (
            <button
              key={folder}
              type="button"
              className={selectedFolder === folder ? 'primary' : ''}
              onClick={() => setSelectedFolder(folder)}
            >
              {folder}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="empty">Loading documents…</p>
        ) : filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Document Name</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <b>{doc.filename}</b>
                      <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                        {doc.storage_key}
                      </small>
                    </td>
                    <td>{doc.category || 'General'}</td>
                    <td>{Math.round(doc.size_bytes / 1024)} KB</td>
                    <td>
                      <span className="badge">v{doc.version}</span>
                    </td>
                    <td>
                      <span className={doc.status === 'active' ? 'badge green' : 'badge'}>
                        {doc.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => {
                            void generateSecureShareLink(doc, 24)
                          }}
                          disabled={busy || Boolean(remote && doc.status !== 'active')}
                          title="Generate a secure 24h external link"
                        >
                          Share link
                        </button>
                        {remote && (
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/v1/documents/${doc.id}/content`,
                                '_blank',
                                'noopener',
                              )
                            }
                          >
                            Download
                          </button>
                        )}
                        <button type="button" onClick={() => void openComments(doc)}>Comments</button>
                        {editable && <button type="button" disabled={busy || doc.status !== 'active'} onClick={() => setRevisionDocument(doc)}>New version</button>}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => void handleToggleStatus(doc)}
                          >
                            {doc.status === 'active' ? 'Archive' : 'Restore'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No documents found in this folder.</p>
        )}
      </section>

      {commentDocument && (
        <section className="card">
          <div className="section-header"><div><h2>Comments · {commentDocument.filename}</h2><small>Comments are attributed and cannot be edited or removed.</small></div><button type="button" onClick={() => setCommentDocument(null)}>Close</button></div>
          {editable && <form className="inline-form" onSubmit={addComment}><input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add a review note or question" maxLength={1000} required /><button className="primary" disabled={busy}>Comment</button></form>}
          {comments.length ? <div className="preview-list">{comments.map((comment) => <div className="preview-row" key={comment.id}><div><b>{comment.author}</b><small>{comment.body}</small></div><small>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(comment.created_at))}</small></div>)}</div> : <p className="muted">No comments yet.</p>}
        </section>
      )}

      {revisionDocument && <section className="card"><div className="section-header"><div><h2>Upload revision · {revisionDocument.filename}</h2><small>The current file becomes immutable history before this revision replaces it.</small></div><button type="button" onClick={() => setRevisionDocument(null)}>Close</button></div><form className="inline-form" onSubmit={uploadRevision}><input name="revision" type="file" required /><button className="primary" disabled={busy}>Upload revision</button></form></section>}

      {/* Upload & Registration Form */}
      {editable && (
        <section className="card">
          <h2>Upload Document to Workspace</h2>
          <form className="inline-form" onSubmit={handleRegisterFile}>
            <input
              name="file"
              type="file"
              accept=".pdf,.csv,.txt,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              required
            />
            <select name="category" defaultValue="Operations" aria-label="Folder Category">
              <option value="Procurement">Procurement</option>
              <option value="HR">HR & People</option>
              <option value="Legal">Legal & Compliance</option>
              <option value="Finance">Finance & Tax</option>
              <option value="Operations">Operations</option>
            </select>
            <button className="primary" disabled={busy} type="submit">
              + Upload Document
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
