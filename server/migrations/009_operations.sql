CREATE TABLE warehouse_locations(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  code text NOT NULL CHECK(length(code) BETWEEN 1 AND 40),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,code)
);
CREATE INDEX warehouse_locations_tenant ON warehouse_locations(tenant_id,updated_at DESC);
ALTER TABLE warehouse_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY warehouse_locations_scope ON warehouse_locations
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE suppliers(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  contact text NOT NULL DEFAULT '',
  lead_days integer NOT NULL DEFAULT 0 CHECK(lead_days BETWEEN 0 AND 3650),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','review','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_tenant_status ON suppliers(tenant_id,status,updated_at DESC);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY suppliers_scope ON suppliers
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
