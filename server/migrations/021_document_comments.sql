CREATE TABLE document_comments(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_comments_document_idx ON document_comments(tenant_id,document_id,created_at DESC);
ALTER TABLE document_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY document_comments_scope ON document_comments
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER document_comments_immutable BEFORE UPDATE OR DELETE ON document_comments
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_change();
