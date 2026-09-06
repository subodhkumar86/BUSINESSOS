import { useState } from 'react'
import { userRoles, roleMatrix, type UserRole } from './types'

export function RoleMatrix({ onSelectRole }: { onSelectRole?: (role: UserRole) => void }) {
  const [selectedRole, setSelectedRole] = useState<UserRole>('owner')

  const info = roleMatrix[selectedRole]

  return (
    <div className="role-matrix-container card">
      <div className="section-top">
        <div>
          <h2>Role & Access Control Matrix</h2>
          <p className="subtitle">
            Complete security specification: who has access to which modules, what actions are permitted, and mandatory restrictions.
          </p>
        </div>
      </div>

      <div className="role-selector-pills">
        {userRoles.map((role) => (
          <button
            key={role}
            className={`role-pill ${selectedRole === role ? 'active' : ''}`}
            onClick={() => {
              setSelectedRole(role)
              if (onSelectRole) onSelectRole(role)
            }}
            type="button"
          >
            <b>{roleMatrix[role].title}</b>
            <small>{role.replaceAll('_', ' ')}</small>
          </button>
        ))}
      </div>

      <div className="role-detail-card">
        <div className="role-header">
          <div>
            <span className="role-badge">{info.title}</span>
            <h3>{info.accessSummary}</h3>
          </div>
        </div>

        <div className="two-col role-two-col">
          <div className="permission-box can-do">
            <h4>✓ Allowed Workflows & Capabilities</h4>
            <p>{info.canDo}</p>
            <div className="allowed-modules-list">
              <strong>Permitted Workspaces:</strong>
              <div className="tags">
                {info.allowedPages.map((page) => (
                  <span key={page} className="tag-module">
                    {page === '*' ? 'All Business Modules (1–20)' : page}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="permission-box restrictions">
            <h4>✕ Strict Boundaries & Restrictions</h4>
            <p>{info.restrictions}</p>
            <div className="security-note">
              <strong>Enforcement:</strong>
              <p>
                Server-side validated on every request. Client-side navigation hides unauthorized routes. High-value actions require cryptographic audit trails.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="table-scroll role-matrix-table">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Primary Scope</th>
              <th>Allowed Actions</th>
              <th>Key Restrictions</th>
            </tr>
          </thead>
          <tbody>
            {userRoles.map((role) => {
              const item = roleMatrix[role]
              return (
                <tr
                  key={role}
                  className={selectedRole === role ? 'highlighted-row' : ''}
                  onClick={() => setSelectedRole(role)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <strong>{item.title}</strong>
                    <br />
                    <small className="mono">{role}</small>
                  </td>
                  <td>{item.accessSummary}</td>
                  <td>{item.canDo}</td>
                  <td>
                    <span className="restriction-text">{item.restrictions}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
