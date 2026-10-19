import { z } from 'zod'
const scope = z.enum(['purchase_order', 'payroll', 'payment', 'master_data'])
const step = z
  .object({
    role: z.string().min(1).max(60),
    label: z.string().max(120).default(''),
  })
  .strict()
export const chainInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    scope,
    minAmount: z.number().finite().min(0).max(1e12).default(0),
    steps: z.array(step).min(1).max(5),
    active: z.boolean().default(true),
  })
  .strict()
export const chainUpdate = z
  .object({
    version: z.number().int().positive(),
    active: z.boolean().optional(),
    steps: z.array(step).min(1).max(5).optional(),
    minAmount: z.number().finite().min(0).max(1e12).optional(),
  })
  .strict()
export const approvalDecision = z
  .object({
    version: z.number().int().positive(),
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).default(''),
  })
  .strict()
