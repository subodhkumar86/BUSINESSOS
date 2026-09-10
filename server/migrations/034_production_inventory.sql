-- Production batches can declare raw-material requirements and a finished-good SKU.
-- Inventory mutations are posted only when a batch reaches completed status.
ALTER TABLE production_batches
  ADD COLUMN IF NOT EXISTS output_product_id text,
  ADD COLUMN IF NOT EXISTS materials jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inventory_posted_at timestamptz;

ALTER TABLE production_batches
  ADD CONSTRAINT production_materials_array CHECK (jsonb_typeof(materials) = 'array');

CREATE INDEX IF NOT EXISTS production_output_product_tenant
  ON production_batches(tenant_id, output_product_id)
  WHERE output_product_id IS NOT NULL;