import type { Product, StockMovement, Journal } from './types.ts'
import { inventoryValue, stockMovement } from './inventory.ts'
export function restockReturnedProduct(
  product: Product,
  original: StockMovement,
  quantity: number,
  returnId: string,
  actor: string,
  date = new Date().toISOString(),
) {
  if (
    original.kind !== 'fulfillment' ||
    original.product !== product.id ||
    original.delta >= 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > -original.delta
  )
    throw Error('Return must reference a valid dispatch and quantity.')
  if (Math.round(product.cost * 100) !== Math.round(original.unitCost * 100))
    throw Error(
      'Product cost changed since dispatch. A controlled valuation adjustment is required before restocking.',
    )
  if (inventoryValue(original.delta, original.unitCost) !== original.valueDelta)
    throw Error('Original dispatch valuation is inconsistent.')
  const movement = stockMovement(
    { ...product, cost: original.unitCost },
    product.qty,
    product.qty + quantity,
    'return',
    'Inspected customer return',
    returnId,
    date,
  )
  movement.actor = actor
  const journal: Journal = {
    id: crypto.randomUUID(),
    date,
    source: movement.id,
    debit: 'Inventory',
    credit: 'Cost of goods sold',
    amount: movement.valueDelta,
  }
  return { product: { ...product, qty: movement.after }, movement, journal }
}
