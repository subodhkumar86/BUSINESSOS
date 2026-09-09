import { useEffect, useState } from 'react'
import { request } from './api'
import type { Snapshot, State } from './types'
interface Announcement {
  id: string
  title: string
  body: string
  created_at: string
}
export function VirtualWorkspace({
  remote,
  state,
}: {
  remote: Snapshot | null
  state: State
}) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(remote))
  useEffect(() => {
    if (!remote) return
    let active = true
    request<{ notifications: Announcement[] }>('/notifications')
      .then((data) => {
        if (active) setAnnouncements(data.notifications)
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
