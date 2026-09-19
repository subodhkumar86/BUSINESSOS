-- The platform has one global Super Admin. The account retains a home tenant
-- for immutable audit records, but its platform-admin permissions are global.
DO $$
BEGIN
  IF (SELECT count(*) FROM users WHERE role = 'super_admin') > 1 THEN
    RAISE EXCEPTION 'Only one platform super_admin account is permitted.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_one_platform_super_admin
  ON users(role)
  WHERE role = 'super_admin';
