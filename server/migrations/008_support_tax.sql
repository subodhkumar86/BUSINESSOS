CREATE TABLE support_tickets(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ticket_number text NOT NULL,
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
  customer text NOT NULL CHECK(length(customer) BETWEEN 1 AND 200),
  priority text NOT NULL CHECK(priority IN ('low','medium','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','resolved','closed')),
  sla_due_at timestamptz,
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,ticket_number)
);
CREATE INDEX support_tickets_tenant_status ON support_tickets(tenant_id,status,updated_at DESC);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY support_tickets_scope ON support_tickets
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE tax_filings(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  territory text NOT NULL CHECK(length(territory) BETWEEN 1 AND 100),
  due_date date NOT NULL,
  amount numeric(20,2) NOT NULL DEFAULT 0 CHECK(amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','filed','paid','overdue')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tax_filings_tenant_due ON tax_filings(tenant_id,due_date,updated_at DESC);
ALTER TABLE tax_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_filings FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_filings_scope ON tax_filings
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
