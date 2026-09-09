import test from 'node:test'
import assert from 'node:assert/strict'
import {
  workflowSchemas,
  workflowPatch,
  validateWorkflowChange,
  canReadWorkflow,
  workflowWriters,
} from '../src/workflow-contracts.ts'
test('workflow schemas reject impossible dates, unknown fields, inverted ranges and invalid targets', () => {
  assert.equal(
    workflowSchemas.leave.safeParse({
      employeeId: 'e1',
      startDate: '2026-02-30',
      endDate: '2026-03-02',
      reason: 'Leave',
    }).success,
    false,
  )
  assert.equal(
    workflowSchemas.leave.safeParse({
      employeeId: 'e1',
      startDate: '2026-09-10',
      endDate: '2026-09-09',
      reason: 'Leave',
    }).success,
    false,
  )
  assert.equal(
    workflowSchemas.goals.safeParse({
      employeeId: 'e1',
      title: 'Sales',
      target: 0,
      unit: 'orders',
      dueDate: '2026-12-31',
    }).success,
    false,
  )
  assert.equal(
    workflowSchemas.knowledge.safeParse({
      title: 'Help',
      category: 'General',
      content: 'Content',
      tenant_id: 'other',
    }).success,
    false,
  )
  assert.equal(
    workflowSchemas.appointments.safeParse({
      title: 'Visit',
      guest: 'Guest',
      host: 'Host',
      room: 'A',
      startAt: '2026-09-10T11:00:00Z',
      endAt: '2026-09-10T10:00:00Z',
    }).success,
    false,
  )
  assert.equal(workflowPatch.safeParse({ version: 1 }).success, false)
})
test('goals require target completion and findings require evidence and ordered closure', () => {
  assert.throws(
    () =>
      validateWorkflowChange(
        'goals',
        { status: 'active', data: { target: 10, progress: 9 } },
        { version: 1, status: 'completed' },
      ),
    /target/,
  )
  assert.doesNotThrow(() =>
    validateWorkflowChange(
      'goals',
      { status: 'active', data: { target: 10 } },
      { version: 1, status: 'completed', progress: 10 },
    ),
  )
  assert.throws(() =>
    validateWorkflowChange(
      'goals',
      { status: 'completed', data: { target: 10 } },
      { version: 2, progress: 0 },
    ),
  )
  assert.throws(() =>
    validateWorkflowChange(
      'findings',
      { status: 'open', data: {} },
      { version: 1, status: 'closed' },
    ),
  )
  assert.throws(
    () =>
      validateWorkflowChange(
        'findings',
        { status: 'in_progress', data: {} },
        { version: 2, status: 'closed' },
      ),
    /evidence/,
  )
  assert.doesNotThrow(() =>
    validateWorkflowChange(
      'findings',
      { status: 'in_progress', data: {} },
      { version: 2, status: 'closed', evidence: 'Verified repair' },
    ),
  )
  assert.throws(() =>
    validateWorkflowChange(
      'appointments',
      { status: 'cancelled', data: {} },
      { version: 2, status: 'scheduled' },
    ),
  )
})
test('HR and compliance workflows restrict access while published knowledge can be read by staff', () => {
  assert.equal(canReadWorkflow('leave', 'sales_crm_user'), false)
  assert.equal(canReadWorkflow('goals', 'operations_manager'), false)
  assert.equal(canReadWorkflow('knowledge', 'employee'), true)
  assert.equal(canReadWorkflow('knowledge', 'super_admin'), false)
  assert.equal(workflowWriters.leave.includes('auditor'), false)
  assert.equal(canReadWorkflow('findings', 'auditor'), true)
})
