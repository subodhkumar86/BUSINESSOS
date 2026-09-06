CREATE TABLE documents(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 120),
  size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 104857600),
  storage_key text NOT NULL CHECK(length(storage_key) BETWEEN 1 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,storage_key,version)
);
CREATE INDEX documents_tenant_updated ON documents(tenant_id,updated_at DESC);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_scope ON documents
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER documents_immutable_delete_guard BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_change();
