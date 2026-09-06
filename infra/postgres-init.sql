CREATE ROLE businessos_app LOGIN PASSWORD 'businessos_dev_only' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE businessos TO businessos_app;
GRANT USAGE, CREATE ON SCHEMA public TO businessos_app;
