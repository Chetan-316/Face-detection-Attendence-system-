-- Read-only preflight for 20260930071435. Raises if movement_events already has duplicate non-null recognitionReference
-- values (CREATE UNIQUE INDEX would fail), or if a non-unique index with the target name exists (IF NOT EXISTS would
-- silently skip the UNIQUE index). NULLs are excluded, since a UNIQUE index allows many NULLs.
-- Read-only: SELECT and DO blocks only. Resolve duplicates through a Warden-reviewed correction, never by silent cleanup.

DO $$
DECLARE
  problems text := '';
  dup_groups bigint;
BEGIN
  SELECT COUNT(*) INTO dup_groups
  FROM (
    SELECT "recognitionReference"
    FROM "movement_events"
    WHERE "recognitionReference" IS NOT NULL
    GROUP BY "recognitionReference"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF dup_groups > 0 THEN
    problems := problems || format(E'\n - movement_events has %s duplicate non-null recognitionReference value(s)', dup_groups);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'movement_events_recognitionReference_key' AND NOT i.indisunique
  ) THEN
    problems := problems || E'\n - a non-unique index named movement_events_recognitionReference_key already exists (IF NOT EXISTS would skip the UNIQUE index)';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'preflight 20260930071435 failed:%', problems;
  END IF;
END;
$$;
