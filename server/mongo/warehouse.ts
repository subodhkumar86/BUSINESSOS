import { z } from 'zod'
import type { ClientSession } from 'mongodb'
import { database } from './database'
import { fail, requireRole } from './security'
import { readWorkspace, saveWorkspace } from './workspace'
import {
  expose,
  findRecord,
  insertRecord,
  listRecords,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'
import {
  shipmentInput,
  shipmentUpdate,
  shipmentTransitions,
  type Shipment,
} from '../../src/shipment-contracts'
import {
  returnInput,
  returnUpdate,
  returnTransitions,
  type ShipmentReturn,
} from '../../src/return-contracts'
import { transition } from '../../src/domain'
import { restockReturnedProduct } from '../../src/returns'

const quantity = z.number().int().min(1).max(100000000)
const locationInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().max(40).default(''),
    detail: z.string().trim().max(1000).default(''),
  })
  .strict()
const transferInput = z
  .object({
    productId: z.string().min(1).max(100),
    sourceLocationId: z.uuid().nullable().default(null),
    destinationLocationId: z.uuid(),
    quantity,
  })
  .strict()

export async function handleWarehouse(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  if (!ctx.path.startsWith('/warehouse/')) return
  const { account, request, path } = ctx,
    tenant = account.tenant,
    method = request.method
  requireRole(account, ['owner', 'operations_manager', 'auditor'])
  if (!ctx.features.includes('operations'))
    fail(403, 'Your plan does not include warehouse operations.')
  if (method !== 'GET') requireRole(account, ['owner', 'operations_manager'])
  const d = await database()
  async function location(id: string | null, session: ClientSession) {
    return id
      ? String(
          (await findRecord(tenant, 'warehouse:location', id, session)).data
            .name,
        )
      : null
  }
  async function allocation(
    product: string,
    id: string | null,
    total: number,
    session: ClientSession,
  ) {
    const rows = await d.records
      .find(
        { tenant, kind: 'warehouse:balance', 'data.product_id': product },
        { session },
      )
      .toArray()
    return id
      ? Number(
          rows.find((row) => row.data.location_id === id)?.data.quantity || 0,
        )
      : total - rows.reduce((sum, row) => sum + Number(row.data.quantity), 0)
  }
  async function adjust(
    product: string,
    id: string | null,
    delta: number,
    session: ClientSession,
  ) {
    if (!id) return
    const row = await d.records.findOne(
      {
        tenant,
        kind: 'warehouse:balance',
        'data.product_id': product,
        'data.location_id': id,
      },
      { session },
    )
    const next = Number(row?.data.quantity || 0) + delta
    if (!Number.isSafeInteger(next) || next < 0 || next > 100000000)
      fail(409, 'Invalid warehouse balance.')
    if (row) await updateRecord(row, { quantity: next }, session)
    else
      await insertRecord(
        tenant,
        'warehouse:balance',
        { product_id: product, location_id: id, quantity: next },
        session,
      )
  }
  if (path === '/warehouse/locations') {
    if (method === 'GET')
      return Response.json({
        locations: await listRecords(tenant, 'warehouse:location'),
      })
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = locationInput.parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        if (
          await d.records.findOne(
            { tenant, kind: 'warehouse:location', 'data.name': input.name },
            { session },
          )
        )
          fail(409, 'Location name already exists.')
        return expose(
          await insertRecord(
            tenant,
            'warehouse:location',
            { ...input, status: 'active' },
            session,
          ),
        )
      }),
      { status: 201 },
    )
  }
  if (path === '/warehouse/stock' && method === 'GET')
    return Response.json({
      stock: await listRecords(tenant, 'warehouse:balance'),
    })
  const tracking = path.match(
    /^\/warehouse\/(fulfillments|returns)(?:\/([^/]+))?$/,
  )
  if (tracking) {
    const fulfillment = tracking[1] === 'fulfillments',
      kind = fulfillment
        ? 'warehouse:fulfillment-tracking'
        : 'warehouse:return-tracking',
      id = tracking[2] ? z.uuid().parse(tracking[2]) : undefined
    if (method === 'GET')
      return Response.json({
        records: id
          ? [expose(await findRecord(tenant, kind, id))]
          : await listRecords(tenant, kind),
      })
    if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
      fail(405, 'Method not supported.')
    const text = z.string().trim().min(1).max(200),
      optional = z.string().trim().max(200).default('')
    const input = id
      ? z
          .object({ status: z.string().max(30) })
          .strict()
          .parse(await ctx.input())
      : fulfillment
        ? z
            .object({
              orderRef: text,
              customer: optional,
              items: text,
              location: optional,
              assignee: optional,
            })
            .strict()
            .parse(await ctx.input())
        : z
            .object({
              rma: text,
              customer: optional,
              product: text,
              condition: z.enum([
                'inspecting',
                'restockable',
                'damaged',
                'salvage',
              ]),
            })
            .strict()
            .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        if (id && 'status' in input) {
          const row = await findRecord(tenant, kind, id, session)
          const transitions: Record<string, string[]> = fulfillment
            ? { picking: ['packed'], packed: ['dispatched'], dispatched: [] }
            : {
                pending: ['restocked', 'refunded', 'exchanged'],
                restocked: [],
                refunded: [],
                exchanged: [],
              }
          if (!transitions[String(row.data.status)]?.includes(input.status))
            fail(409, 'Tracking transition is not allowed.')
          return expose(
            await updateRecord(row, { status: input.status }, session),
          )
        }
        if ('orderRef' in input)
          return expose(
            await insertRecord(
              tenant,
              kind,
              {
                name: input.orderRef,
                detail: input.items,
                status: 'picking',
                metadata: {
                  kind: 'fulfillment',
                  customer: input.customer,
                  location: input.location,
                  assignee: input.assignee,
                },
              },
              session,
            ),
          )
        if ('rma' in input)
          return expose(
            await insertRecord(
              tenant,
              kind,
              {
                name: input.rma,
                detail: input.product,
                status: 'pending',
                metadata: {
                  kind: 'return',
                  customer: input.customer,
                  condition: input.condition,
                },
              },
              session,
            ),
          )
        fail(400, 'Invalid tracking record.')
      }),
      { status: id ? 200 : 201 },
    )
  }
  if (path === '/warehouse/transfers') {
    if (method === 'GET')
      return Response.json({
        transfers: await listRecords(tenant, 'warehouse:transfer'),
      })
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = transferInput.parse(await ctx.input())
    return Response.json(
      await mutate(
        ctx,
        input,
        async (session) => {
          if (input.sourceLocationId === input.destinationLocationId)
            fail(400, 'Source and destination must differ.')
          await location(input.sourceLocationId, session)
          await location(input.destinationLocationId, session)
          const current = await readWorkspace(tenant, session),
            product = current.state.products.find(
              (p) => p.id === input.productId,
            )
          if (!product) fail(404, 'Product not found.')
          if (
            (await allocation(
              product.id,
              input.sourceLocationId,
              product.qty,
              session,
            )) < input.quantity
          )
            fail(409, 'Insufficient stock at the selected source.')
          await adjust(
            product.id,
            input.sourceLocationId,
            -input.quantity,
            session,
          )
          await adjust(
            product.id,
            input.destinationLocationId,
            input.quantity,
            session,
          )
          return expose(
            await insertRecord(
              tenant,
              'warehouse:transfer',
              {
                product_id: product.id,
                product_name: product.name,
                quantity: input.quantity,
                source_location_id: input.sourceLocationId,
                destination_location_id: input.destinationLocationId,
              },
              session,
            ),
          )
        },
        true,
      ),
      { status: 201 },
    )
  }
  const route = path.match(
    /^\/warehouse\/(shipments|shipment-returns)(?:\/([^/]+))?$/,
  )
  if (!route) return
  const returns = route[1] === 'shipment-returns',
    kind = returns ? 'warehouse:return' : 'warehouse:shipment',
    id = route[2] ? z.uuid().parse(route[2]) : undefined
  if (method === 'GET') {
    const rows = id
      ? [expose(await findRecord(tenant, kind, id))]
      : await listRecords(tenant, kind)
    return Response.json({ [returns ? 'returns' : 'shipments']: rows })
  }
  if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
    fail(405, 'Method not supported.')
  const raw = await ctx.input()
  const input = returns
    ? id
      ? returnUpdate.parse(raw)
      : returnInput.parse(raw)
    : id
      ? shipmentUpdate.parse(raw)
      : shipmentInput.parse(raw)
  const result = await mutate(
    ctx,
    input,
    async (session) => {
      const current = await readWorkspace(tenant, session)
      if (!returns && !id) {
        const b = shipmentInput.parse(input),
          product = current.state.products.find((p) => p.id === b.productId)
        if (!product) fail(404, 'Product not found.')
        const name = await location(b.sourceLocationId, session)
        return expose(
          await insertRecord(
            tenant,
            kind,
            {
              order_ref: b.orderRef,
              customer: b.customer,
              product_id: product.id,
              product_name: product.name,
              quantity: b.quantity,
              source_location_id: b.sourceLocationId,
              source_location_name: name,
              status: 'picking',
              stock_movement_id: null,
              dispatched_at: null,
            },
            session,
          ),
        )
      }
      if (returns && !id) {
        const b = returnInput.parse(input),
          shipment = expose<Shipment>(
            await findRecord(
              tenant,
              'warehouse:shipment',
              b.shipmentId,
              session,
            ),
          )
        if (shipment.status !== 'dispatched' || !shipment.stock_movement_id)
          fail(409, 'Only dispatched shipments can be returned.')
        const previous = await d.records
          .find(
            {
              tenant,
              kind,
              'data.shipment_id': shipment.id,
              'data.status': { $ne: 'cancelled' },
            },
            { session },
          )
          .toArray()
        if (
          previous.reduce((sum, row) => sum + Number(row.data.quantity), 0) +
            b.quantity >
          shipment.quantity
        )
          fail(409, 'Return quantity exceeds the remaining shipped quantity.')
        const name = await location(b.destinationLocationId, session)
        return expose(
          await insertRecord(
            tenant,
            kind,
            {
              shipment_id: shipment.id,
              order_ref: shipment.order_ref,
              customer: shipment.customer,
              product_name: shipment.product_name,
              quantity: b.quantity,
              reason: b.reason,
              destination_location_id: b.destinationLocationId,
              destination_location_name: name,
              status: 'inspecting',
              condition: null,
              inspection_notes: '',
              stock_movement_id: null,
            },
            session,
          ),
        )
      }
      const row = await findRecord(tenant, kind, id!, session)
      const b = returns
        ? returnUpdate.parse(input)
        : shipmentUpdate.parse(input)
      if (row.version !== b.version)
        fail(409, 'Record changed. Refresh before updating.')
      const transitions = returns ? returnTransitions : shipmentTransitions
      if (!transitions[String(row.data.status)]?.includes(b.status))
        fail(409, 'Status transition is not allowed.')
      const changes: Record<string, unknown> = { status: b.status }
      if (!returns && b.status === 'dispatched') {
        const shipment = expose<Shipment>(row),
          product = current.state.products.find(
            (p) => p.id === shipment.product_id,
          )
        if (!product) fail(404, 'Product not found.')
        if (
          (await allocation(
            product.id,
            shipment.source_location_id,
            product.qty,
            session,
          )) < shipment.quantity
        )
          fail(409, 'Insufficient stock at the selected source.')
        const next = transition(current.state, {
          type: 'stock_fulfill',
          data: {
            product: product.id,
            quantity: shipment.quantity,
            expectedQty: product.qty,
            reference: shipment.order_ref,
          },
        })
        const movement = next.stockMovements[0]
        movement.source = row._id
        movement.actor = account.email
        await adjust(
          product.id,
          shipment.source_location_id,
          -shipment.quantity,
          session,
        )
        await saveWorkspace(current, next, session)
        changes.stock_movement_id = movement.id
        changes.dispatched_at = new Date().toISOString()
      }
      if (returns) {
        const returned = expose<ShipmentReturn>(row),
          b = returnUpdate.parse(input)
        if (b.status === 'inspected') {
          changes.condition = b.condition
          changes.inspection_notes = b.inspectionNotes
        }
        if (b.status === 'closed_damaged' && returned.condition !== 'damaged')
          fail(409, 'Only damaged items may close as damaged.')
        if (b.status === 'restocked') {
          if (returned.condition !== 'restockable')
            fail(409, 'Only inspected restockable items can be restocked.')
          const shipment = expose<Shipment>(
            await findRecord(
              tenant,
              'warehouse:shipment',
              returned.shipment_id,
              session,
            ),
          )
          const product = current.state.products.find(
              (p) => p.id === shipment.product_id,
            ),
            original = current.state.stockMovements.find(
              (m) => m.id === shipment.stock_movement_id,
            )
          if (!product || !original)
            fail(409, 'Original dispatch evidence is missing.')
          let restored
          try {
            restored = restockReturnedProduct(
              product,
              original,
              returned.quantity,
              row._id,
              account.email,
            )
          } catch (error) {
            fail(
              409,
              error instanceof Error ? error.message : 'Restocking failed.',
            )
          }
          const next = structuredClone(current.state)
          next.products = next.products.map((p) =>
            p.id === product.id ? restored.product : p,
          )
          next.stockMovements.unshift(restored.movement)
          next.journals.unshift(restored.journal)
          await location(returned.destination_location_id, session)
          await adjust(
            product.id,
            returned.destination_location_id,
            returned.quantity,
            session,
          )
          await saveWorkspace(current, next, session)
          changes.stock_movement_id = restored.movement.id
        }
      }
      return expose(await updateRecord(row, changes, session))
    },
    true,
  )
  return Response.json(result, { status: id ? 200 : 201 })
}
