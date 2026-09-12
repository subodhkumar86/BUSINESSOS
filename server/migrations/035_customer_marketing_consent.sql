ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS customers_marketing_contacts
  ON customers(tenant_id, marketing_opt_in, status)
  WHERE marketing_opt_in = true AND status = 'active';
