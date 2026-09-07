CREATE TABLE IF NOT EXISTS assets(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  serial_number text NOT NULL CHECK(length(serial_number) BETWEEN 1 AND 100),
  category text NOT NULL CHECK(length(category) BETWEEN 1 AND 100),
  cost numeric(20,2) NOT NULL CHECK(cost >= 0),
  depreciation_rate numeric(5,2) NOT NULL DEFAULT 20.00,
  location text NOT NULL DEFAULT 'Main Office',
  status text NOT NULL DEFAULT 'operational' CHECK(status IN ('operational','maintenance','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_tenant ON assets(tenant_id,status,created_at DESC);
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
CREATE POLICY assets_scope ON assets
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE IF NOT EXISTS facilities_work_orders(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  facility_name text NOT NULL CHECK(length(facility_name) BETWEEN 1 AND 200),
  equipment text NOT NULL CHECK(length(equipment) BETWEEN 1 AND 200),
  condition text NOT NULL CHECK(condition IN ('good','fair','needs_service','critical')),
  priority text NOT NULL CHECK(priority IN ('low','medium','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('none','open','in_progress','completed')),
  description text NOT NULL DEFAULT '',
  scheduled_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_tenant ON facilities_work_orders(tenant_id,status,created_at DESC);
ALTER TABLE facilities_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities_work_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY facilities_scope ON facilities_work_orders
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE IF NOT EXISTS production_batches(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_number text NOT NULL CHECK(length(batch_number) BETWEEN 1 AND 60),
  product_name text NOT NULL CHECK(length(product_name) BETWEEN 1 AND 200),
  planned_qty integer NOT NULL CHECK(planned_qty > 0),
  completed_qty integer NOT NULL DEFAULT 0 CHECK(completed_qty >= 0),
  defect_count integer NOT NULL DEFAULT 0 CHECK(defect_count >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','running','qa_check','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,batch_number)
);
CREATE INDEX IF NOT EXISTS production_tenant ON production_batches(tenant_id,status,created_at DESC);
ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY production_scope ON production_batches
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE IF NOT EXISTS front_office_visitors(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  visitor_name text NOT NULL CHECK(length(visitor_name) BETWEEN 1 AND 200),
  host_person text NOT NULL CHECK(length(host_person) BETWEEN 1 AND 200),
  company text NOT NULL DEFAULT '',
  purpose text NOT NULL CHECK(length(purpose) BETWEEN 1 AND 300),
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','checked_in','completed','cancelled')),
  check_in_time timestamptz,
  check_out_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visitors_tenant ON front_office_visitors(tenant_id,status,created_at DESC);
ALTER TABLE front_office_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE front_office_visitors FORCE ROW LEVEL SECURITY;
CREATE POLICY visitors_scope ON front_office_visitors
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE IF NOT EXISTS marketing_campaigns(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  channel text NOT NULL CHECK(channel IN ('social','email','search','event','referral')),
  budget numeric(20,2) NOT NULL DEFAULT 0 CHECK(budget >= 0),
  spend numeric(20,2) NOT NULL DEFAULT 0 CHECK(spend >= 0),
  leads_count integer NOT NULL DEFAULT 0 CHECK(leads_count >= 0),
  revenue_generated numeric(20,2) NOT NULL DEFAULT 0 CHECK(revenue_generated >= 0),
  status text NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','completed','paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_tenant ON marketing_campaigns(tenant_id,status,created_at DESC);
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY campaigns_scope ON marketing_campaigns
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE IF NOT EXISTS compliance_risks(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 250),
  category text NOT NULL CHECK(category IN ('financial','operational','regulatory','security','vendor')),
  severity text NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'identified' CHECK(status IN ('identified','mitigating','controlled','accepted')),
  mitigation_plan text NOT NULL DEFAULT '',
  review_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS risks_tenant ON compliance_risks(tenant_id,status,severity,created_at DESC);
ALTER TABLE compliance_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_risks FORCE ROW LEVEL SECURITY;
CREATE POLICY risks_scope ON compliance_risks
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE IF NOT EXISTS stock_transfers(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_location_id uuid REFERENCES warehouse_locations(id),
  destination_location_id uuid REFERENCES warehouse_locations(id),
  product_id text NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK(quantity > 0),
  status text NOT NULL DEFAULT 'completed' CHECK(status IN ('draft','in_transit','completed')),
  transferred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transfers_tenant ON stock_transfers(tenant_id,created_at DESC);
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY transfers_scope ON stock_transfers
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
