-- Read-only preflight for 20261017100700. Raises if attendance_sessions_cameraId_fkey is missing (created by 20260930130000; DROP would fail),
-- or if attendance_sessions has cameraId values matching no cameras row (re-added FK would fail validation).
-- Read-only: SELECT and DO blocks only. Resolve orphans through a Warden-reviewed correction, never by silent cleanup.

DO $$
DECLARE
  orphans bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname = 'attendance_sessions' AND c.conname = 'attendance_sessions_cameraId_fkey'
  ) THEN
    RAISE EXCEPTION 'preflight 20261017100700 failed: constraint attendance_sessions_cameraId_fkey is missing; apply 20260930130000 first';
  END IF;

  SELECT COUNT(*) INTO orphans
  FROM "attendance_sessions" s
  WHERE s."cameraId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "cameras" c WHERE c."id" = s."cameraId");

  IF orphans > 0 THEN
    RAISE EXCEPTION 'preflight 20261017100700 failed: attendance_sessions has % row(s) with a cameraId matching no cameras row (ADD CONSTRAINT would fail)', orphans;
  END IF;
END;
$$;
