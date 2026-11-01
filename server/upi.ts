import { z } from 'zod'

export const upiPayee = z
  .object({
    vpa: z
      .string()
      .trim()
      .min(5)
      .max(100)
      .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/),
    name: z.string().trim().min(1).max(100),
  })
  .strict()

export const upiReceipt = z
  .object({
    invoiceId: z.uuid(),
    reference: z
      .string()
      .trim()
      .min(6)
      .max(64)
      .regex(/^[a-zA-Z0-9]+$/)
      .transform((value) => value.toUpperCase()),
    amount: z
      .number()
      .finite()
      .positive()
      .max(10000000000)
      .refine(
        (value) => Math.abs(Math.round(value * 100) / 100 - value) < 0.000001,
        'Use at most two decimal places.',
      ),
    receivedAt: z.iso.datetime({ offset: true }),
    verifiedInBank: z.literal(true),
  })
  .strict()

export function upiIntent(
  payee: z.infer<typeof upiPayee>,
  invoice: { id: string; name: string; amount: number },
  currency: string,
) {
  const valid = upiPayee.parse(payee)
  if (currency !== 'INR') throw new Error('UPI requires an INR workspace.')
  const paise = Math.round(invoice.amount * 100)
  if (
    !Number.isSafeInteger(paise) ||
    paise <= 0 ||
    Math.abs(paise / 100 - invoice.amount) > 0.000001
  )
    throw new Error(
      'Invoice amount must be positive with at most two decimal places.',
    )
  const reference = invoice.id.replaceAll('-', '')
  if (!/^[a-zA-Z0-9]{1,35}$/.test(reference))
    throw new Error('Invalid invoice reference.')
  const params = new URLSearchParams({
    pa: valid.vpa,
    pn: valid.name,
    tr: reference,
    tn: `Invoice ${invoice.name}`.slice(0, 80),
    am: (paise / 100).toFixed(2),
    cu: 'INR',
  })
  return `upi://pay?${params}`
}
