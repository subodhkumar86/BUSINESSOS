import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { database } from './database'
import { fail, requireRole } from './security'
import {
  expose,
  findRecord,
  insertRecord,
  listRecords,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'
import { readWorkspace, saveWorkspace } from './workspace'
import { stockMovement } from '../../src/inventory'
import { validateProductionUpdate, depreciation } from '../operational-rules'

const text = z.string().trim().min(1).max(200)
const note = z.string().trim().max(2000).default('')
const money = z.number().finite().min(0).max(10000000000)
const qty = z.number().int().min(0).max(100000000)
const definitions = {
  '/assets': {
    kind: 'asset',
    key: 'assets',
    roles: ['owner', 'operations_manager'],
    create: z
      .object({
        name: text,
        serialNumber: text,
        category: text,
        cost: money,
        depreciationRate: z.number().min(0).max(100),
        location: text,
      })
      .strict(),
    patch: z
      .object({
        status: z.enum(['operational', 'maintenance', 'retired']).optional(),
        location: text.optional(),
      })
      .strict(),
    transitions: {
      operational: ['maintenance', 'retired'],
      maintenance: ['operational', 'retired'],
      retired: [],
    },
  },
  '/facilities/work-orders': {
    kind: 'facility',
    key: 'workOrders',
    roles: ['owner', 'operations_manager'],
    create: z
      .object({
        facilityName: text,
        equipment: text,
        condition: z.enum(['good', 'fair', 'needs_service', 'critical']),
        priority: z.enum(['low', 'medium', 'high', 'urgent']),
        description: note,
      })
      .strict(),
    patch: z
      .object({ status: z.enum(['open', 'in_progress', 'completed']) })
      .strict(),
    transitions: {
      open: ['in_progress'],
      in_progress: ['completed'],
      completed: [],
    },
  },
  '/frontoffice/visitors': {
    kind: 'visitor',
    key: 'visitors',
    roles: ['owner', 'sales_crm_user', 'department_manager', 'employee'],
    create: z
      .object({
        visitorName: text,
        hostPerson: text,
        company: note,
        purpose: text,
      })
      .strict(),
    patch: z
      .object({
        status: z.enum(['scheduled', 'checked_in', 'completed', 'cancelled']),
      })
      .strict(),
    transitions: {
      scheduled: ['checked_in', 'cancelled'],
      checked_in: ['completed'],
      completed: [],
      cancelled: [],
    },
  },
  '/marketing/campaigns': {
    kind: 'campaign',
    key: 'campaigns',
    roles: ['owner', 'sales_crm_user'],
    create: z
      .object({
        name: text,
        channel: z.enum(['social', 'email', 'search', 'event', 'referral']),
        budget: money,
        spend: money,
      })
      .strict(),
    patch: z
      .object({
        status: z
          .enum(['planning', 'active', 'paused', 'completed'])
          .optional(),
        spend: money.optional(),
        leadsCount: qty.optional(),
        revenueGenerated: money.optional(),
      })
      .strict(),
    transitions: {
      planning: ['active', 'completed'],
      active: ['paused', 'completed'],
      paused: ['active', 'completed'],
      completed: [],
    },
  },
  '/compliance/risks': {
    kind: 'risk',
    key: 'risks',
    roles: ['owner', 'operations_manager'],
    create: z
      .object({
        title: text,
        category: z.enum([
          'financial',
          'operational',
          'regulatory',
          'security',
          'vendor',
        ]),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        mitigationPlan: note,
      })
      .strict(),
    patch: z
      .object({
        status: z
          .enum(['identified', 'mitigating', 'controlled', 'accepted'])
          .optional(),
        mitigationPlan: note.optional(),
      })
      .strict(),
    transitions: {
      identified: ['mitigating', 'accepted'],
      mitigating: ['controlled', 'accepted'],
      controlled: ['mitigating'],
      accepted: ['mitigating'],
    },
  },
  '/production/batches': {
    kind: 'production',
    key: 'batches',
    roles: ['owner', 'operations_manager'],
    create: z
      .object({
        batchNumber: text,
        productName: text,
        outputProductId: z.string().max(100).default(''),
        materials: z
          .array(
            z
              .object({
                productId: z.string().min(1).max(100),
                quantity: qty.positive(),
              })
              .strict(),
          )
          .max(50)
          .default([]),
        plannedQty: qty.positive(),
      })
      .strict(),
    patch: z
      .object({
        status: z
          .enum(['scheduled', 'running', 'qa_check', 'completed'])
          .optional(),
        completedQty: qty.optional(),
        defectCount: qty.optional(),
      })
      .strict(),
    transitions: {
      scheduled: ['running'],
      running: ['qa_check'],
      qa_check: ['completed'],
      completed: [],
    },
  },
}
const snake = (key: string) =>
  key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
export async function handleOperational(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const base = Object.keys(definitions).find(
    (p) => ctx.path === p || ctx.path.startsWith(p + '/'),
  )
  if (!base) return
  const config = definitions[base as keyof typeof definitions],
    { account, request } = ctx,
    tenant = account.tenant,
    method = request.method
  const suffix = ctx.path.slice(base.length)
  if (suffix.includes('/', 1)) return
  const id = suffix ? z.uuid().parse(suffix.slice(1)) : undefined
  requireRole(account, [...config.roles, 'auditor'])
  if (method === 'GET') {
    const rows = id
      ? [expose(await findRecord(tenant, config.kind, id))]
      : await listRecords(tenant, config.kind)
    if (config.kind === 'asset')
      for (const row of rows) {
        const years = Math.max(
          0,
          (Date.now() - Date.parse(String(row.created_at))) /
            (365.25 * 86400000),
        )
        const value = depreciation(
          Number(row.cost),
          Number(row.depreciation_rate),
          years,
        )
        row.book_value = value.bookValue
        row.accumulated_depreciation = value.accumulated
      }
    return Response.json({ [config.key]: rows })
  }
  requireRole(account, config.roles)
  if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
    fail(405, 'Method not supported.')
  const input = (id ? config.patch : config.create).parse(
    await ctx.input(),
  ) as Record<string, unknown>
  return Response.json(
    await mutate(ctx, input, async (session) => {
      const data = Object.fromEntries(
        Object.entries(input).map(([key, value]) => [snake(key), value]),
      )
      if (!id) {
        if (config.kind === 'production') {
          const current = await readWorkspace(tenant, session)
          const materials = input.materials as {
            productId: string
            quantity: number
          }[]
          if (
            new Set(materials.map((m) => m.productId)).size !== materials.length
          )
            fail(400, 'List each material once.')
          if (
            materials.some(
              (m) => !current.state.products.some((p) => p.id === m.productId),
            )
          )
            fail(404, 'Material product not found.')
          if (
            input.outputProductId &&
            !current.state.products.some((p) => p.id === input.outputProductId)
          )
            fail(404, 'Output product not found.')
          if (!!input.outputProductId !== !!materials.length)
            fail(
              400,
              'Inventory production requires both materials and an output product. Leave both empty for tracking only.',
            )
          data.completed_qty = 0
          data.defect_count = 0
          data.inventory_posted_at = null
        }
        if (config.kind === 'campaign') {
          data.leads_count = 0
          data.revenue_generated = 0
          data.roi_percent = 0
        }
        if (config.kind === 'visitor') {
          data.check_in_time = null
          data.check_out_time = null
        }
        data.status = Object.keys(config.transitions)[0]
        return expose(await insertRecord(tenant, config.kind, data, session))
      }
      const row = await findRecord(tenant, config.kind, id, session),
        before = String(row.data.status),
        after = String(input.status || before)
      const transitions = config.transitions as Record<string, string[]>
      if (after !== before && !transitions[before]?.includes(after))
        fail(409, 'Advance this workflow through the permitted stages.')
      if (config.kind === 'production') {
        try {
          validateProductionUpdate(
            row.data as {
              status: string
              planned_qty: number
              completed_qty: number
              defect_count: number
            },
            input as {
              status?: string
              completedQty?: number
              defectCount?: number
            },
          )
        } catch (error) {
          fail(
            409,
            error instanceof Error
              ? error.message
              : 'Invalid production update.',
          )
        }
        if (after === 'completed' && row.data.output_product_id) {
          const current = await readWorkspace(tenant, session),
            state = structuredClone(current.state)
          const materials = row.data.materials as {
            productId: string
            quantity: number
          }[]
          const balances = await (
            await database()
          ).records
            .find({ tenant, kind: 'warehouse:balance' }, { session })
            .toArray()
          let materialValue = 0
          for (const material of materials) {
            const product = state.products.find(
              (p) => p.id === material.productId,
            )
            if (!product) fail(404, 'Material product not found.')
            const allocated = balances
              .filter((b) => b.data.product_id === product.id)
              .reduce((sum, b) => sum + Number(b.data.quantity), 0)
            if (product.qty - allocated < material.quantity)
              fail(409, 'Insufficient unallocated materials for production.')
            const movement = stockMovement(
              product,
              product.qty,
              product.qty - material.quantity,
              'adjustment',
              'Production material consumption',
              row._id,
            )
            movement.actor = account.email
            product.qty = movement.after
            materialValue -= movement.valueDelta
            state.stockMovements.unshift(movement)
            state.journals.unshift({
              id: randomUUID(),
              date: movement.date,
              source: movement.id,
              amount: -movement.valueDelta,
              debit: 'Production work in progress',
              credit: 'Inventory',
            })
          }
          const product = state.products.find(
            (p) => p.id === row.data.output_product_id,
          )
          if (!product) fail(404, 'Output product not found.')
          const good =
            Number(input.completedQty ?? row.data.completed_qty) -
            Number(input.defectCount ?? row.data.defect_count)
          const movement = stockMovement(
            product,
            product.qty,
            product.qty + good,
            'adjustment',
            'Production finished goods',
            row._id,
          )
          movement.actor = account.email
          product.qty = movement.after
          state.stockMovements.unshift(movement)
          if (movement.valueDelta)
            state.journals.unshift({
              id: randomUUID(),
              date: movement.date,
              source: movement.id,
              amount: movement.valueDelta,
              debit: 'Inventory',
              credit: 'Production work in progress',
            })
          const variance =
            Math.round((materialValue - movement.valueDelta) * 100) / 100
          if (variance)
            state.journals.unshift({
              id: randomUUID(),
              date: movement.date,
              source: row._id,
              amount: Math.abs(variance),
              debit:
                variance > 0
                  ? 'Inventory adjustment expense'
                  : 'Production work in progress',
              credit:
                variance > 0
                  ? 'Production work in progress'
                  : 'Inventory adjustment gain',
            })
          await saveWorkspace(current, state, session)
          data.inventory_posted_at = new Date().toISOString()
        }
      }
      if (config.kind === 'visitor' && after !== before) {
        if (after === 'checked_in')
          data.check_in_time = new Date().toISOString()
        if (after === 'completed')
          data.check_out_time = new Date().toISOString()
      }
      if (config.kind === 'campaign') {
        const spent = Number(input.spend ?? row.data.spend),
          revenue = Number(input.revenueGenerated ?? row.data.revenue_generated)
        data.roi_percent = spent
          ? Math.round(((revenue - spent) * 10000) / spent) / 100
          : 0
      }
      if (
        config.kind === 'risk' &&
        after === 'controlled' &&
        !String(input.mitigationPlan ?? row.data.mitigation_plan).trim()
      )
        fail(400, 'Record a mitigation plan before controlling the risk.')
      return expose(await updateRecord(row, data, session))
    }),
    { status: id ? 200 : 201 },
  )
}
