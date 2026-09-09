import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shipmentInput,
  shipmentUpdate,
  shipmentTransitions,
} from '../src/shipment-contracts.ts'
test('shipment contract rejects forged fields, invalid source IDs and unsafe quantities', () => {
  const input = {
    orderRef: 'SO-1',
    customer: 'Customer',
    productId: 'p1',
    quantity: 2,
  }
  assert.equal(shipmentInput.parse(input).sourceLocationId, null)
  for (const data of [
    { ...input, quantity: 0 },
    { ...input, quantity: 1.5 },
    { ...input, quantity: 100000001 },
    { ...input, sourceLocationId: 'foreign' },
    { ...input, status: 'dispatched' },
    { ...input, tenant_id: 'forged' },
  ])
    assert.equal(shipmentInput.safeParse(data).success, false)
  assert.equal(
    shipmentUpdate.safeParse({ version: 0, status: 'packed' }).success,
    false,
  )
  assert.equal(
    shipmentUpdate.safeParse({ version: 1, status: 'packed', quantity: 10 })
      .success,
    false,
  )
})
test('shipment lifecycle requires packing and disallows changes after dispatch or cancellation', () => {
  assert.equal(shipmentTransitions.picking.includes('dispatched'), false)
  assert.equal(shipmentTransitions.packed.includes('dispatched'), true)
  assert.deepEqual(shipmentTransitions.dispatched, [])
  assert.deepEqual(shipmentTransitions.cancelled, [])
})
