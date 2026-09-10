import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'
const scope = z.enum(['purchase_order', 'payroll', 'payment', 'master_data'])
const step = z.object({ role: z.string().min(1).max(60), label: z.string().max(120).default('') }).strict()
export const chainInput = z.object({
  name: z.string().trim().min(1).max(200),
  scope, minAmount: z.number().finite().min(0).max(1e12).default(0),
  steps: z.array(step).min(1).max(5), active: z.boolean().default(true),
}).strict()
export const chainUpdate = z.object({
  version: z.number().int().positive(), active: z.boolean().optional(),
  steps: z.array(step).min(1).max(5).optional(), minAmount: z.number().finite().min(0).max(1e12).optional(),
}).strict()
export const approvalDecision = z.object({
  version: z.number().int().positive(),
  decision: z.enum(['approve', 'reject']), comment: z.string().trim().max(1000).default(''),
}).strict()
export async function seedDefaultChains(c: PoolClient, tenant: string) {
  const existing = await c.query('SELECT count(*)::int AS n FROM approval_chains WHERE tenant_id=$1', [tenant])
  if (Number(existing.rows[0].n) > 0) return
  const defaults = [
    ['Standard purchase approval', 'purchase_order', 500000, [{ role: 'operations_manager' }, { role: 'owner' }]],
    ['Payroll release approval', 'payroll', 0, [{ role: 'hr_admin' }, { role: 'owner' }]],
    ['High-value payment approval', 'payment', 1000000, [{ role: 'finance_admin' }, { role: 'owner' }]],
  ] as const
  for (const [name, s, min, steps] of defaults)
    await c.query('INSERT INTO approval_chains(id,tenant_id,name,scope,min_amount,steps) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), tenant, name, s, min, JSON.stringify(steps)])
}
export async function matchingChain(c: PoolClient, tenant: string, entityScope: string, amount: number) {
  const rows = (await c.query(
    "SELECT * FROM approval_chains WHERE tenant_id=$1 AND scope=$2 AND active=true AND min_amount <= $3 ORDER BY min_amount DESC",
    [tenant, entityScope, amount])).rows
  return rows[0] as { id: string; steps: { role: string }[] } | undefined
}
