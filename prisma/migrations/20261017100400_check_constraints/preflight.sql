-- Read-only preflight for 20261017100400. Each query must return zero rows before applying the migration.
-- A non-zero result blocks the migration; resolve the rows through a Warden-reviewed correction, never by silent cleanup.

-- movement_events_isCorrection_correctionId_check
SELECT "id", "residentId", "hostelId", "effectiveTimestamp"
FROM "movement_events"
WHERE "isCorrection" = true AND "correctionId" IS NULL;

-- movement_corrections_oldState_newState_check
SELECT "id", "residentId", "hostelId", "oldState", "newState", "effectiveTimestamp"
FROM "movement_corrections"
WHERE "oldState" = "newState";

-- attendance_sessions_endTime_startTime_check
SELECT "id", "hostelId", "startTime", "endTime"
FROM "attendance_sessions"
WHERE "endTime" IS NOT NULL AND "endTime" < "startTime";
