-- Creates or rotates the staging RUNTIME role and grants it application DML only.
-- Run as the owner role via deploy/staging/bootstrap-runtime-role.sh (psql variables: app_role, pw).
-- The runtime role never owns tables, never gets TRUNCATE, and is not superuser/BYPASSRLS/CREATEROLE/CREATEDB.
-- audit_logs is re-restricted afterwards by deploy/sql/audit_logs_runtime_role.sql (run in the same session).

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', :'app_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec

SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD %L', :'app_role', :'pw') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role') \gexec
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
REVOKE ALL ON TABLE public."_prisma_migrations" FROM :"app_role";
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
