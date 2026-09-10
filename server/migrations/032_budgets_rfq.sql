-- Budget management
CREATE TABLE budgets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  department text NOT NULL DEFAULT '',
  period_from date NOT NULL,
  period_to date NOT NULL,
  total_amount numeric(18,2) NOT NULL CHECK(total_amount >= 0),
  spent_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK(spent_amount >= 0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','draft')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_period_valid CHECK(period_to >= period_from)
);
CREATE INDEX budgets_tenant ON budgets(tenant_id, period_from DESC);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY budgets_scope ON budgets
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

-- RFQ (Request for Quotation)
CREATE TABLE rfq_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rfq_number text NOT NULL,
  supplier_name text NOT NULL CHECK(length(supplier_name) BETWEEN 1 AND 200),
  product_description text NOT NULL CHECK(length(product_description) BETWEEN 1 AND 500),
  quantity integer NOT NULL CHECK(quantity > 0),
  required_by date,
  quoted_amount numeric(18,2),
  status text NOT NULL DEFAULT 'sent' CHECK(status IN ('draft','sent','quoted','accepted','rejected','expired')),
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rfq_number_tenant ON rfq_requests(tenant_id, rfq_number);
CREATE INDEX rfq_tenant ON rfq_requests(tenant_id, created_at DESC);
ALTER TABLE rfq_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY rfq_scope ON rfq_requests
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

-- Lead scoring history
CREATE TABLE lead_scores (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id text NOT NULL,
  score integer NOT NULL CHECK(score BETWEEN 0 AND 100),
  factors jsonb NOT NULL DEFAULT '{}',
  scored_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_scores_tenant ON lead_scores(tenant_id, lead_id, scored_at DESC);
ALTER TABLE lead_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_scores_scope ON lead_scores
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

-- Onboarding checklist state per tenant
CREATE TABLE onboarding_state (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  completed_steps jsonb NOT NULL DEFAULT '[]',
  dismissed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_state FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_scope ON onboarding_state
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
