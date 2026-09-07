import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const webhookBinding = z.object({
  tenantId: z.string().uuid(),
  accountId: z.string().uuid(),
  secret: z.string().min(32),
})
export function verifyBankSignature(
  provider: string,
  raw: Buffer,
  signature: unknown,
  secret: string,
) {
  if (
    !['mock', 'paystack', 'flutterwave'].includes(provider) ||
    typeof signature !== 'string'
  )
    return false
  const encoding = provider === 'flutterwave' ? 'base64' : 'hex'
  const expected = createHmac(
    provider === 'paystack' ? 'sha512' : 'sha256',
    secret,
  )
    .update(raw)
    .digest(encoding)
  const actual = Buffer.from(signature),
    target = Buffer.from(expected)
  return actual.length === target.length && timingSafeEqual(actual, target)
}
export function normalizeBankEvent(provider: string, payload: unknown) {
  const envelope = z
    .object({ event: z.string(), data: z.record(z.string(), z.unknown()) })
    .parse(payload)
  const data = envelope.data
  if (provider === 'mock')
    return z
      .object({
        id: z.string().min(1).max(200),
        amount: z.number().positive().finite().max(1e12),
        currency: z.string().length(3),
        direction: z.enum(['credit', 'debit']),
        reference: z.string().min(1).max(500),
        occurredAt: z.iso.datetime(),
      })
      .parse(data)
  if (provider === 'paystack' && envelope.event !== 'charge.success')
    return null
  if (
    provider === 'flutterwave' &&
    (envelope.event !== 'charge.completed' || data.status !== 'successful')
  )
    return null
  return z
    .object({
      id: z.string().min(1).max(200),
      amount: z.number().positive().finite().max(1e12),
      currency: z.string().length(3),
      direction: z.literal('credit'),
      reference: z.string().min(1).max(500),
      occurredAt: z.iso.datetime(),
    })
    .parse({
      id: data.id === undefined ? undefined : String(data.id),
      amount:
        typeof data.amount === 'number'
          ? data.amount / (provider === 'paystack' ? 100 : 1)
          : undefined,
      currency: data.currency,
      direction: 'credit',
      reference: data.reference || data.tx_ref,
      occurredAt: data.paid_at || data.created_at,
    })
}
