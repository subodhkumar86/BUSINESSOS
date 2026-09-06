ALTER TABLE module_records DROP CONSTRAINT IF EXISTS module_records_module_check;
ALTER TABLE module_records ADD CONSTRAINT module_records_module_check CHECK(module IN (
  'billing','documents','automation','warehouse','support','tax','supply',
  'compliance','workspace','admin','assets','facilities','production',
  'frontoffice','communication','banking'
));
