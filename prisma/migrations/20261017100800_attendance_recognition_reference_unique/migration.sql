-- M20: one recognition observation yields at most one attendance record.
-- Fails loudly (no silent cleanup) if duplicates exist. Run preflight.sql first and resolve by a Warden-reviewed correction.
DO $$
DECLARE
  duplicated_values integer;
BEGIN
  SELECT COUNT(*) INTO duplicated_values
  FROM (
    SELECT "recognitionReference"
    FROM "attendance_records"
    WHERE "recognitionReference" IS NOT NULL
    GROUP BY "recognitionReference"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF duplicated_values > 0 THEN
    RAISE EXCEPTION 'attendance_records.recognitionReference has % duplicated value(s); see preflight.sql', duplicated_values;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_recognitionReference_key" ON "attendance_records"("recognitionReference");
