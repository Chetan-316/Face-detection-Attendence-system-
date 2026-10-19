-- Read-only preflight for 20261017100100. Informational: this migration changes foreign key delete rules and adds the
-- audit_logs append-only trigger. It rewrites no data.
-- Any future deletion of a user referenced by these columns will now fail (RESTRICT) instead of nulling the actor.
-- Deactivate users (status = INACTIVE) rather than deleting them.

SELECT 'face_profiles.enrolledByUserId' AS reference, COUNT(*) AS rows_referencing_users
FROM "face_profiles" WHERE "enrolledByUserId" IS NOT NULL
UNION ALL
SELECT 'movement_events.confirmedByUserId', COUNT(*) FROM "movement_events" WHERE "confirmedByUserId" IS NOT NULL
UNION ALL
SELECT 'resident_presences.lastUpdatedByUserId', COUNT(*) FROM "resident_presences" WHERE "lastUpdatedByUserId" IS NOT NULL
UNION ALL
SELECT 'attendance_sessions.startedByUserId', COUNT(*) FROM "attendance_sessions" WHERE "startedByUserId" IS NOT NULL
UNION ALL
SELECT 'attendance_sessions.closedByUserId', COUNT(*) FROM "attendance_sessions" WHERE "closedByUserId" IS NOT NULL
UNION ALL
SELECT 'attendance_records.markedByUserId', COUNT(*) FROM "attendance_records" WHERE "markedByUserId" IS NOT NULL
UNION ALL
SELECT 'attendance_records.correctedByUserId', COUNT(*) FROM "attendance_records" WHERE "correctedByUserId" IS NOT NULL
UNION ALL
SELECT 'audit_logs.performedByUserId', COUNT(*) FROM "audit_logs" WHERE "performedByUserId" IS NOT NULL;

-- Confirm no trigger named audit_logs_append_only exists yet (expect zero rows before applying).
SELECT tgname FROM pg_trigger WHERE tgname = 'audit_logs_append_only' AND NOT tgisinternal;
