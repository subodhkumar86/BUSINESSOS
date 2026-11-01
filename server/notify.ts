import { createHmac } from 'node:crypto'
const providerName = () =>
  (process.env.NOTIFY_PROVIDER || 'local-log').trim().slice(0, 40)
type OutboxMessage = {
  id: string
  tenant_id: string
  channel: 'email' | 'sms' | 'whatsapp' | 'push' | 'bank_poll'
  recipient: string
  subject: string
  body: string
  attempts: number
}
export function deliveryAdapter() {
  const provider = providerName()
  const endpoint = process.env.NOTIFY_WEBHOOK_URL?.trim()
  if (provider !== 'webhook')
    return {
      provider,
      configured: false,
      reason:
        'Set NOTIFY_PROVIDER=webhook and NOTIFY_WEBHOOK_URL to enable external delivery.',
    }
  if (!endpoint)
    return {
      provider,
      configured: false,
      reason: 'NOTIFY_WEBHOOK_URL is not configured.',
    }
  try {
    const url = new URL(endpoint)
    if (url.username || url.password || url.hash)
      return {
        provider,
        configured: false,
        reason:
          'Notification webhook URLs cannot contain credentials or fragments.',
      }
    if (
      url.protocol !== 'https:' &&
      (process.env.NODE_ENV === 'production' ||
        url.protocol !== 'http:' ||
        !['localhost', '127.0.0.1'].includes(url.hostname))
    )
      return {
        provider,
        configured: false,
        reason:
          'Notification webhooks must use HTTPS outside local development.',
      }
  } catch {
    return {
      provider,
      configured: false,
      reason: 'NOTIFY_WEBHOOK_URL is not a valid URL.',
    }
  }
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.DELIVERY_WEBHOOK_SECRET || '').trim().length < 32
  )
    return {
      provider,
      configured: false,
      reason:
        'Set DELIVERY_WEBHOOK_SECRET to at least 32 characters before production delivery.',
    }
  return { provider, configured: true as const, endpoint }
}
export function signDelivery(id: string) {
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.DELIVERY_WEBHOOK_SECRET || '').trim().length < 32
  )
    throw new Error('Production delivery requires a configured signing secret.')
  const secret =
    process.env.DELIVERY_WEBHOOK_SECRET ||
    'local-delivery-secret-min-32-chars-0000'
  return createHmac('sha256', secret).update(id).digest('hex')
}
export async function deliverMessage(message: OutboxMessage) {
  const adapter = deliveryAdapter()
  if (!adapter.configured || !('endpoint' in adapter))
    return {
      status: 'failed' as const,
      provider: adapter.provider,
      error: adapter.reason,
    }
  const payload = JSON.stringify({
    id: message.id,
    tenantId: message.tenant_id,
    channel: message.channel,
    recipient: message.recipient,
    subject: message.subject,
    body: message.body,
    attempt: message.attempts + 1,
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(adapter.endpoint!, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-businessos-delivery-signature': signDelivery(payload),
        'x-businessos-delivery-id': message.id,
      },
      body: payload,
    })
    if (!response.ok)
      return {
        status: 'failed' as const,
        provider: adapter.provider,
        error: `Provider returned HTTP ${response.status}.`,
      }
    return { status: 'sent' as const, provider: adapter.provider, error: '' }
  } catch (error) {
    return {
      status: 'failed' as const,
      provider: adapter.provider,
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : 'Delivery request failed.',
    }
  } finally {
    clearTimeout(timeout)
  }
}
