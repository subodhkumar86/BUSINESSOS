CREATE TABLE notifications(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  recipient_id uuid NOT NULL REFERENCES users(id),
  actor_id uuid REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('announcement','workflow','record','security')),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_idx ON notifications(tenant_id,recipient_id,read_at,created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_scope ON notifications
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
