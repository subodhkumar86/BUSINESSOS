CREATE TABLE workflow_records (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 kind text NOT NULL CHECK(kind IN ('leave','goals','appointments','certifications','findings','knowledge')),
 status text NOT NULL,
 data jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 created_by uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL,
 fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_key)
);
CREATE INDEX workflow_records_scope ON workflow_records(tenant_id,kind,updated_at DESC);
ALTER TABLE workflow_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_records FORCE ROW LEVEL SECURITY;
CREATE POLICY workflow_record_scope ON workflow_records
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
