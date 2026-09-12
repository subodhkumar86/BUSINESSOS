CREATE TABLE support_feedback (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 ticket_id uuid NOT NULL REFERENCES support_tickets(id),
 csat smallint NOT NULL CHECK(csat BETWEEN 1 AND 5),
 nps smallint NOT NULL CHECK(nps BETWEEN 0 AND 10),
 comment text NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,ticket_id)
);
ALTER TABLE support_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY support_feedback_scope ON support_feedback USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
