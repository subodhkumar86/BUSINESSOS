import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import type { Store } from './store.ts'
import type { Session } from './security.ts'
import {
  returnInput,
  returnUpdate,
  returnTransitions,
} from '../src/return-contracts.ts'
import { restockReturnedProduct } from '../src/returns.ts'
type Fail = (status: number, message: string) => never
const selection = `SELECT r.*,s.order_ref,s.customer,s.product_name,l.name AS destination_location_name FROM shipment_returns r JOIN warehouse_shipments s ON s.id=r.shipment_id AND s.tenant_id=r.tenant_id LEFT JOIN warehouse_locations l ON l.id=r.destination_location_id AND l.tenant_id=r.tenant_id WHERE r.tenant_id=$1`
const publicRow = (row: Record<string, unknown>) => {
  const result = { ...row }
  delete result.tenant_id
  return result
}
export async function handleReturns(args: {
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
    fail(403, 'Your role cannot access shipment returns.')
  if (method !== 'GET' && s.user.role === 'auditor')
    fail(403, 'Auditors have read-only access.')
  const id = args.id ? z.uuid().parse(args.id) : undefined
  if (
    !['GET', 'POST', 'PATCH'].includes(method) ||
    (method === 'POST' && id) ||
    (method === 'PATCH' && !id)
  )
    fail(405, 'Method not supported.')
  return store.tenant(s.tenant, async (c) => {
    await args.ensureCurrent(c, s)
    if (method === 'GET') {
      const rows = (
        await c.query(
          selection +
            ' AND ($2::uuid IS NULL OR r.id=$2) ORDER BY r.created_at DESC,r.id',
          [s.tenant, id || null],
        )
      ).rows.map(publicRow)
      if (id && !rows.length) fail(404, 'Return not found.')
      return { status: 200, body: { returns: rows } }
    }
    const key = z.uuid().parse(args.requestKey)
    const input =
      method === 'POST'
        ? returnInput.parse(args.input)
        : returnUpdate.parse(args.input)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ method, id: id || null, input }))
      .digest('hex')
    const current = await store.read(c, s.tenant, true)
    const retry = (
      await c.query(
        'SELECT fingerprint,actor_id,response FROM return_requests WHERE tenant_id=$1 AND request_key=$2',
        [s.tenant, key],
      )
    ).rows[0]
    if (retry) {
      if (retry.fingerprint !== fingerprint || retry.actor_id !== s.user.id)
        fail(409, 'Idempotency key belongs to a different request.')
      return { status: 200, body: retry.response }
    }
    let returnId = id
    if (method === 'POST') {
      const data = returnInput.parse(input)
      const shipment = await getShipment(data.shipmentId)
      if (shipment.status !== 'dispatched')
        fail(409, 'Only dispatched shipments can be returned.')
      await location(data.destinationLocationId)
      const returned = Number(
        (
          await c.query(
            "SELECT COALESCE(SUM(quantity),0) AS quantity FROM shipment_returns WHERE tenant_id=$1 AND shipment_id=$2 AND status <> 'cancelled'",
            [s.tenant, shipment.id],
          )
        ).rows[0].quantity,
      )
      if (returned + data.quantity > shipment.quantity)
        fail(409, 'Return quantity exceeds the remaining dispatched quantity.')
      returnId = randomUUID()
      await c.query(
        'INSERT INTO shipment_returns(id,tenant_id,shipment_id,quantity,reason,destination_location_id) VALUES($1,$2,$3,$4,$5,$6)',
        [
          returnId,
          s.tenant,
          shipment.id,
          data.quantity,
          data.reason,
          data.destinationLocationId,
        ],
      )
      await audit(
        returnId,
        'shipment_return_created',
        JSON.stringify({ shipmentId: shipment.id, quantity: data.quantity }),
      )
    } else {
      const data = returnUpdate.parse(input)
      const row = (
        await c.query(
          'SELECT * FROM shipment_returns WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [s.tenant, id],
        )
      ).rows[0]
      if (!row) return fail(404, 'Return not found.')
      if (row.version !== data.version)
        fail(409, 'Return changed. Refresh before updating.')
      if (!returnTransitions[row.status]?.includes(data.status))
        fail(409, 'This return status transition is not allowed.')
      if (data.status === 'closed_damaged' && row.condition !== 'damaged')
        fail(409, 'Only damaged goods can be closed as damaged.')
      let movementId: string | null = null
      if (data.status === 'restocked') {
        if (row.condition !== 'restockable')
          fail(409, 'Inspection must confirm the goods are restockable.')
        await location(row.destination_location_id)
        const shipment = await getShipment(row.shipment_id)
        const original = current.state.stockMovements.find(
          (m) => m.id === shipment.stock_movement_id,
        )
        const product = current.state.products.find(
          (p) => p.id === shipment.product_id,
        )
        if (
          shipment.status !== 'dispatched' ||
          !original ||
          original.source !== shipment.id ||
          !product
        )
          return fail(409, 'Original dispatch evidence is unavailable.')
        let posting
        try {
          posting = restockReturnedProduct(
            product,
            original,
            row.quantity,
            row.id,
            s.user.email,
          )
        } catch (error) {
          return fail(
            409,
            error instanceof Error ? error.message : 'Return valuation failed.',
          )
        }
        await store.appendStock(c, s.tenant, posting.movement)
        await store.append(c, s.tenant, posting.journal, 'journals')
        if (row.destination_location_id)
          await c.query(
            'INSERT INTO warehouse_stock(tenant_id,location_id,product_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,location_id,product_id) DO UPDATE SET quantity=warehouse_stock.quantity+EXCLUDED.quantity',
            [s.tenant, row.destination_location_id, product.id, row.quantity],
          )
        const next = {
          ...current.state,
          products: current.state.products.map((p) =>
            p.id === product.id ? posting.product : p,
          ),
          audit: [],
          journals: [],
          stockMovements: [],
        }
        await c.query(
          'UPDATE tenants SET state=$1,version=version+1 WHERE id=$2',
          [next, s.tenant],
        )
        movementId = posting.movement.id
        await audit(
          row.id,
          'shipment_return_restocked',
          JSON.stringify({
            shipmentId: shipment.id,
            movementId,
            quantity: row.quantity,
            originalUnitCost: posting.movement.unitCost,
            value: posting.journal.amount,
            destinationLocationId: row.destination_location_id,
          }),
        )
      } else
        await audit(
          row.id,
          'shipment_return_' + data.status,
          JSON.stringify({
            shipmentId: row.shipment_id,
            condition: data.condition || row.condition,
            inspectionNotes: data.inspectionNotes || row.inspection_notes,
          }),
        )
      await c.query(
        'UPDATE shipment_returns SET status=$1,condition=COALESCE($2,condition),inspection_notes=COALESCE($3,inspection_notes),stock_movement_id=$4,version=version+1,updated_at=now() WHERE tenant_id=$5 AND id=$6',
        [
          data.status,
          data.condition || null,
          data.inspectionNotes || null,
          movementId,
          s.tenant,
          id,
        ],
      )
    }
    const response = publicRow(
      (await c.query(selection + ' AND r.id=$2', [s.tenant, returnId])).rows[0],
    )
    await c.query(
      'INSERT INTO return_requests(tenant_id,request_key,fingerprint,actor_id,response) VALUES($1,$2,$3,$4,$5)',
      [s.tenant, key, fingerprint, s.user.id, response],
    )
    return { status: method === 'POST' ? 201 : 200, body: response }
    async function getShipment(shipmentId: string) {
      const row = (
        await c.query(
          'SELECT * FROM warehouse_shipments WHERE tenant_id=$1 AND id=$2',
          [s.tenant, shipmentId],
        )
      ).rows[0]
      if (!row) return fail(404, 'Shipment not found.')
      return row
    }
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
        fail(404, 'Active destination warehouse not found.')
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
