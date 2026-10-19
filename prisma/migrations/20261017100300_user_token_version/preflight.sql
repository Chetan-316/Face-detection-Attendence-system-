-- Read-only preflight for 20261017100300. Raises if users is missing or users.tokenVersion already exists (ADD COLUMN has no IF NOT EXISTS).
-- Existing rows are safe: NOT NULL DEFAULT 0 fills them.
-- Read-only: SELECT and DO blocks only.

DO $$
BEGIN
  IF to_regclass('"users"') IS NULL THEN
    RAISE EXCEPTION 'preflight 20261017100300 failed: table users is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
      AND column_name = 'tokenVersion'
  ) THEN
    RAISE EXCEPTION 'preflight 20261017100300 failed: users.tokenVersion already exists (ADD COLUMN would fail)';
  END IF;
END;
$$;
