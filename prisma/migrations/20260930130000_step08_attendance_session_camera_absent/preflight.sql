-- Read-only preflight for 20260930130000. Raises if step08 objects already exist (ADD VALUE, ADD COLUMN, ADD CONSTRAINT and
-- CREATE INDEX have no IF NOT EXISTS), if cameras is missing, or if attendance_sessions already has rows: the attendanceDate
-- backfill uses CURRENT_TIMESTAMP (migration run time), not each session's startTime, so existing rows would be silently wrong.
-- Read-only: SELECT and DO blocks only. Resolve existing rows with a Warden-reviewed backfill, never by silent cleanup.

DO $$
DECLARE
  problems text := '';
  session_rows bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AttendanceRecordStatus' AND e.enumlabel = 'ABSENT'
  ) THEN
    problems := problems || E'\n - enum AttendanceRecordStatus already has label ABSENT (ALTER TYPE ADD VALUE would fail)';
  END IF;

  IF to_regclass('"cameras"') IS NULL THEN
    problems := problems || E'\n - table cameras is missing (FK target for attendance_sessions.cameraId)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'attendance_sessions'
      AND column_name IN ('cameraId', 'attendanceDate')
  ) THEN
    problems := problems || E'\n - attendance_sessions already has cameraId and/or attendanceDate (ADD COLUMN would fail)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname = 'attendance_sessions' AND c.conname = 'attendance_sessions_cameraId_fkey'
  ) THEN
    problems := problems || E'\n - constraint attendance_sessions_cameraId_fkey already exists (ADD CONSTRAINT would fail)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = 'attendance_sessions_attendanceDate_idx'
  ) THEN
    problems := problems || E'\n - index attendance_sessions_attendanceDate_idx already exists (CREATE INDEX would fail)';
  END IF;

  SELECT COUNT(*) INTO session_rows FROM "attendance_sessions";

  IF session_rows > 0 THEN
    problems := problems || format(E'\n - attendance_sessions has %s existing row(s); the attendanceDate backfill would set them to migration run time, not their startTime date', session_rows);
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'preflight 20260930130000 failed:%', problems;
  END IF;
END;
$$;
