-- Read-only preflight for 20261017100800. Expect zero rows before applying the migration.
-- Do not delete rows from this query's output without a documented Warden review.
SELECT
  "recognitionReference",
  COUNT(*) AS rows_sharing_reference,
  array_agg("id" ORDER BY "createdAt") AS attendance_record_ids
FROM "attendance_records"
WHERE "recognitionReference" IS NOT NULL
GROUP BY "recognitionReference"
HAVING COUNT(*) > 1
ORDER BY rows_sharing_reference DESC;
