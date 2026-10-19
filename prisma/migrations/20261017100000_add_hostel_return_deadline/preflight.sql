-- Read-only preflight for 20261017100000. ADD COLUMN IF NOT EXISTS skips its NOT NULL and DEFAULT if the column already exists.
-- Raises if returnDeadlineMinutes already exists with NULL or out-of-range (0..1439) values, or if the range CHECK already exists.
-- Read-only: SELECT and DO blocks only. Resolve violating rows through a Warden-reviewed correction, never by silent cleanup.

DO $$
DECLARE
  problems text := '';
  bad_rows bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname = 'hostels' AND c.conname = 'hostels_returnDeadlineMinutes_range_check'
  ) THEN
    problems := problems || E'\n - constraint hostels_returnDeadlineMinutes_range_check already exists (ADD CONSTRAINT would fail)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'hostels'
      AND column_name = 'returnDeadlineMinutes'
  ) THEN
    SELECT COUNT(*) INTO bad_rows
    FROM "hostels"
    WHERE "returnDeadlineMinutes" IS NULL
       OR "returnDeadlineMinutes" NOT BETWEEN 0 AND 1439;

    IF bad_rows > 0 THEN
      problems := problems || format(E'\n - hostels.returnDeadlineMinutes already exists and %s row(s) are NULL or outside 0..1439', bad_rows);
    END IF;
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'preflight 20261017100000 failed:%', problems;
  END IF;
END;
$$;
