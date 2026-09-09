CREATE TABLE document_shares(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_shares_lookup ON document_shares(token_hash,expires_at);
ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY document_shares_scope ON document_shares
  USING(
    tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    OR token_hash=current_setting('app.share_token',true)
  )
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
