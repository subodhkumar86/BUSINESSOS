import { z } from 'zod'
export const shipmentInput = z
  .object({
    orderRef: z.string().trim().min(1).max(160),
    customer: z.string().trim().min(1).max(160),
    productId: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(100000000),
    sourceLocationId: z.uuid().nullable().default(null),
  })
  .strict()
export const shipmentUpdate = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(['packed', 'dispatched', 'cancelled']),
  })
  .strict()
export const shipmentTransitions: Record<string, string[]> = {
  picking: ['packed', 'cancelled'],
  packed: ['dispatched', 'cancelled'],
  dispatched: [],
  cancelled: [],
}
export interface Shipment {
  id: string
  order_ref: string
  customer: string
  product_id: string
  product_name: string
  quantity: number
  source_location_id: string | null
  source_location_name: string | null
  status: string
  version: number
  stock_movement_id: string | null
  dispatched_at: string | null
  created_at: string
}
