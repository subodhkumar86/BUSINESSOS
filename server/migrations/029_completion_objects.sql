CREATE TABLE file_objects (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 object_key text NOT NULL,
 bucket text NOT NULL DEFAULT 'local',
 size_bytes integer NOT NULL CHECK(size_bytes >= 0),
 mime_type text NOT NULL,
 status text NOT NULL DEFAULT 'stored' CHECK(status IN ('stored','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,object_key)
);
ALTER TABLE file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY file_objects_scope ON file_objects
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE IF NOT EXISTS candidate_interviews (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 candidate_id uuid NOT NULL REFERENCES recruitment_candidates(id),
 interview_at timestamptz NOT NULL,
 interviewers text NOT NULL DEFAULT '',
 score integer CHECK(score IS NULL OR (score BETWEEN 0 AND 100)),
 notes text NOT NULL DEFAULT '',
 outcome text NOT NULL DEFAULT 'scheduled' CHECK(outcome IN ('scheduled','passed','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_interviews_tenant ON candidate_interviews(tenant_id,candidate_id,interview_at);
ALTER TABLE candidate_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_interviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_interviews_scope ON candidate_interviews;
CREATE POLICY candidate_interviews_scope ON candidate_interviews
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
