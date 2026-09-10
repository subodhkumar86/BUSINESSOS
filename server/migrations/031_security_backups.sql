CREATE TABLE mfa_enrollments (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 secret text NOT NULL,
 verified boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz
);
ALTER TABLE mfa_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_scope ON mfa_enrollments
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE data_backups (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 byte_size integer NOT NULL CHECK(byte_size >= 0),
 sha256 text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backups_tenant ON data_backups(tenant_id,created_at DESC);
ALTER TABLE data_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_backups FORCE ROW LEVEL SECURITY;
CREATE POLICY backups_scope ON data_backups
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
