-- A correction event must reference its correction record
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_isCorrection_correctionId_check" CHECK (NOT "isCorrection" OR "correctionId" IS NOT NULL);

ALTER TABLE "movement_corrections" ADD CONSTRAINT "movement_corrections_oldState_newState_check" CHECK ("oldState" <> "newState");

ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_endTime_startTime_check" CHECK ("endTime" IS NULL OR "endTime" >= "startTime");

-- SET NULL on correctionId would violate the isCorrection check above
ALTER TABLE "movement_events" DROP CONSTRAINT "movement_events_correctionId_fkey";
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "movement_corrections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
