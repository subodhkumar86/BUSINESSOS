import { z } from 'zod'
export const returnInput = z
  .object({
    shipmentId: z.uuid(),
    quantity: z.number().int().min(1).max(100000000),
    reason: z.string().trim().min(1).max(1000),
    destinationLocationId: z.uuid().nullable().default(null),
  })
  .strict()
export const returnUpdate = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(['inspected', 'restocked', 'closed_damaged', 'cancelled']),
    condition: z.enum(['restockable', 'damaged']).optional(),
    inspectionNotes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.status === 'inspected'
        ? !!input.condition && !!input.inspectionNotes
        : input.condition === undefined && input.inspectionNotes === undefined,
    'Condition and notes are required only when recording inspection.',
  )
export const returnTransitions: Record<string, string[]> = {
  inspecting: ['inspected', 'cancelled'],
  inspected: ['restocked', 'closed_damaged', 'cancelled'],
  restocked: [],
  closed_damaged: [],
  cancelled: [],
}
export interface ShipmentReturn {
  id: string
  shipment_id: string
  order_ref: string
  customer: string
  product_name: string
  quantity: number
  reason: string
  destination_location_id: string | null
  destination_location_name: string | null
  status: string
  condition: 'restockable' | 'damaged' | null
  inspection_notes: string
  version: number
  stock_movement_id: string | null
  created_at: string
}
