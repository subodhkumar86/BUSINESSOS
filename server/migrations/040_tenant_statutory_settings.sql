CREATE TABLE tenant_statutory_settings(
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  country_code text NOT NULL DEFAULT 'NG' CHECK(country_code ~ '^[A-Z]{2}$'),
  jurisdiction text NOT NULL DEFAULT 'Nigeria' CHECK(length(jurisdiction) BETWEEN 1 AND 100),
  currency text NOT NULL DEFAULT 'NGN' CHECK(currency ~ '^[A-Z]{3}$'),
  financial_year_start_month integer NOT NULL DEFAULT 1 CHECK(financial_year_start_month BETWEEN 1 AND 12),
  vat_rate numeric(7,6) NOT NULL DEFAULT 0.075 CHECK(vat_rate BETWEEN 0 AND 1),
  withholding_rate numeric(7,6) NOT NULL DEFAULT 0.05 CHECK(withholding_rate BETWEEN 0 AND 1),
  income_tax_rate numeric(7,6) NOT NULL DEFAULT 0.30 CHECK(income_tax_rate BETWEEN 0 AND 1),
  payroll_employee_rate numeric(7,6) NOT NULL DEFAULT 0 CHECK(payroll_employee_rate BETWEEN 0 AND 1),
  payroll_employer_rate numeric(7,6) NOT NULL DEFAULT 0 CHECK(payroll_employer_rate BETWEEN 0 AND 1),
  invoice_prefix text NOT NULL DEFAULT 'INV' CHECK(invoice_prefix ~ '^[A-Z0-9-]{1,16}$'),
  tax_inclusive boolean NOT NULL DEFAULT false,
  compliance_notes text NOT NULL DEFAULT '' CHECK(length(compliance_notes) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_statutory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_statutory_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_statutory_settings_scope ON tenant_statutory_settings
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
