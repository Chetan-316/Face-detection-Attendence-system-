-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('GATE', 'ENTRANCE', 'ATTENDANCE_POINT', 'COMMON_AREA');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'WARDEN', 'GUARD');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ResidentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FaceEnrollmentStatus" AS ENUM ('NOT_ENROLLED', 'ENROLLED', 'NEEDS_REENROLLMENT', 'REVOKED');

-- CreateEnum
CREATE TYPE "CameraSourceType" AS ENUM ('WEBCAM', 'RTSP', 'SMART_CAMERA');

-- CreateEnum
CREATE TYPE "CameraRole" AS ENUM ('GENERAL', 'IN', 'OUT', 'ATTENDANCE');

-- CreateEnum
CREATE TYPE "CameraHealthStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MovementSource" AS ENUM ('FACE_RECOGNITION', 'GUARD_CONFIRMATION', 'WARDEN_CORRECTION', 'MANUAL', 'SYSTEM', 'SMART_CAMERA');

-- CreateEnum
CREATE TYPE "PresenceState" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AttendanceSessionType" AS ENUM ('GENERAL', 'NIGHT');

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceRecordStatus" AS ENUM ('PRESENT', 'NOT_IN_HOSTEL', 'NOT_RECORDED', 'CORRECTED_PRESENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AttendanceMarkMethod" AS ENUM ('FACE_RECOGNITION', 'MANUAL_STAFF', 'WARDEN_OVERRIDE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE', 'NORMAL_MOVEMENT', 'CORRECTION', 'SESSION_START', 'SESSION_CLOSE', 'ATTENDANCE_MARK', 'ATTENDANCE_OVERRIDE', 'PERMISSION_CHANGE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostels" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationType" "LocationType" NOT NULL DEFAULT 'GATE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostelId" TEXT,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "residents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "residentCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "roomGroup" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "status" "ResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "faceEnrollmentStatus" "FaceEnrollmentStatus" NOT NULL DEFAULT 'NOT_ENROLLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "residents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_profiles" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "enrollmentStatus" "FaceEnrollmentStatus" NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "templateReference" TEXT NOT NULL,
    "metadata" JSONB,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "enrolledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "face_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cameras" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "sourceType" "CameraSourceType" NOT NULL,
    "role" "CameraRole" NOT NULL DEFAULT 'GENERAL',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "healthStatus" "CameraHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "configMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movement_events" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "locationId" TEXT,
    "cameraId" TEXT,
    "movementType" "MovementType" NOT NULL,
    "source" "MovementSource" NOT NULL,
    "effectiveTimestamp" TIMESTAMP(3) NOT NULL,
    "recordedTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedByUserId" TEXT,
    "notes" TEXT,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "correctionId" TEXT,
    "recognitionReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movement_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resident_presences" (
    "residentId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "currentState" "PresenceState" NOT NULL,
    "lastMovementEventId" TEXT,
    "lastMovementType" "MovementType",
    "lastMovementTime" TIMESTAMP(3),
    "lastUpdatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resident_presences_pkey" PRIMARY KEY ("residentId")
);

-- CreateTable
CREATE TABLE "movement_corrections" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "oldState" "PresenceState" NOT NULL,
    "newState" "PresenceState" NOT NULL,
    "effectiveTimestamp" TIMESTAMP(3) NOT NULL,
    "authorizedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movement_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "locationId" TEXT,
    "sessionType" "AttendanceSessionType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "startedByUserId" TEXT,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "attendanceSessionId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "status" "AttendanceRecordStatus" NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "markMethod" "AttendanceMarkMethod" NOT NULL,
    "markedByUserId" TEXT,
    "recognitionReference" TEXT,
    "notes" TEXT,
    "correctionReason" TEXT,
    "correctedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostelId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "performedByUserId" TEXT,
    "performedByRole" "StaffRole",
    "reason" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "hostels_organizationId_isActive_idx" ON "hostels"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "hostels_organizationId_code_key" ON "hostels"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_hostelId_code_key" ON "locations"("hostelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "residents_hostelId_status_idx" ON "residents"("hostelId", "status");

-- CreateIndex
CREATE INDEX "residents_residentCode_idx" ON "residents"("residentCode");

-- CreateIndex
CREATE UNIQUE INDEX "residents_organizationId_residentCode_key" ON "residents"("organizationId", "residentCode");

-- CreateIndex
CREATE INDEX "face_profiles_residentId_enrollmentStatus_idx" ON "face_profiles"("residentId", "enrollmentStatus");

-- CreateIndex
CREATE INDEX "cameras_hostelId_isEnabled_idx" ON "cameras"("hostelId", "isEnabled");

-- CreateIndex
CREATE INDEX "cameras_role_idx" ON "cameras"("role");

-- CreateIndex
CREATE INDEX "movement_events_residentId_effectiveTimestamp_idx" ON "movement_events"("residentId", "effectiveTimestamp" DESC);

-- CreateIndex
CREATE INDEX "movement_events_hostelId_effectiveTimestamp_idx" ON "movement_events"("hostelId", "effectiveTimestamp" DESC);

-- CreateIndex
CREATE INDEX "movement_events_movementType_effectiveTimestamp_idx" ON "movement_events"("movementType", "effectiveTimestamp" DESC);

-- CreateIndex
CREATE INDEX "movement_events_effectiveTimestamp_idx" ON "movement_events"("effectiveTimestamp" DESC);

-- CreateIndex
CREATE INDEX "resident_presences_hostelId_currentState_idx" ON "resident_presences"("hostelId", "currentState");

-- CreateIndex
CREATE INDEX "resident_presences_currentState_idx" ON "resident_presences"("currentState");

-- CreateIndex
CREATE INDEX "movement_corrections_residentId_createdAt_idx" ON "movement_corrections"("residentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "movement_corrections_hostelId_createdAt_idx" ON "movement_corrections"("hostelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "attendance_sessions_hostelId_sessionType_status_idx" ON "attendance_sessions"("hostelId", "sessionType", "status");

-- CreateIndex
CREATE INDEX "attendance_sessions_startTime_idx" ON "attendance_sessions"("startTime" DESC);

-- CreateIndex
CREATE INDEX "attendance_records_residentId_status_idx" ON "attendance_records"("residentId", "status");

-- CreateIndex
CREATE INDEX "attendance_records_status_idx" ON "attendance_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_attendanceSessionId_residentId_key" ON "attendance_records"("attendanceSessionId", "residentId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_performedByUserId_timestamp_idx" ON "audit_logs"("performedByUserId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);

-- AddForeignKey
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_profiles" ADD CONSTRAINT "face_profiles_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_profiles" ADD CONSTRAINT "face_profiles_enrolledByUserId_fkey" FOREIGN KEY ("enrolledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "movement_corrections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_presences" ADD CONSTRAINT "resident_presences_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_presences" ADD CONSTRAINT "resident_presences_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_presences" ADD CONSTRAINT "resident_presences_lastMovementEventId_fkey" FOREIGN KEY ("lastMovementEventId") REFERENCES "movement_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_presences" ADD CONSTRAINT "resident_presences_lastUpdatedByUserId_fkey" FOREIGN KEY ("lastUpdatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_corrections" ADD CONSTRAINT "movement_corrections_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_corrections" ADD CONSTRAINT "movement_corrections_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_corrections" ADD CONSTRAINT "movement_corrections_authorizedByUserId_fkey" FOREIGN KEY ("authorizedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_attendanceSessionId_fkey" FOREIGN KEY ("attendanceSessionId") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "residents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "hostels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
