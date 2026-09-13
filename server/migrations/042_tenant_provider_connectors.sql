CREATE TABLE tenant_provider_connectors(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  category text NOT NULL CHECK(category IN ('email','sms','whatsapp','bank_feed','payment','three_pl')),
  provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sandbox','active','disabled')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  encrypted_credentials bytea,
  credential_iv bytea,
  credential_tag bytea,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,category,provider)
);
ALTER TABLE tenant_provider_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_provider_connectors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_provider_connectors_scope ON tenant_provider_connectors
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
