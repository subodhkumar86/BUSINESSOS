CREATE TABLE asset_depreciation_postings (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 asset_id uuid NOT NULL REFERENCES assets(id),
 period text NOT NULL CHECK(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 amount numeric(20,2) NOT NULL CHECK(amount >= 0),
 journal_id uuid NOT NULL REFERENCES journals(id),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,asset_id,period)
);
CREATE INDEX asset_depreciation_tenant ON asset_depreciation_postings(tenant_id,period);
ALTER TABLE asset_depreciation_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_depreciation_postings FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_depreciation_scope ON asset_depreciation_postings
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE bank_poll_runs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 account_id uuid NOT NULL REFERENCES bank_accounts(id),
 polled_at timestamptz NOT NULL DEFAULT now(),
 transactions_seen integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX bank_poll_tenant ON bank_poll_runs(tenant_id,polled_at DESC);
ALTER TABLE bank_poll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_poll_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_poll_scope ON bank_poll_runs
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
