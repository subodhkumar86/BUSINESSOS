import { randomUUID } from 'node:crypto'
import type { ClientSession } from 'mongodb'
import { z } from 'zod'
import {
  database,
  transaction,
  type AccountDocument,
  type RecordDocument,
} from './database'
import { digest, fail, requireRole } from './security'
import { appendEvent, readWorkspace } from './workspace'
import {
  customerInput,
  customerUpdate,
  interactionInput,
} from '../../server/customers'
import {
  workflowKinds,
  workflowSchemas,
  workflowPatch,
  workflowStates,
  workflowWriters,
  canReadWorkflow,
  validateWorkflowChange,
} from '../../src/workflow-contracts'

type Context = {
  request: Request
  path: string
  account: AccountDocument
  input: () => Promise<unknown>
  checkCurrent: (session: ClientSession) => Promise<void>
  features: string[]
}
const json = (value: unknown, status = 200) => Response.json(value, { status })
const publicRecord = (row: RecordDocument) => ({
  ...row.data,
  id: row._id,
  version: row.version,
  created_at: row.created_at,
  updated_at: row.updated_at,
})
export async function handleOperations({
  request,
  path,
  account,
  input,
  checkCurrent,
  features,
}: Context): Promise<Response | undefined> {
  const d = await database(),
    tenant = account.tenant,
    method = request.method
  const customer = path.match(
    /^\/crm\/customers(?:\/([^/]+)(\/interactions)?)?$/,
  )
  if (customer) {
    requireRole(account, [
      'owner',
      'sales_crm_user',
      'finance_admin',
      'auditor',
    ])
    const id = customer[1] ? z.uuid().parse(customer[1]) : undefined,
      history = !!customer[2]
    const filter = { tenant, kind: 'customer', ...(id ? { _id: id } : {}) }
    if (method === 'GET') {
      if (history) {
        if (!(await d.records.findOne(filter))) fail(404, 'Customer not found.')
        return json({
          interactions: (
            await d.records
              .find({ tenant, kind: 'interaction', 'data.customer_id': id })
              .sort({ created_at: -1 })
              .limit(500)
              .toArray()
          ).map(publicRecord),
        })
      }
      return json({
        customers: (
          await d.records
            .find(filter)
            .sort({ 'data.name': 1 })
            .limit(500)
            .toArray()
        ).map(publicRecord),
      })
    }
    requireRole(account, ['owner', 'sales_crm_user'])
    if (history && method === 'POST') {
      const b = interactionInput.parse(await input()),
        recordId = randomUUID(),
        now = new Date().toISOString()
      const data = {
        customer_id: id,
        kind: b.kind,
        summary: b.summary,
        occurred_at: b.occurredAt,
        follow_up_on: b.followUpOn,
        actor: account.name,
      }
      await transaction(async (session) => {
        await checkCurrent(session)
        if (!(await d.records.findOne(filter, { session })))
          fail(404, 'Customer not found.')
        await d.records.insertOne(
          {
            _id: recordId,
            tenant,
            kind: 'interaction',
            data,
            version: 1,
            created_at: now,
            updated_at: now,
          },
          { session },
        )
        await appendEvent(
          tenant,
          account.email,
          'interaction_created',
          recordId,
          id!,
          session,
        )
      })
      return json({ id: recordId, ...data }, 201)
    }
    if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
      fail(405, 'Method not supported.')
    const b = id
      ? customerUpdate.parse(await input())
      : customerInput.parse(await input())
    const version = 'version' in b ? Number(b.version) : undefined
    const recordId = id || randomUUID(),
      now = new Date().toISOString()
    const data = {
      name: b.name,
      email: b.email,
      phone: b.phone,
      address: b.address,
      tax_reference: b.taxReference,
      status: b.status,
      marketing_opt_in: b.marketingOptIn,
    }
    const row = await transaction(async (session) => {
      await checkCurrent(session)
      if (id) {
        const old = await d.records.findOne(filter, { session })
        if (!old) fail(404, 'Customer not found.')
        if (old.version !== version)
          fail(409, 'Customer changed. Refresh and try again.')
        await d.records.updateOne(
          { ...filter, version },
          { $set: { data, updated_at: now }, $inc: { version: 1 } },
          { session },
        )
      } else
        await d.records.insertOne(
          {
            _id: recordId,
            tenant,
            kind: 'customer',
            data,
            version: 1,
            created_at: now,
            updated_at: now,
          },
          { session },
        )
      await appendEvent(
        tenant,
        account.email,
        'customer_saved',
        recordId,
        b.name,
        session,
      )
      return d.records.findOne(
        { _id: recordId, tenant, kind: 'customer' },
        { session },
      )
    })
    return json(publicRecord(row!), id ? 200 : 201)
  }
  const workflow = path.match(/^\/workflows\/([^/]+)(?:\/([^/]+))?$/)
  if (workflow) {
    const kind = z.enum(workflowKinds).parse(workflow[1]),
      id = workflow[2] ? z.uuid().parse(workflow[2]) : undefined
    if (!canReadWorkflow(kind, account.role))
      fail(403, 'Your role cannot view this workflow.')
    if (
      ['leave', 'goals', 'reviews'].includes(kind) &&
      !features.includes('operations')
    )
      fail(403, 'Your plan does not include HR workflows.')
    const collectionKind = 'workflow:' + kind
    const currentState = (await readWorkspace(tenant)).state
    // Employee-to-user mapping needs an explicit link; matching names is unsafe.
    if (account.role === 'employee' && ['leave', 'goals'].includes(kind))
      fail(
        403,
        'Ask HR to manage this workflow until employee account linking is configured.',
      )
    const expose = (row: RecordDocument) => ({
      id: row._id,
      kind,
      status: row.data.status,
      data: row.data.values,
      version: row.version,
      created_by: row.data.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    if (method === 'GET')
      return json({
        records: (
          await d.records
            .find({ tenant, kind: collectionKind, ...(id ? { _id: id } : {}) })
            .sort({ created_at: -1 })
            .limit(500)
            .toArray()
        ).map(expose),
      })
    if (!workflowWriters[kind].includes(account.role))
      fail(403, 'Your role cannot change this workflow.')
    if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
      fail(405, 'Method not supported.')
    const raw = await input(),
      now = new Date().toISOString(),
      key =
        method === 'POST'
          ? z.uuid().parse(request.headers.get('idempotency-key'))
          : undefined
    const fingerprint = digest(JSON.stringify({ kind, raw, actor: account.id }))
    const row = await transaction(async (session) => {
      await checkCurrent(session)
      if (!id) {
        const old = await d.records.findOne(
          { tenant, kind: collectionKind, 'data.requestKey': key },
          { session },
        )
        if (old) {
          if (old.data.fingerprint !== fingerprint)
            fail(409, 'Idempotency key already used.')
          return old
        }
        const values = workflowSchemas[kind].parse(raw) as Record<
          string,
          unknown
        >
        if (
          ['leave', 'goals', 'reviews'].includes(kind) &&
          !currentState.employees.some((e) => e.id === values.employeeId)
        )
          fail(404, 'Employee not found in this workspace.')
        if (kind === 'appointments') {
          values.room = String(values.room).trim().replace(/\s+/g, ' ')
          const overlaps = await d.records
            .find(
              { tenant, kind: collectionKind, 'data.status': 'scheduled' },
              { session },
            )
            .toArray()
          if (
            overlaps.some((r) => {
              const v = r.data.values as Record<string, unknown>
              return (
                String(v.room).toLowerCase() ===
                  String(values.room).toLowerCase() &&
                Date.parse(String(v.startAt)) <
                  Date.parse(String(values.endAt)) &&
                Date.parse(String(v.endAt)) > Date.parse(String(values.startAt))
              )
            })
          )
            fail(409, 'Room is already booked for this time.')
        }
        if (kind === 'leave') {
          const overlaps = await d.records
            .find(
              {
                tenant,
                kind: collectionKind,
                'data.status': { $in: ['pending', 'approved'] },
              },
              { session },
            )
            .toArray()
          if (
            overlaps.some((r) => {
              const v = r.data.values as Record<string, unknown>
              return (
                v.employeeId === values.employeeId &&
                String(v.startDate) <= String(values.endDate) &&
                String(v.endDate) >= String(values.startDate)
              )
            })
          )
            fail(409, 'Leave already exists for these dates.')
        }
        if (kind === 'goals') values.progress = 0
        const created: RecordDocument = {
          _id: randomUUID(),
          tenant,
          kind: collectionKind,
          version: 1,
          created_at: now,
          updated_at: now,
          data: {
            values,
            status: Object.keys(workflowStates[kind])[0],
            created_by: account.id,
            requestKey: key,
            fingerprint,
          },
        }
        await d.records.insertOne(created, { session })
        await appendEvent(
          tenant,
          account.email,
          kind + '_created',
          created._id,
          String(created.data.status),
          session,
        )
        return created
      }
      const b = workflowPatch.parse(raw),
        old = await d.records.findOne(
          { _id: id, tenant, kind: collectionKind },
          { session },
        )
      if (!old) fail(404, 'Record not found.')
      if (old.version !== b.version)
        fail(409, 'Record changed. Refresh and try again.')
      if (
        kind === 'leave' &&
        b.status === 'approved' &&
        old.data.created_by === account.id
      )
        fail(403, 'Another HR user or owner must approve this leave.')
      if (
        b.status &&
        !workflowStates[kind][String(old.data.status)]?.includes(b.status)
      )
        fail(409, 'Invalid workflow transition.')
      const values = old.data.values as Record<string, unknown>
      try {
        validateWorkflowChange(
          kind,
          { status: String(old.data.status), data: values },
          b,
        )
      } catch (error) {
        fail(409, error instanceof Error ? error.message : 'Invalid change.')
      }
      const data = {
        ...old.data,
        status: b.status || old.data.status,
        values: {
          ...values,
          ...(b.progress !== undefined ? { progress: b.progress } : {}),
          ...(b.evidence !== undefined ? { evidence: b.evidence } : {}),
        },
      }
      await d.records.updateOne(
        { _id: id, tenant, kind: collectionKind, version: b.version },
        { $set: { data, updated_at: now }, $inc: { version: 1 } },
        { session },
      )
      await appendEvent(
        tenant,
        account.email,
        kind + '_updated',
        id,
        String(data.status),
        session,
      )
      return { ...old, data, version: old.version + 1, updated_at: now }
    })
    return json(expose(row), id ? 200 : 201)
  }
  return undefined
}
