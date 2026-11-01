import { randomUUID } from 'node:crypto'
import type { ClientSession } from 'mongodb'
import { z } from 'zod'
import {
  database,
  transaction,
  type AccountDocument,
  type RecordDocument,
} from './database'
import { digest, fail } from './security'
import { appendEvent } from './workspace'

export type WorkflowContext = {
  request: Request
  path: string
  account: AccountDocument
  input: () => Promise<unknown>
  checkCurrent: (session: ClientSession) => Promise<void>
  features: string[]
}
export function expose<T = Record<string, unknown>>(row: RecordDocument): T {
  return {
    ...row.data,
    id: row._id,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } as T
}
export async function insertRecord(
  tenant: string,
  kind: string,
  data: Record<string, unknown>,
  session: ClientSession,
  id = randomUUID(),
) {
  const now = new Date().toISOString()
  const row = {
    _id: id,
    tenant,
    kind,
    data,
    version: 1,
    created_at: now,
    updated_at: now,
  }
  await (await database()).records.insertOne(row, { session })
  return row
}
export async function updateRecord(
  row: RecordDocument,
  data: Record<string, unknown>,
  session: ClientSession,
) {
  const next = {
    ...row,
    data: { ...row.data, ...data },
    version: row.version + 1,
    updated_at: new Date().toISOString(),
  }
  const result = await (
    await database()
  ).records.replaceOne(
    { _id: row._id, tenant: row.tenant, kind: row.kind, version: row.version },
    next,
    { session },
  )
  if (!result.modifiedCount)
    fail(409, 'Record changed. Refresh before updating.')
  return next
}
export async function findRecord(
  tenant: string,
  kind: string,
  id: string,
  session?: ClientSession,
) {
  const row = await (
    await database()
  ).records.findOne({ tenant, kind, _id: id }, { session })
  if (!row) fail(404, 'Record not found.')
  return row
}
export async function listRecords(tenant: string, kind: string) {
  return (
    await (
      await database()
    ).records
      .find({ tenant, kind })
      .sort({ created_at: -1, _id: -1 })
      .limit(500)
      .toArray()
  ).map((row) => expose(row))
}
export async function mutate<T>(
  ctx: WorkflowContext,
  input: unknown,
  work: (session: ClientSession) => Promise<T>,
  idempotent = false,
): Promise<T> {
  const key = idempotent
    ? z.uuid().parse(ctx.request.headers.get('idempotency-key'))
    : undefined
  const fingerprint = digest(
    JSON.stringify({
      actor: ctx.account.id,
      path: ctx.path,
      method: ctx.request.method,
      input,
    }),
  )
  const d = await database(),
    tenant = ctx.account.tenant
  return transaction(async (session) => {
    await ctx.checkCurrent(session)
    if (key) {
      const old = await d.requests.findOne({ tenant, key }, { session })
      if (old) {
        if (old.fingerprint !== fingerprint || old.response === undefined)
          fail(409, 'Idempotency key belongs to a different request.')
        return old.response as T
      }
    }
    const result = await work(session)
    await appendEvent(
      tenant,
      ctx.account.email,
      ctx.request.method === 'POST' ? 'record_created' : 'record_updated',
      ctx.path,
      'Workflow mutation committed',
      session,
    )
    if (key)
      await d.requests.insertOne(
        { _id: randomUUID(), tenant, key, fingerprint, response: result },
        { session },
      )
    return result
  })
}
