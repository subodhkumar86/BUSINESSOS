import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  accessChangeAllowed,
  actionAllowed,
  passwordChangeSchema,
  sessionIsCurrent,
  storedSessionSchema,
  type AccountRow,
  type Session,
} from '../server/security.ts'
const account: AccountRow = {
  id: randomUUID(),
  tenant_id: randomUUID(),
  name: 'Owner',
  email: 'owner@example.test',
  role: 'owner',
  active: true,
  session_version: 3,
}
const session: Session = {
  user: {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
  },
  tenant: account.tenant_id,
  csrf: 'a'.repeat(64),
  sessionVersion: 3,
}
test('current session requires matching user, tenant and active version', () => {
  assert.equal(sessionIsCurrent(session, account), true)
  for (const patch of [
    { active: false },
    { session_version: 4 },
    { tenant_id: randomUUID() },
    { id: randomUUID() },
  ])
    assert.equal(sessionIsCurrent(session, { ...account, ...patch }), false)
  assert.equal(sessionIsCurrent(session, undefined), false)
})
test('re-enabling account never revives its prior sessions', () => {
  const disabled = { ...account, active: false, session_version: 4 }
  const restored = { ...disabled, active: true, session_version: 5 }
  assert.equal(sessionIsCurrent(session, disabled), false)
  assert.equal(sessionIsCurrent(session, restored), false)
  assert.equal(
    sessionIsCurrent({ ...session, sessionVersion: 5 }, restored),
    true,
  )
})
test('legacy or malformed cached sessions are rejected', () => {
  assert.equal(storedSessionSchema.safeParse(session).success, true)
  const { sessionVersion, ...legacy } = session
  assert.equal(sessionVersion, 3)
  for (const value of [
    null,
    legacy,
    { ...session, csrf: '' },
    { ...session, tenant: 'other' },
    { ...session, user: { ...session.user, role: 'admin' } },
  ])
    assert.equal(storedSessionSchema.safeParse(value).success, false)
})
test('owner can only change auditor access and cannot disable self', () => {
  const auditor = { ...account, id: randomUUID(), role: 'auditor' as const }
  assert.equal(accessChangeAllowed(account, auditor), true)
  assert.equal(accessChangeAllowed(account, account), false)
  assert.equal(accessChangeAllowed(auditor, account), false)
  assert.equal(
    accessChangeAllowed(account, { ...account, id: randomUUID() }),
    false,
  )
})
test('module permissions grant only the role workflows defined by RBAC', () => {
  assert.equal(actionAllowed('owner', { type: 'settings' }), true)
  assert.equal(actionAllowed('finance_admin', { type: 'create', collection: 'expenses' }), true)
  assert.equal(actionAllowed('finance_admin', { type: 'create', collection: 'employees' }), false)
  assert.equal(actionAllowed('hr_admin', { type: 'payroll' }), true)
  assert.equal(actionAllowed('operations_manager', { type: 'stock_adjust' }), true)
  assert.equal(actionAllowed('sales_crm_user', { type: 'create', collection: 'leads' }), true)
  assert.equal(actionAllowed('employee', { type: 'status', collection: 'tasks' }), true)
  assert.equal(actionAllowed('auditor', { type: 'status', collection: 'tasks' }), false)
})
test('password changes require distinct bounded current and new passwords', () => {
  assert.equal(
    passwordChangeSchema.safeParse({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
    }).success,
    true,
  )
  for (const value of [
    { currentPassword: 'same-password-123', newPassword: 'same-password-123' },
    { currentPassword: '', newPassword: 'valid-password-123' },
    { currentPassword: 'old', newPassword: 'short' },
    { currentPassword: 'old', newPassword: 'a'.repeat(129) },
    {
      currentPassword: 'old',
      newPassword: 'valid-password-123',
      role: 'owner',
    },
  ])
    assert.equal(passwordChangeSchema.safeParse(value).success, false)
})
