CREATE TABLE campaign_deliveries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  outbox_id uuid NOT NULL REFERENCES message_outbox(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, campaign_id, customer_id)
);
CREATE INDEX campaign_deliveries_scope ON campaign_deliveries(tenant_id,campaign_id,created_at DESC);
ALTER TABLE campaign_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_deliveries_scope ON campaign_deliveries
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
