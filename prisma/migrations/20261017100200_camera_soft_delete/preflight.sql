-- Read-only preflight for 20261017100200. Raises if cameras.deletedAt already exists, if movement_events_cameraId_fkey is missing
-- (DROP would fail), or if movement_events has cameraId values matching no cameras row (re-added FK would fail validation).
-- Behaviour change, not checked here: ON DELETE RESTRICT makes hard-deleting a camera referenced by movement_events fail.
-- Read-only: SELECT and DO blocks only. Resolve orphans through a Warden-reviewed correction, never by silent cleanup.

DO $$
DECLARE
  problems text := '';
  orphans bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'cameras'
      AND column_name = 'deletedAt'
  ) THEN
    problems := problems || E'\n - cameras.deletedAt already exists (ADD COLUMN would fail)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname = 'movement_events' AND c.conname = 'movement_events_cameraId_fkey'
  ) THEN
    problems := problems || E'\n - constraint movement_events_cameraId_fkey is missing (DROP CONSTRAINT would fail)';
  END IF;

  SELECT COUNT(*) INTO orphans
  FROM "movement_events" m
  WHERE m."cameraId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "cameras" c WHERE c."id" = m."cameraId");

  IF orphans > 0 THEN
    problems := problems || format(E'\n - movement_events has %s row(s) with a cameraId matching no cameras row (ADD CONSTRAINT would fail)', orphans);
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'preflight 20261017100200 failed:%', problems;
  END IF;
END;
$$;
