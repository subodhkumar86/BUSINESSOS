CREATE TABLE branches (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 code text NOT NULL CHECK(length(code) BETWEEN 1 AND 20),
 timezone text NOT NULL DEFAULT 'Africa/Lagos',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,code)
);
CREATE INDEX branches_tenant ON branches(tenant_id,status,created_at DESC);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
CREATE POLICY branches_scope ON branches
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE approval_chains (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 scope text NOT NULL CHECK(scope IN ('purchase_order','payroll','payment','master_data')),
 min_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK(min_amount >= 0),
 steps jsonb NOT NULL,
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_chains_tenant ON approval_chains(tenant_id,scope,active);
ALTER TABLE approval_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_chains FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_chains_scope ON approval_chains
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE approval_requests (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 chain_id uuid NOT NULL REFERENCES approval_chains(id),
 entity_type text NOT NULL,
 entity_id text NOT NULL,
 amount numeric(20,2) NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 current_step integer NOT NULL DEFAULT 0 CHECK(current_step >= 0),
 decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,entity_type,entity_id)
);
CREATE INDEX approval_requests_tenant ON approval_requests(tenant_id,status,created_at DESC);
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_requests_scope ON approval_requests
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
