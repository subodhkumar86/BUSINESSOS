CREATE TABLE forecast_runs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 metric text NOT NULL CHECK(metric IN ('cash','pipeline','inventory')),
 horizon_days integer NOT NULL CHECK(horizon_days BETWEEN 1 AND 365),
 baseline numeric(20,2) NOT NULL,
 forecast_value numeric(20,2) NOT NULL,
 assumptions jsonb NOT NULL,
 confidence text NOT NULL,
 data_window text NOT NULL,
 model_version text NOT NULL DEFAULT 'deterministic-rules-v2',
 features jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forecast_runs_tenant ON forecast_runs(tenant_id,metric,created_at DESC);
ALTER TABLE forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY forecast_runs_scope ON forecast_runs
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TABLE message_outbox (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 channel text NOT NULL CHECK(channel IN ('email','sms','whatsapp','push','bank_poll')),
 recipient text NOT NULL CHECK(length(recipient) BETWEEN 1 AND 320),
 subject text NOT NULL DEFAULT '',
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 8000),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 provider text NOT NULL DEFAULT 'local-adapter',
 last_error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_outbox_tenant ON message_outbox(tenant_id,status,created_at);
ALTER TABLE message_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY message_outbox_scope ON message_outbox
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
