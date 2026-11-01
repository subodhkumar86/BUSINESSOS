-- New statutory settings default to INR. Historical tenant currencies and
-- recorded monetary amounts are preserved; this does not perform FX conversion.
ALTER TABLE tenant_statutory_settings ALTER COLUMN currency SET DEFAULT 'INR';
