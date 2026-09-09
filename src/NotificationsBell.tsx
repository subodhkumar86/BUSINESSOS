import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot } from './types'

interface Notification { id: string; title: string; body: string; created_at: string }

export function NotificationsBell({ remote }: { remote: Snapshot | null }) {
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState(true)
  const [compose, setCompose] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  async function load() {
    if (!remote) return
    try { const result = await request<{ notifications: Notification[] }>('/notifications?unread=true'); setItems(result.notifications); setAvailable(true) }
    catch { setAvailable(false) }
  }
  useEffect(() => { void load(); if (!remote) return; const timer = window.setInterval(() => void load(), 60000); return () => window.clearInterval(timer) }, [remote])
  async function markRead(id: string) {
    try { await request('/notifications/' + id + '/read', { method: 'PATCH', headers: { 'X-CSRF-Token': remote?.csrf || '' }, body: '{}' }); setItems(current => current.filter(item => item.id !== id)) }
    catch { setAvailable(false) }
  }
  async function publish(event: React.FormEvent) {
    event.preventDefault()
    try { await request('/notifications', { method: 'POST', headers: { 'X-CSRF-Token': remote?.csrf || '' }, body: JSON.stringify({ title, body }) }); setTitle(''); setBody(''); setCompose(false); await load() }
    catch { setAvailable(false) }
  }
  if (!remote) return null
  return <div className="notification-menu">
    <button className="notification-trigger" type="button" aria-label={`Notifications${items.length ? ` (${items.length} unread)` : ''}`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {items.length > 0 && <span className="notification-count">{items.length > 9 ? '9+' : items.length}</span>}
    </button>
    {open && <section className="notification-popover" aria-label="Notifications">
      <header><div><b>Notifications</b><small>{items.length ? `${items.length} unread` : 'All caught up'}</small></div><button type="button" className="notification-close" onClick={() => setOpen(false)} aria-label="Close notifications">×</button></header>
      {!available && <p className="notification-unavailable">Notifications are temporarily unavailable. Refresh after the API restarts.</p>}
      {remote.user.role === 'owner' && <div className="notification-compose"><button type="button" onClick={() => setCompose(value => !value)}>{compose ? 'Cancel' : 'New announcement'}</button>{compose && <form onSubmit={publish}><input required value={title} onChange={event => setTitle(event.target.value)} placeholder="Title" maxLength={160} /><textarea required value={body} onChange={event => setBody(event.target.value)} placeholder="Share an update with your team" maxLength={1000} /><button className="primary">Publish</button></form>}</div>}
      <div className="notification-list">{items.length ? items.map(item => <button type="button" key={item.id} className="notification-item" onClick={() => void markRead(item.id)}><span className="notification-dot" /><span><b>{item.title}</b><small>{item.body}</small><time>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))}</time></span></button>) : <p className="notification-empty">Nothing needs your attention.</p>}</div>
    </section>}
  </div>
}
