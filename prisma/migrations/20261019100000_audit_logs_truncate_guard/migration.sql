-- Row-level triggers do not fire on TRUNCATE, so the append-only trigger alone leaves
-- audit_logs wipeable. This statement-level trigger rejects TRUNCATE. The test-only reset
-- helper disables it inside a single transaction and re-enables it before commit.
CREATE OR REPLACE FUNCTION audit_logs_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: TRUNCATE is not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_truncate
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_no_truncate();
