-- Read-only preflight for 20261017100500. Informational: no rows block this migration.
-- Each CREATE INDEX here is non-concurrent and takes a SHARE lock on its table for the duration of the build,
-- blocking writes (not reads). Run during a low-traffic window. Expect sub-second builds at pilot scale
-- (about 300 residents and 2 cameras); re-evaluate with CREATE INDEX CONCURRENTLY if the largest table grows materially.

SELECT relname AS table_name, n_live_tup AS approximate_rows
FROM pg_stat_user_tables
WHERE relname IN (
  'face_profiles', 'movement_events', 'resident_presences', 'movement_corrections',
  'attendance_sessions', 'attendance_records', 'audit_logs'
)
ORDER BY n_live_tup DESC;
