CREATE TABLE document_blobs(
  document_id uuid PRIMARY KEY REFERENCES documents(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 2097152),
  sha256 text NOT NULL CHECK(length(sha256)=64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_blobs_tenant ON document_blobs(tenant_id,document_id);
ALTER TABLE document_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_blobs FORCE ROW LEVEL SECURITY;
CREATE POLICY document_blobs_scope ON document_blobs
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
