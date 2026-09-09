import { createHmac, randomUUID } from 'node:crypto'
const channel = (process.env.NOTIFY_PROVIDER || 'local-log').slice(0, 40)
export function deliveryAdapter() { return { provider: channel } }
export async function queueMessage(c: { query: (t: string, v: unknown[]) => Promise<unknown> }, tenant: string, msg: {
  channel: 'email' | 'sms' | 'whatsapp' | 'push' | 'bank_poll'; recipient: string; subject?: string; body: string
}) {
  const id = randomUUID()
  await c.query('INSERT INTO message_outbox(id,tenant_id,channel,recipient,subject,body,provider) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, tenant, msg.channel, msg.recipient.slice(0, 320), (msg.subject || '').slice(0, 200), msg.body.slice(0, 8000), channel])
  return id
}
export function signDelivery(id: string) {
  const secret = process.env.DELIVERY_WEBHOOK_SECRET || 'local-delivery-secret-min-32-chars-0000'
  return createHmac('sha256', secret).update(id).digest('hex')
}
