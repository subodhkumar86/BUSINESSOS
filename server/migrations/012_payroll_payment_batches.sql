CREATE TABLE payroll_payment_batches(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payroll_run_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK(amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','confirmed','failed')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,payroll_run_id),
  UNIQUE(tenant_id,idempotency_key)
);
CREATE INDEX payroll_payment_batches_tenant ON payroll_payment_batches(tenant_id,created_at DESC);
ALTER TABLE payroll_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_payment_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_payment_batches_scope ON payroll_payment_batches
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
