-- Actor references must not be nulled out: SET NULL would erase who performed an action
ALTER TABLE "face_profiles" DROP CONSTRAINT "face_profiles_enrolledByUserId_fkey";
ALTER TABLE "face_profiles" ADD CONSTRAINT "face_profiles_enrolledByUserId_fkey" FOREIGN KEY ("enrolledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "movement_events" DROP CONSTRAINT "movement_events_confirmedByUserId_fkey";
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_presences" DROP CONSTRAINT "resident_presences_lastUpdatedByUserId_fkey";
ALTER TABLE "resident_presences" ADD CONSTRAINT "resident_presences_lastUpdatedByUserId_fkey" FOREIGN KEY ("lastUpdatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_startedByUserId_fkey";
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_closedByUserId_fkey";
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_markedByUserId_fkey";
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_correctedByUserId_fkey";
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_performedByUserId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only audit trail. Row-level triggers do not fire on TRUNCATE.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
