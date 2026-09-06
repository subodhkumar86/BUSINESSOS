CREATE TABLE module_records(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  module text NOT NULL CHECK(module IN ('billing','documents','automation','warehouse','support','tax','supply','compliance','workspace','admin')),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  detail text NOT NULL DEFAULT '' CHECK(length(detail) <= 500),
  status text NOT NULL DEFAULT 'Draft' CHECK(length(status) BETWEEN 1 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,module,name)
);
CREATE INDEX module_records_tenant_module ON module_records(tenant_id,module,updated_at DESC);
ALTER TABLE module_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_records FORCE ROW LEVEL SECURITY;
CREATE POLICY module_records_scope ON module_records
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
