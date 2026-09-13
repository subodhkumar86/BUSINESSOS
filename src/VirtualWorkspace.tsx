import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot, State } from './types'
interface Announcement {
  id: string
  title: string
  body: string
  created_at: string
}
interface WorkspaceMessage { id: string; body: string; created_at: string; sender_name: string; sender_role: string }
const demoChatStorageKey = 'businessos-demo-team-chat'
export function VirtualWorkspace({
  remote,
  state,
}: {
  remote: Snapshot | null
  state: State
}) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [messages, setMessages] = useState<WorkspaceMessage[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(remote))
  useEffect(() => {
    if (!remote) {
      try {
        const saved = JSON.parse(localStorage.getItem(demoChatStorageKey) || '[]')
        if (Array.isArray(saved)) setMessages(saved)
      } catch {
        localStorage.removeItem(demoChatStorageKey)
      }
      return
    }
    let active = true
    Promise.all([request<{ notifications: Announcement[] }>('/notifications'), request<{ messages: WorkspaceMessage[] }>('/workspace/chat')])
      .then(([data, chat]) => {
        if (active) { setAnnouncements(data.notifications); setMessages(chat.messages) }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load announcements.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [remote])
  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = message.trim()
    if (!body) return
    if (!remote) {
      const created: WorkspaceMessage = { id: crypto.randomUUID(), body, created_at: new Date().toISOString(), sender_name: 'Demo owner', sender_role: 'owner' }
      setMessages((current) => {
        const next = [...current, created]
        localStorage.setItem(demoChatStorageKey, JSON.stringify(next))
        return next
      })
      setMessage('')
      return
    }
    try {
      const created = await request<WorkspaceMessage>('/workspace/chat', { method: 'POST', headers: { 'X-CSRF-Token': remote.csrf }, body: JSON.stringify({ body }) })
      setMessages((current) => [...current, created]); setMessage('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send message.') }
  }
  return (
    <div className="module-panel">
      <section className="card">
        <h2>Tasks</h2>
        <p>Tasks recorded in your workspace.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.name}</td>
                  <td>{task.status}</td>
                </tr>
              ))}
              {!state.tasks.length && (
                <tr>
                  <td colSpan={2}>No records yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="section-header"><div><h2>Team chat</h2><small>Tenant-private messages for your workspace.</small></div></div>
        <div className="preview-list">
          {messages.map((item) => <article className="preview-row" key={item.id}><div><b>{item.sender_name}</b><small>{item.body}</small></div><small>{new Date(item.created_at).toLocaleString()}</small></article>)}
          {!messages.length && !loading && <p className="empty">No messages yet. Start the conversation.</p>}
        </div>
        {remote?.user.role !== 'auditor' && <form className="inline-form" onSubmit={(event) => void sendMessage(event)}><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} placeholder="Write a team message" required /><button className="primary">Send message</button></form>}
      </section>
      <section className="card">
        <h2>Company announcements</h2>
        {remote?.user.role === 'owner' && (
          <p>Use the notification menu to publish an announcement.</p>
        )}
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p role="status">Loading data...</p>
        ) : announcements.length ? (
          announcements.map((item) => (
            <article key={item.id}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <time dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleString()}
              </time>
            </article>
          ))
        ) : (
          <p>No announcements yet.</p>
        )}
      </section>
    </div>
  )
}
