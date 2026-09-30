-- Step 08 Migration: Attendance Session Camera Binding + ABSENT Status
-- Migration: step08_attendance_session_camera_absent

-- Add ABSENT to AttendanceRecordStatus enum
ALTER TYPE "AttendanceRecordStatus" ADD VALUE 'ABSENT';

-- Add cameraId to attendance_sessions (nullable, for camera binding)
ALTER TABLE "attendance_sessions" ADD COLUMN "cameraId" TEXT;

-- Add attendanceDate to attendance_sessions (logical date, midnight-safe)
-- Default existing rows to their startTime date (safe backfill)
ALTER TABLE "attendance_sessions" ADD COLUMN "attendanceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add foreign key from attendance_sessions.cameraId to cameras.id
ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_cameraId_fkey"
  FOREIGN KEY ("cameraId")
  REFERENCES "cameras"("id")
  ON DELETE SET NULL;

-- Index for attendanceDate lookups
CREATE INDEX "attendance_sessions_attendanceDate_idx" ON "attendance_sessions"("attendanceDate" DESC);
