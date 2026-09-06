CREATE TABLE bank_accounts(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  external_ref text NOT NULL,
  name text NOT NULL,
  currency text NOT NULL,
  status text NOT NULL CHECK(status IN ('active','disconnected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,provider,external_ref)
);
CREATE TABLE bank_transactions(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  external_ref text NOT NULL,
  occurred_at timestamptz NOT NULL,
  amount numeric(18,2) NOT NULL CHECK(amount <> 0),
  direction text NOT NULL CHECK(direction IN ('credit','debit')),
  reference text NOT NULL,
  raw_payload jsonb NOT NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK(match_status IN ('unmatched','suggested','matched','ignored')),
  matched_entity_type text,
  matched_entity_id uuid,
  reconciled_at timestamptz,
  reconciled_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bank_account_id,external_ref)
);
CREATE INDEX bank_accounts_tenant ON bank_accounts(tenant_id);
CREATE INDEX bank_transactions_tenant_account_date ON bank_transactions(tenant_id,bank_account_id,occurred_at DESC);
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_accounts_scope ON bank_accounts USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_transactions_scope ON bank_transactions USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
