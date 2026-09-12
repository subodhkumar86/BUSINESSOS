CREATE TABLE support_portals (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-f0-9]{32}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO support_portals(tenant_id,slug)
  SELECT id,md5(id::text || clock_timestamp()::text || random()::text) FROM tenants
  ON CONFLICT (tenant_id) DO NOTHING;
ALTER TABLE support_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_portals FORCE ROW LEVEL SECURITY;
CREATE POLICY support_portals_public_lookup ON support_portals FOR SELECT USING(true);
CREATE POLICY support_portals_tenant_write ON support_portals FOR ALL
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
