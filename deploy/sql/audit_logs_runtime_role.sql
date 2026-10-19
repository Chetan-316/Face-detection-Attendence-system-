-- audit_logs runtime-role hardening for the PRAVAHAx application database.
--
-- Run as the migration/owner role, never as the application runtime role:
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_role=<RUNTIME_ROLE> -f deploy/sql/audit_logs_runtime_role.sql
--
-- <RUNTIME_ROLE> is supplied at run time. No credentials or real role names belong in this file.
-- Preconditions (checked by the verification query below):
--   * the runtime role exists and is NOT a superuser, NOT BYPASSRLS, NOT CREATEROLE/CREATEDB;
--   * the runtime role does NOT own public.audit_logs and is NOT a member of the owner role.
-- Defense in depth: migration 20261019100000_audit_logs_truncate_guard also blocks TRUNCATE for every role.

BEGIN;

REVOKE ALL ON TABLE public."audit_logs" FROM PUBLIC;
REVOKE ALL ON TABLE public."audit_logs" FROM :"app_role";
REVOKE TRUNCATE ON TABLE public."audit_logs" FROM :"app_role";
GRANT SELECT, INSERT ON TABLE public."audit_logs" TO :"app_role";

COMMIT;

-- Verification (read-only). Expected values are noted per column; any mismatch means the role is not hardened.
SELECT
  has_table_privilege(:'app_role', 'public."audit_logs"', 'SELECT')   AS can_select,            -- expect t
  has_table_privilege(:'app_role', 'public."audit_logs"', 'INSERT')   AS can_insert,            -- expect t
  has_table_privilege(:'app_role', 'public."audit_logs"', 'UPDATE')   AS can_update,            -- expect f
  has_table_privilege(:'app_role', 'public."audit_logs"', 'DELETE')   AS can_delete,            -- expect f
  has_table_privilege(:'app_role', 'public."audit_logs"', 'TRUNCATE') AS can_truncate,          -- expect f
  (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') = :'app_role'
    AS owns_audit_logs,                                                                          -- expect f
  pg_has_role(:'app_role', (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs'), 'MEMBER')
    AS member_of_owner,                                                                          -- expect f
  (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = :'app_role')
    AS broad_privileges;                                                                         -- expect f
