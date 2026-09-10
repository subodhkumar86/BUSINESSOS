-- Extend the audited workflow store with formal employee performance reviews.
ALTER TABLE workflow_records DROP CONSTRAINT workflow_records_kind_check;
ALTER TABLE workflow_records ADD CONSTRAINT workflow_records_kind_check
  CHECK(kind IN ('leave','goals','reviews','appointments','certifications','findings','knowledge'));
