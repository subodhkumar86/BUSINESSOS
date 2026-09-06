ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('owner','super_admin','finance_admin','hr_admin','operations_manager','sales_crm_user','department_manager','employee','auditor'));
