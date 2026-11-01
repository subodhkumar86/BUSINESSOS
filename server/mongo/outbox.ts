import { randomUUID } from 'node:crypto'
import type { ClientSession } from 'mongodb'
import { database, transaction } from './database'
import { appendEvent } from './workspace'
import { findRecord, updateRecord } from './records'
import { fail } from './security'
import { deliverMessage } from '../notify'
import { unseal } from './vault'
import { requireWorker } from './worker-security'

export async function deliverOutboxMessage(
  tenant: string,
  id: string,
  actor: string,
  authorize?: (session: ClientSession) => Promise<void>,
) {
  const claim = randomUUID(),
    d = await database()
  const row = await transaction(async (session) => {
    if (authorize) await authorize(session)
    const current = await findRecord(tenant, 'outbox', id, session)
    if (current.data.status === 'sent') return current
    if (
      current.data.expires_at &&
      String(current.data.expires_at) <= new Date().toISOString()
    )
      fail(409, 'This message has expired. Request a new recovery email.')
    if (
      current.data.status === 'processing' &&
      String(current.data.lease_expires_at) > new Date().toISOString()
    )
      fail(409, 'Message delivery is already in progress.')
    if (
      process.env.NODE_ENV === 'production' &&
      (process.env.DELIVERY_WEBHOOK_SECRET || '').length < 32
    )
      fail(503, 'Configure DELIVERY_WEBHOOK_SECRET before external delivery.')
    return updateRecord(
      current,
      {
        status: 'processing',
        claim,
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      },
      session,
    )
  })
  if (row.data.status === 'sent')
    return {
      status: 'sent' as const,
      provider: String(row.data.provider),
      error: '',
    }
  let result: { status: 'sent' | 'failed'; provider: string; error: string }
  try {
    result = await deliverMessage({
      id,
      tenant_id: tenant,
      channel: row.data.channel as 'email' | 'sms' | 'whatsapp' | 'push',
      recipient: String(row.data.recipient),
      subject: String(row.data.subject),
      body: row.data.encrypted_body
        ? unseal(String(row.data.encrypted_body))
        : String(row.data.body),
      attempts: Number(row.data.attempts),
    })
  } catch {
    result = {
      status: 'failed',
      provider: String(row.data.provider),
      error:
        'Could not prepare delivery. Verify provider and encryption settings.',
    }
  }
  await transaction(async (session) => {
    const resultRow = await d.records.findOne(
      { _id: id, tenant, kind: 'outbox', 'data.claim': claim },
      { session },
    )
    if (!resultRow)
      fail(409, 'Delivery lease changed. Refresh to see the result.')
    const attempts = Number(row.data.attempts) + 1
    await updateRecord(
      resultRow,
      {
        ...result,
        attempts,
        lease_expires_at: null,
        next_attempt_at: new Date(
          Date.now() + Math.min(3600000, 1000 * 2 ** attempts),
        ).toISOString(),
        ...(result.status === 'sent' && row.data.sensitive
          ? { encrypted_body: null }
          : {}),
      },
      session,
    )
    await appendEvent(
      tenant,
      actor,
      'notification_delivery_' + result.status,
      id,
      result.provider,
      session,
    )
  })
  return result
}
export async function deliverQueued(limit = 50) {
  const d = await database(),
    now = new Date().toISOString()
  const rows = await d.records
    .find({
      kind: 'outbox',
      'data.attempts': { $lt: 5 },
      $and: [
        {
          $or: [
            { 'data.status': { $in: ['queued', 'failed'] } },
            {
              'data.status': 'processing',
              'data.lease_expires_at': { $lte: now },
            },
          ],
        },
        {
          $or: [
            { 'data.next_attempt_at': { $exists: false } },
            { 'data.next_attempt_at': { $lte: now } },
          ],
        },
        {
          $or: [
            { 'data.expires_at': { $exists: false } },
            { 'data.expires_at': { $gt: now } },
          ],
        },
      ],
    })
    .sort({ created_at: 1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .toArray()
  const results = []
  for (const row of rows) {
    try {
      results.push(
        await deliverOutboxMessage(row.tenant, row._id, 'Outbox worker'),
      )
    } catch {
      results.push({
        status: 'deferred',
        error: 'Message is locked or delivery configuration is unavailable.',
      })
    }
  }
  return {
    processed: results.length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    deferred: results.filter((r) => r.status === 'deferred').length,
  }
}
export async function handleOutboxWorker(
  request: Request,
  path: string,
): Promise<Response | undefined> {
  if (path !== '/internal/outbox/run') return
  requireWorker(request)
  if (!['GET', 'POST'].includes(request.method))
    fail(405, 'Method not supported.')
  return Response.json(await deliverQueued(5))
}
