import test from 'node:test'
import assert from 'node:assert/strict'
import {
  returnInput,
  returnUpdate,
  returnTransitions,
} from '../src/return-contracts.ts'
import { restockReturnedProduct } from '../src/returns.ts'
import { stockMovement } from '../src/inventory.ts'
import type { Product } from '../src/types.ts'
test('return inputs require shipment linkage, positive integral quantity and inspection evidence', () => {
  const input = {
    shipmentId: crypto.randomUUID(),
    quantity: 2,
    reason: 'Wrong size',
  }
  assert.equal(returnInput.parse(input).destinationLocationId, null)
  for (const data of [
    { ...input, quantity: 0 },
    { ...input, quantity: 1.1 },
    { ...input, shipmentId: 'other' },
    { ...input, tenant_id: crypto.randomUUID() },
  ])
    assert.equal(returnInput.safeParse(data).success, false)
  assert.equal(
    returnUpdate.safeParse({
      version: 1,
      status: 'inspected',
      condition: 'restockable',
    }).success,
    false,
  )
  assert.equal(
    returnUpdate.safeParse({
      version: 1,
      status: 'restocked',
      condition: 'restockable',
      inspectionNotes: 'Bypass inspection',
    }).success,
    false,
  )
  assert.equal(
    returnUpdate.safeParse({
      version: 1,
      status: 'inspected',
      condition: 'damaged',
      inspectionNotes: 'Broken casing',
    }).success,
    true,
  )
  assert.equal(returnTransitions.inspecting.includes('restocked'), false)
  assert.deepEqual(returnTransitions.restocked, [])
})
test('restock restores original dispatch cost and reverses COGS without mutating inputs', () => {
  const product: Product = {
    id: 'p1',
    name: 'Item',
    sku: 'SKU',
    qty: 7,
    cost: 12.34,
    min: 1,
  }
  const original = stockMovement(
    product,
    10,
    7,
    'fulfillment',
    'Order',
    'shipment',
  )
  const result = restockReturnedProduct(
    product,
    original,
    2,
    'return',
    'operator',
  )
  assert.equal(result.product.qty, 9)
  assert.equal(result.movement.kind, 'return')
  assert.equal(result.movement.unitCost, 12.34)
  assert.equal(result.movement.valueDelta, 24.68)
  assert.equal(result.movement.source, 'return')
  assert.equal(result.journal.source, result.movement.id)
  assert.equal(result.journal.debit, 'Inventory')
  assert.equal(result.journal.credit, 'Cost of goods sold')
  assert.equal(result.journal.amount, 24.68)
  assert.equal(product.qty, 7)
  for (const quantity of [0, 1.5, 4])
    assert.throws(() =>
      restockReturnedProduct(product, original, quantity, 'return', 'actor'),
    )
  assert.throws(
    () =>
      restockReturnedProduct(
        { ...product, cost: 15 },
        original,
        1,
        'return',
        'actor',
      ),
    /cost changed/,
  )
  assert.throws(() =>
    restockReturnedProduct(
      { ...product, qty: 100000000 },
      original,
      1,
      'return',
      'actor',
    ),
  )
  assert.throws(
    () =>
      restockReturnedProduct(
        product,
        { ...original, valueDelta: -1 },
        1,
        'return',
        'actor',
      ),
    /inconsistent/,
  )
})
