-- Align cameraId FK with the other FKs: a camera id change cascades, a camera delete nulls the binding
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_cameraId_fkey";
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
