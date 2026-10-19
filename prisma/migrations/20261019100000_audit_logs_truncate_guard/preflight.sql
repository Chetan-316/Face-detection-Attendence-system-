-- Read-only preflight for 20261019100000. Raises if audit_logs is missing, if trigger audit_logs_no_truncate already exists on audit_logs
-- (CREATE TRIGGER has no IF NOT EXISTS), or if a function audit_logs_no_truncate with a non-trigger return type exists (CREATE OR REPLACE would fail).
-- Read-only: SELECT and DO blocks only. Existing audit_logs rows are not read or changed.

DO $$
DECLARE
  problems text := '';
BEGIN
  IF to_regclass('"audit_logs"') IS NULL THEN
    problems := problems || E'\n - table audit_logs is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    WHERE r.relname = 'audit_logs'
      AND t.tgname = 'audit_logs_no_truncate'
      AND NOT t.tgisinternal
  ) THEN
    problems := problems || E'\n - trigger audit_logs_no_truncate already exists on audit_logs (CREATE TRIGGER would fail)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema()
      AND p.proname = 'audit_logs_no_truncate'
      AND p.prorettype <> 'trigger'::regtype
  ) THEN
    problems := problems || E'\n - function audit_logs_no_truncate exists with a non-trigger return type (CREATE OR REPLACE would fail)';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'preflight 20261019100000 failed:%', problems;
  END IF;
END;
$$;
