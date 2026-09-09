import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import type { Store } from './store.ts'
import type { Session } from './security.ts'
import { transition } from '../src/domain.ts'
import {
  shipmentInput,
  shipmentUpdate,
  shipmentTransitions,
} from '../src/shipment-contracts.ts'

type Fail = (status: number, message: string) => never
export async function handleShipments(args: {
  store: Store
  session: Session
  method: string
  id?: string
  input?: unknown
  requestKey?: string
  ensureCurrent: (c: PoolClient, s: Session) => Promise<unknown>
  fail: Fail
}) {
  const { store, session: s, method, fail } = args
  if (!['owner', 'operations_manager', 'auditor'].includes(s.user.role))
    fail(403, 'Your role cannot access shipments.')
  const id = args.id ? z.uuid().parse(args.id) : undefined
  if (
    !['GET', 'POST', 'PATCH'].includes(method) ||
    (method === 'POST' && id) ||
    (method === 'PATCH' && !id)
  )
    fail(405, 'Method not supported.')
  if (method !== 'GET' && s.user.role === 'auditor')
    fail(403, 'Auditors have read-only access.')
  return store.tenant(s.tenant, async (c) => {
    await args.ensureCurrent(c, s)
    if (method === 'GET') {
      const shipments = (
        await c.query(
          `SELECT s.*,l.name AS source_location_name FROM warehouse_shipments s LEFT JOIN warehouse_locations l ON l.id=s.source_location_id AND l.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.created_at DESC,s.id`,
          [s.tenant, id || null],
        )
      ).rows.map((row) => {
        const result = { ...row }
        delete result.tenant_id
        return result
      })
      if (id && !shipments.length) fail(404, 'Shipment not found.')
      return { status: 200, body: { shipments } }
    }
    const key = z.uuid().parse(args.requestKey)
    const input =
      method === 'POST'
        ? shipmentInput.parse(args.input)
        : shipmentUpdate.parse(args.input)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ method, id: id || null, input }))
      .digest('hex')
    // All stock writers acquire the tenant lock before warehouse row locks.
    const current = await store.read(c, s.tenant, true)
    const retry = (
      await c.query(
        'SELECT fingerprint,actor_id,response FROM shipment_requests WHERE tenant_id=$1 AND request_key=$2',
        [s.tenant, key],
      )
    ).rows[0]
    if (retry) {
      if (retry.fingerprint !== fingerprint || retry.actor_id !== s.user.id)
        fail(409, 'Idempotency key belongs to a different request.')
      return { status: 200, body: retry.response }
    }
    let shipmentId = id
    if (method === 'POST') {
      const data = shipmentInput.parse(input)
      const product = current.state.products.find(
        (item) => item.id === data.productId,
      )
      if (!product) return fail(404, 'Product not found in this workspace.')
      await location(data.sourceLocationId)
      shipmentId = randomUUID()
      await c.query(
        'INSERT INTO warehouse_shipments(id,tenant_id,order_ref,customer,product_id,product_name,quantity,source_location_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          shipmentId,
          s.tenant,
          data.orderRef,
          data.customer,
          product.id,
          product.name,
          data.quantity,
          data.sourceLocationId,
        ],
      )
      await audit(shipmentId, 'shipment_created', data.orderRef)
    } else {
      const data = shipmentUpdate.parse(input)
      const row = (
        await c.query(
          'SELECT * FROM warehouse_shipments WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [s.tenant, id],
        )
      ).rows[0]
      if (!row) return fail(404, 'Shipment not found.')
      if (row.version !== data.version)
        fail(409, 'Shipment changed. Refresh before updating.')
      if (!shipmentTransitions[row.status]?.includes(data.status))
        fail(409, 'This shipment status transition is not allowed.')
      if (data.status === 'dispatched') {
        await location(row.source_location_id)
        const product = current.state.products.find(
          (item) => item.id === row.product_id,
        )
        if (!product) return fail(404, 'Product not found in this workspace.')
        const allocations = (
          await c.query(
            'SELECT location_id,quantity FROM warehouse_stock WHERE tenant_id=$1 AND product_id=$2',
            [s.tenant, product.id],
          )
        ).rows
        const available = row.source_location_id
          ? Number(
              allocations.find(
                (item) => item.location_id === row.source_location_id,
              )?.quantity || 0,
            )
          : product.qty -
            allocations.reduce(
              (total, item) => total + Number(item.quantity),
              0,
            )
        if (available < row.quantity)
          fail(
            409,
            'Insufficient stock at the selected source. Receive or transfer stock before dispatching.',
          )
        let next
        try {
          next = transition(current.state, {
            type: 'stock_fulfill',
            data: {
              product: product.id,
              quantity: row.quantity,
              expectedQty: product.qty,
              reference: row.order_ref,
            },
          })
        } catch (error) {
          return fail(
            409,
            error instanceof Error ? error.message : 'Stock dispatch failed.',
          )
        }
        const movement = next.stockMovements[0]
        movement.source = row.id
        movement.actor = s.user.email
        await store.appendStock(c, s.tenant, movement)
        for (const journal of next.journals.slice(
          0,
          next.journals.length - current.state.journals.length,
        ))
          await store.append(c, s.tenant, journal, 'journals')
        if (row.source_location_id)
          await c.query(
            'UPDATE warehouse_stock SET quantity=quantity-$1 WHERE tenant_id=$2 AND location_id=$3 AND product_id=$4',
            [row.quantity, s.tenant, row.source_location_id, product.id],
          )
        await c.query(
          'UPDATE tenants SET state=$1,version=version+1 WHERE id=$2',
          [{ ...next, audit: [], journals: [], stockMovements: [] }, s.tenant],
        )
        await c.query(
          "UPDATE warehouse_shipments SET status='dispatched',version=version+1,stock_movement_id=$1,dispatched_at=now() WHERE tenant_id=$2 AND id=$3",
          [movement.id, s.tenant, row.id],
        )
        await audit(
          row.id,
          'shipment_dispatched',
          JSON.stringify({
            orderRef: row.order_ref,
            product: product.id,
            quantity: row.quantity,
            movementId: movement.id,
            sourceLocationId: row.source_location_id,
            costOfGoodsSold: -movement.valueDelta,
          }),
        )
      } else {
        await c.query(
          'UPDATE warehouse_shipments SET status=$1,version=version+1 WHERE tenant_id=$2 AND id=$3',
          [data.status, s.tenant, id],
        )
        await audit(row.id, 'shipment_' + data.status, row.order_ref)
      }
    }
    const { tenant_id: _, ...response } = (
      await c.query(
        'SELECT s.*,l.name AS source_location_name FROM warehouse_shipments s LEFT JOIN warehouse_locations l ON l.id=s.source_location_id AND l.tenant_id=s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2',
        [shipmentId, s.tenant],
      )
    ).rows[0]
    await c.query(
      'INSERT INTO shipment_requests(tenant_id,request_key,fingerprint,actor_id,response) VALUES($1,$2,$3,$4,$5)',
      [s.tenant, key, fingerprint, s.user.id, response],
    )
    return { status: method === 'POST' ? 201 : 200, body: response }
    async function location(locationId: string | null) {
      if (
        locationId &&
        !(
          await c.query(
            "SELECT id FROM warehouse_locations WHERE tenant_id=$1 AND id=$2 AND status='active'",
            [s.tenant, locationId],
          )
        ).rowCount
      )
        fail(404, 'Active source warehouse not found.')
    }
    async function audit(entity: string, action: string, detail: string) {
      await store.append(c, s.tenant, {
        id: randomUUID(),
        date: new Date().toISOString(),
        actor: s.user.email,
        entity,
        action,
        detail,
      })
    }
  })
}
