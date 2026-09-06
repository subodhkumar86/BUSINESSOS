CREATE ROLE businessos_app LOGIN PASSWORD 'test_app_only' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE businessos_test TO businessos_app;
GRANT USAGE, CREATE ON SCHEMA public TO businessos_app;
