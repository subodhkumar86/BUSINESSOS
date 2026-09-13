CREATE TABLE workspace_messages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK(char_length(trim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_messages_tenant_created_idx ON workspace_messages(tenant_id,created_at DESC);
ALTER TABLE workspace_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_messages_tenant_scope ON workspace_messages
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
