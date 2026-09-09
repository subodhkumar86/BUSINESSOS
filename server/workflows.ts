import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import type { Store } from './store.ts'
import type { Session } from './security.ts'
import {
  workflowKinds,
  workflowSchemas,
  workflowPatch,
  workflowStates,
  workflowWriters,
  canReadWorkflow,
  validateWorkflowChange,
  type WorkflowRecord,
} from '../src/workflow-contracts.ts'

type Fail = (status: number, message: string) => never
export async function handleWorkflow(args: {
  store: Store
  session: Session
  method: string
  kind: string
  id?: string
  input?: unknown
  requestKey?: string
  ensureCurrent: (c: PoolClient, s: Session) => Promise<unknown>
  fail: Fail
}) {
  const { store, session: s, method, fail } = args
  const kind = z.enum(workflowKinds).parse(args.kind)
  const id = args.id ? z.uuid().parse(args.id) : undefined
  if (!canReadWorkflow(kind, s.user.role))
    fail(403, 'Your role cannot view this workflow.')
  if (
    !['GET', 'POST', 'PATCH'].includes(method) ||
    (method === 'POST' && id) ||
    (method === 'PATCH' && !id)
  )
    fail(405, 'Method not supported.')
  if (method !== 'GET' && !workflowWriters[kind].includes(s.user.role))
    fail(403, 'Your role cannot change this workflow.')
  return store.tenant(s.tenant, async (c) => {
    await args.ensureCurrent(c, s)
    if (['leave', 'goals'].includes(kind)) {
      const plan = (
        await c.query(
          'SELECT p.features FROM tenants t JOIN subscription_plans p ON p.id=t.plan_id WHERE t.id=$1',
          [s.tenant],
        )
      ).rows[0]
      if (!plan?.features.includes('operations'))
        fail(403, 'Your plan does not include HR workflows.')
    }
    if (method === 'GET') {
      const publishedOnly =
        kind === 'knowledge' &&
        !workflowWriters[kind].includes(s.user.role) &&
        s.user.role !== 'auditor'
      const records = (
        await c.query(
          "SELECT id,kind,status,data,version,created_by,created_at,updated_at FROM workflow_records WHERE tenant_id=$1 AND kind=$2 AND ($3::uuid IS NULL OR id=$3) AND ($4::boolean=false OR status='published') ORDER BY updated_at DESC,id",
          [s.tenant, kind, id || null, publishedOnly],
        )
      ).rows
      if (id && !records.length) fail(404, 'Record not found.')
      return { status: 200, body: { records } }
    }
    if (method === 'POST') {
      const input = workflowSchemas[kind].parse(args.input) as Record<
        string,
        unknown
      >
      const requestKey = z.uuid().parse(args.requestKey)
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ kind, input }))
        .digest('hex')
      // Serialise creates per tenant so overlap and idempotency checks stay atomic.
      const current = await store.read(c, s.tenant, true)
      const previous = (
        await c.query(
          'SELECT * FROM workflow_records WHERE tenant_id=$1 AND request_key=$2',
          [s.tenant, requestKey],
        )
      ).rows[0]
      if (previous) {
        if (
          previous.fingerprint !== fingerprint ||
          previous.created_by !== s.user.id
        )
          fail(409, 'Idempotency key was used for a different request.')
        return { status: 200, body: publicRecord(previous) }
      }
      if (
        ['leave', 'goals'].includes(kind) &&
        !current.state.employees.some(
          (employee) => employee.id === input.employeeId,
        )
      )
        fail(404, 'Employee not found in this workspace.')
      if (kind === 'appointments') {
        input.room = String(input.room).trim().replace(/\s+/g, ' ')
        const overlap = await c.query(
          `SELECT id FROM workflow_records WHERE tenant_id=$1 AND kind='appointments' AND status='scheduled' AND lower(data->>'room')=lower($2) AND (data->>'startAt')::timestamptz < $4::timestamptz AND (data->>'endAt')::timestamptz > $3::timestamptz`,
          [s.tenant, input.room, input.startAt, input.endAt],
        )
        if (overlap.rowCount)
          fail(409, 'This room is already booked during that time.')
      }
      if (kind === 'leave') {
        const overlap = await c.query(
          `SELECT id FROM workflow_records WHERE tenant_id=$1 AND kind='leave' AND status IN ('pending','approved') AND data->>'employeeId'=$2 AND data->>'startDate' <= $4 AND data->>'endDate' >= $3`,
          [s.tenant, input.employeeId, input.startDate, input.endDate],
        )
        if (overlap.rowCount)
          fail(
            409,
            'This employee already has leave requested for these dates.',
          )
      }
      const initial = Object.keys(workflowStates[kind])[0]
      if (kind === 'goals') input.progress = 0
      const row = (
        await c.query(
          'INSERT INTO workflow_records(id,tenant_id,kind,status,data,created_by,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [
            randomUUID(),
            s.tenant,
            kind,
            initial,
            input,
            s.user.id,
            requestKey,
            fingerprint,
          ],
        )
      ).rows[0]
      await audit(row.id, kind + '_created', initial)
      return { status: 201, body: publicRecord(row) }
    }
    const input = workflowPatch.parse(args.input)
    const row = (
      await c.query(
        'SELECT * FROM workflow_records WHERE tenant_id=$1 AND kind=$2 AND id=$3 FOR UPDATE',
        [s.tenant, kind, id],
      )
    ).rows[0] as WorkflowRecord | undefined
    if (!row) return fail(404, 'Record not found.')
    if (row.version !== input.version)
      fail(409, 'Record changed. Refresh before updating.')
    if (
      kind === 'leave' &&
      input.status === 'approved' &&
      row.created_by === s.user.id
    )
      fail(
        403,
        'Another authorised HR user or owner must approve this leave request.',
      )
    try {
      validateWorkflowChange(kind, row, input)
    } catch (error) {
      fail(
        409,
        error instanceof Error ? error.message : 'Invalid workflow change.',
      )
    }
    const data = {
      ...row.data,
      ...(input.progress !== undefined ? { progress: input.progress } : {}),
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    }
    const updated = (
      await c.query(
        'UPDATE workflow_records SET data=$1,status=$2,version=version+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING *',
        [data, input.status || row.status, s.tenant, id],
      )
    ).rows[0]
    await audit(
      row.id,
      kind + '_updated',
      JSON.stringify({
        from: row.status,
        to: updated.status,
        version: updated.version,
      }),
    )
    return { status: 200, body: publicRecord(updated) }
    async function audit(entity: string, action: string, detail: string) {
      await store.append(c, s.tenant, {
        id: randomUUID(),
        date: new Date().toISOString(),
        actor: s.user.email,
        entity,
        action,
        detail,
      })
    }
  })
}
function publicRecord(row: WorkflowRecord) {
  const {
    id,
    kind,
    status,
    data,
    version,
    created_by,
    created_at,
    updated_at,
  } = row
  return { id, kind, status, data, version, created_by, created_at, updated_at }
}
