import { z } from 'zod'
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
import { readWorkspace } from './workspace'

export async function handleSupply(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const route = ctx.path.match(/^\/supply\/shipments(?:\/([^/]+))?$/)
  if (!route) return
  const { account, request } = ctx,
    tenant = account.tenant,
    method = request.method
  requireRole(account, [
    'owner',
    'operations_manager',
    'finance_admin',
    'auditor',
  ])
  if (!ctx.features.includes('operations'))
    fail(403, 'Your plan does not include supply-chain operations.')
  const id = route[1] ? z.uuid().parse(route[1]) : undefined
  if (method === 'GET')
    return Response.json({
      shipments: id
        ? [expose(await findRecord(tenant, 'supply:shipment', id))]
        : await listRecords(tenant, 'supply:shipment'),
    })
  requireRole(account, ['owner', 'operations_manager'])
  if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
    fail(405, 'Method not supported.')
  const text = z.string().trim().min(1).max(200)
  const input = id
    ? z
        .object({
          version: z.number().int().positive(),
          status: z.enum(['in_transit', 'customs_cleared', 'delivered']),
        })
        .strict()
        .parse(await ctx.input())
    : z
        .object({
          purchaseOrderId: z.uuid(),
          carrier: text,
          trackingCode: text,
          destination: text,
          eta: z.iso.date(),
          logisticsCost: z.number().finite().min(0).max(10000000000),
        })
        .strict()
        .parse(await ctx.input())
  return Response.json(
    await mutate(ctx, input, async (session) => {
      if (id && 'status' in input) {
        const row = await findRecord(tenant, 'supply:shipment', id, session)
        if (row.version !== input.version)
          fail(409, 'Shipment changed. Refresh before updating.')
        const transitions: Record<string, string> = {
          booked: 'in_transit',
          in_transit: 'customs_cleared',
          customs_cleared: 'delivered',
        }
        if (transitions[String(row.data.status)] !== input.status)
          fail(409, 'Advance inbound shipments one milestone at a time.')
        return expose(
          await updateRecord(
            row,
            {
              status: input.status,
              ...(input.status === 'delivered'
                ? { delivered_at: new Date().toISOString() }
                : {}),
            },
            session,
          ),
        )
      }
      if (!('purchaseOrderId' in input)) fail(400, 'Select a purchase order.')
      const order = (await readWorkspace(tenant, session)).state.orders.find(
        (o) => o.id === input.purchaseOrderId,
      )
      if (!order || !['Approved', 'Received'].includes(order.status))
        fail(409, 'Select an approved purchase order from this workspace.')
      return expose(
        await insertRecord(
          tenant,
          'supply:shipment',
          {
            poRef: order.id,
            supplier: order.name,
            carrier: input.carrier,
            trackingCode: input.trackingCode,
            destination: input.destination,
            eta: input.eta,
            logisticsCost: input.logisticsCost,
            status: 'booked',
            delivered_at: null,
          },
          session,
        ),
      )
    }),
    { status: id ? 200 : 201 },
  )
}
