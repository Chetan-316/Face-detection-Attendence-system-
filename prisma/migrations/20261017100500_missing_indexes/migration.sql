-- CreateIndex
CREATE INDEX "face_profiles_enrolledByUserId_idx" ON "face_profiles"("enrolledByUserId");

CREATE INDEX "movement_events_locationId_idx" ON "movement_events"("locationId");
CREATE INDEX "movement_events_confirmedByUserId_idx" ON "movement_events"("confirmedByUserId");
CREATE INDEX "movement_events_correctionId_idx" ON "movement_events"("correctionId");
CREATE INDEX "movement_events_cameraId_effectiveTimestamp_idx" ON "movement_events"("cameraId", "effectiveTimestamp" DESC);

CREATE INDEX "resident_presences_lastMovementEventId_idx" ON "resident_presences"("lastMovementEventId");
CREATE INDEX "resident_presences_lastUpdatedByUserId_idx" ON "resident_presences"("lastUpdatedByUserId");

CREATE INDEX "movement_corrections_authorizedByUserId_idx" ON "movement_corrections"("authorizedByUserId");

CREATE INDEX "attendance_sessions_organizationId_idx" ON "attendance_sessions"("organizationId");
CREATE INDEX "attendance_sessions_hostelId_attendanceDate_idx" ON "attendance_sessions"("hostelId", "attendanceDate");
CREATE INDEX "attendance_sessions_locationId_idx" ON "attendance_sessions"("locationId");
CREATE INDEX "attendance_sessions_cameraId_idx" ON "attendance_sessions"("cameraId");
CREATE INDEX "attendance_sessions_createdByUserId_idx" ON "attendance_sessions"("createdByUserId");
CREATE INDEX "attendance_sessions_startedByUserId_idx" ON "attendance_sessions"("startedByUserId");
CREATE INDEX "attendance_sessions_closedByUserId_idx" ON "attendance_sessions"("closedByUserId");

CREATE INDEX "attendance_records_markedByUserId_idx" ON "attendance_records"("markedByUserId");
CREATE INDEX "attendance_records_correctedByUserId_idx" ON "attendance_records"("correctedByUserId");

CREATE INDEX "audit_logs_organizationId_idx" ON "audit_logs"("organizationId");
CREATE INDEX "audit_logs_hostelId_idx" ON "audit_logs"("hostelId");
CREATE INDEX "audit_logs_entityType_entityId_timestamp_idx" ON "audit_logs"("entityType", "entityId", "timestamp" DESC);
