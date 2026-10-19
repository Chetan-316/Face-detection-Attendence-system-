-- Fails the bootstrap session if the runtime role is not hardened. Runs after the audit_logs script.
\set ON_ERROR_STOP on
SELECT set_config('pravahax.app_role', :'app_role', false);

DO $$
DECLARE
  r text := current_setting('pravahax.app_role');
  audit_owner text;
BEGIN
  SELECT tableowner INTO audit_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs';
  IF audit_owner IS NULL THEN
    RAISE EXCEPTION 'public.audit_logs does not exist; run migrations first';
  END IF;
  IF audit_owner = r THEN
    RAISE EXCEPTION 'runtime role % owns audit_logs', r;
  END IF;
  IF NOT has_table_privilege(r, 'public.audit_logs', 'INSERT') OR NOT has_table_privilege(r, 'public.audit_logs', 'SELECT') THEN
    RAISE EXCEPTION 'runtime role % lacks SELECT/INSERT on audit_logs', r;
  END IF;
  IF has_table_privilege(r, 'public.audit_logs', 'UPDATE')
     OR has_table_privilege(r, 'public.audit_logs', 'DELETE')
     OR has_table_privilege(r, 'public.audit_logs', 'TRUNCATE') THEN
    RAISE EXCEPTION 'runtime role % can mutate audit_logs', r;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE grantee = r AND table_schema = 'public' AND privilege_type = 'TRUNCATE'
  ) THEN
    RAISE EXCEPTION 'runtime role % has TRUNCATE on a public table', r;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = r AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
  ) THEN
    RAISE EXCEPTION 'runtime role % has broad attributes', r;
  END IF;
  RAISE NOTICE 'runtime role % verified', r;
END
$$;
