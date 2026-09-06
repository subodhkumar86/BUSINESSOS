import { useEffect, useState } from 'react'
import { request } from './api'
import { userRoles, type User, type UserRole } from './types'
import { RoleMatrix } from './RoleMatrix'
type Member = User & { active: boolean }
export function Team({ csrf }: { csrf: string }) {
  const [members, setMembers] = useState<Member[]>([]),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true)
  async function refresh() {
    const data = await request<{ users: Member[] }>('/users')
    setMembers(data.users)
  }
  useEffect(() => {
    let active = true
    request<{ users: Member[] }>('/users')
      .then((r) => {
        if (active) setMembers(r.users)
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
  }, [])
  async function changeAccess(member: Member) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request('/users/' + member.id + '/access', {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': csrf },
        body: JSON.stringify({ active: !member.active }),
      })
      await refresh()
      setMessage(
        member.active
          ? 'Access disabled. Existing sessions are revoked.'
          : 'Access restored. The user must sign in again.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update access.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="section-top">
        <h2>Team access</h2>
        <button
          disabled={busy || loading}
          onClick={() => {
            setLoading(true)
            setError('')
            void refresh()
              .catch((e) => setError(e.message))
              .finally(() => setLoading(false))
          }}
        >
          Refresh users
        </button>
      </div>
      {loading ? (
        <p role="status">Loading users...</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Access</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>{member.name}</td>
                  <td>{member.email}</td>
                  <td>{member.role}</td>
                  <td>{member.active ? 'Active' : 'Disabled'}</td>
                  <td>
                    {member.role !== 'owner' ? (
                      <button
                        disabled={busy}
                        onClick={() => void changeAccess(member)}
                      >
                        {member.active ? 'Disable access' : 'Restore access'}
                      </button>
                    ) : (
                      <span>Workspace owner</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!members.length && !error && <p>No users found.</p>}
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <h3>Invite a team member</h3>
      <p>Create an account for this workspace. No email is sent.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy) return
          const form = e.currentTarget
          setBusy(true)
          setError('')
          setMessage('')
          try {
            await request('/users', {
              method: 'POST',
              headers: { 'X-CSRF-Token': csrf },
              body: JSON.stringify({
                ...Object.fromEntries(new FormData(form)),
                role: new FormData(form).get('role') as UserRole,
              }),
            })
            form.reset()
            await refresh()
            setMessage(
              'User created successfully with role. Share the initial credentials through your secure channel.',
            )
          } catch (e) {
            setError(
              e instanceof Error ? e.message : 'Could not create account.',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          Role
          <select name="role" defaultValue="employee">
            {userRoles.filter((role) => role !== 'owner').map((role) => (
              <option key={role} value={role}>
                {role.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input required name="name" maxLength={200} />
        </label>
        <label>
          Email
          <input required name="email" type="email" />
        </label>
        <label>
          Initial password
          <input
            required
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <button disabled={busy} className="primary">
          {busy ? 'Saving...' : 'Create account'}
        </button>
      </form>

      <div style={{ marginTop: '2rem' }}>
        <RoleMatrix />
      </div>
    </section>
  )
}
