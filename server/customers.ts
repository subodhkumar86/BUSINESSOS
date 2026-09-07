import { z } from 'zod'

const short = z.string().trim().max(200)
export const customerInput = z
  .object({
    name: short.min(1),
    email: z
      .union([z.literal(''), z.string().trim().email().max(254)])
      .default(''),
    phone: z.string().trim().max(50).default(''),
    address: z.string().trim().max(1000).default(''),
    taxReference: short.default(''),
    status: z.enum(['active', 'inactive']).default('active'),
  })
  .strict()
export const customerUpdate = customerInput.extend({
  version: z.number().int().positive(),
})
export const interactionInput = z
  .object({
    kind: z.enum(['note', 'call', 'email', 'meeting']),
    summary: z.string().trim().min(1).max(2000),
    occurredAt: z.iso.datetime({ offset: true }),
    followUpOn: z.iso.date().nullable().default(null),
  })
  .strict()
