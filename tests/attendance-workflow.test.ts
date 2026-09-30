import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { AttendanceDecisionService } from '../src/modules/attendance-decision/attendance-decision.service';
import { AttendanceRecognitionBridge } from '../src/modules/attendance-decision/attendance-bridge';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { MovementDecisionService } from '../src/modules/movement-decision/movement-decision.service';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';
import {
  CameraRole,
  CameraSourceType,
  MovementType,
  PresenceState,
  ResidentStatus,
  FaceEnrollmentStatus,
  StaffRole,
  AttendanceSessionType,
  AttendanceSessionStatus,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
  Prisma,
} from '@prisma/client';
import { RecognitionObservation } from '../src/modules/recognition/recognition.types';
import { RecognitionService } from '../src/modules/recognition/recognition.service';
import { CameraService } from '../src/modules/cameras/camera.service';
import { PythonWorkerClient } from '../src/modules/biometrics/python-worker-client';
import { TemplateCache } from '../src/modules/recognition/template-cache';
import { MovementRecognitionBridge } from '../src/modules/movement-decision/movement-bridge';

describe('Step 08: Hostel Night Attendance Workflow & Decision Engine Tests', () => {
  let attendanceDecisionService: AttendanceDecisionService;
  let attendanceBridge: AttendanceRecognitionBridge;
  let attendanceService: AttendanceService;
  let movementDecisionService: MovementDecisionService;
  let movementService: MovementService;
  let residentService: ResidentService;
  let app: any;

  let orgId: string;
  let hostelId: string;
  let foreignHostelId: string;
  let attendanceCameraId: string;
  let inCameraId: string;
  let outCameraId: string;
  let generalCameraId: string;

  let adminToken: string;
  let wardenToken: string;
  let foreignWardenToken: string;
  let guardToken: string;
  let wardenUserId: string;
  let guardUserId: string;

  beforeEach(async () => {
    await resetTestDatabase();

    attendanceDecisionService = new AttendanceDecisionService(testPrisma);
    attendanceBridge = new AttendanceRecognitionBridge(attendanceDecisionService);
    attendanceService = new AttendanceService(testPrisma);
    movementService = new MovementService(testPrisma);
    movementDecisionService = new MovementDecisionService(testPrisma, movementService, {
      globalAutomationEnabled: true,
      minTransitionIntervalMs: 5000,
    });
    residentService = new ResidentService(testPrisma);
    app = createApp(testPrisma, {
      attendanceDecisionService,
      attendanceBridge,
      attendanceService,
      movementDecisionService,
    });

    // 1. Create Organization & Hostels
    const org = await testPrisma.organization.create({
      data: { code: 'ORG_ATT_WORKFLOW', name: 'Attendance Workflow Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H_MAIN_ATT', name: 'Main Campus Hostel' },
    });
    hostelId = hostel.id;

    const foreignHostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H_FOREIGN_ATT', name: 'Foreign Hostel' },
    });
    foreignHostelId = foreignHostel.id;

    // 2. Create Cameras
    const attCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Attendance Gate Camera',
        role: CameraRole.ATTENDANCE,
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: true,
      },
    });
    attendanceCameraId = attCam.id;

    const inCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Gate IN Camera',
        role: CameraRole.IN,
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: true,
      },
    });
    inCameraId = inCam.id;

    const outCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Gate OUT Camera',
        role: CameraRole.OUT,
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: true,
      },
    });
    outCameraId = outCam.id;

    const genCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Corridor General Camera',
        role: CameraRole.GENERAL,
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: true,
      },
    });
    generalCameraId = genCam.id;

    // 3. Create Users & Tokens
    const adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        username: 'admin_att_test',
        fullName: 'Admin User',
        passwordHash: 'dummy',
        role: StaffRole.ADMIN,
      },
    });
    adminToken = tokenService.generateToken({
      sub: adminUser.id,
      role: adminUser.role,
      organizationId: adminUser.organizationId,
      hostelId: null,
    }).token;

    const wardenUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'warden_att_test',
        fullName: 'Main Hostel Warden',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    wardenUserId = wardenUser.id;
    wardenToken = tokenService.generateToken({
      sub: wardenUser.id,
      role: wardenUser.role,
      organizationId: wardenUser.organizationId,
      hostelId: wardenUser.hostelId,
    }).token;

    const foreignWarden = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: foreignHostel.id,
        username: 'foreign_warden_test',
        fullName: 'Foreign Hostel Warden',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    foreignWardenToken = tokenService.generateToken({
      sub: foreignWarden.id,
      role: foreignWarden.role,
      organizationId: foreignWarden.organizationId,
      hostelId: foreignWarden.hostelId,
    }).token;

    const guardUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'guard_att_test',
        fullName: 'Gate Guard',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardUserId = guardUser.id;
    guardToken = tokenService.generateToken({
      sub: guardUser.id,
      role: guardUser.role,
      organizationId: guardUser.organizationId,
      hostelId: guardUser.hostelId,
    }).token;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  // Helpers
  async function createTestResident(
    code: string,
    hId: string = hostelId,
    status: ResidentStatus = ResidentStatus.ACTIVE,
    enrollmentStatus: FaceEnrollmentStatus = FaceEnrollmentStatus.ENROLLED
  ) {
    const resident = await testPrisma.resident.create({
      data: {
        organizationId: orgId,
        hostelId: hId,
        residentCode: code,
        fullName: `Resident ${code}`,
        roomGroup: 'Room 101',
        status,
        faceEnrollmentStatus: enrollmentStatus,
      },
    });

    await testPrisma.residentPresence.create({
      data: {
        residentId: resident.id,
        hostelId: hId,
        currentState: PresenceState.IN,
      },
    });

    return resident;
  }

  function createObservation(
    cameraId: string,
    resident?: any,
    classification: 'MATCH' | 'UNKNOWN' | 'UNCERTAIN' | 'QUALITY_INSUFFICIENT' = 'MATCH',
    observationId?: string
  ): RecognitionObservation {
    const id = observationId || `obs_att_${Date.now()}_${Math.random()}`;
    return {
      id,
      faceId: `face_${Date.now()}`,
      cameraId,
      classification,
      resident:
        resident && classification === 'MATCH'
          ? {
              id: resident.id,
              residentCode: resident.residentCode,
              fullName: resident.fullName,
            }
          : null,
      residentId: resident?.id,
      observationId: id,
      similarity: classification === 'MATCH' ? 0.88 : undefined,
      bbox: { x: 100, y: 100, width: 200, height: 200 },
      qualityUsable: classification !== 'QUALITY_INSUFFICIENT',
      detectedAt: new Date().toISOString(),
      isStable: true,
    };
  }

  async function createActiveSession(hId: string = hostelId, cId?: string) {
    const session = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgId,
        hostelId: hId,
        cameraId: cId || null,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Night Attendance Curfew',
        attendanceDate: new Date(),
        status: AttendanceSessionStatus.ACTIVE,
        startTime: new Date(Date.now() - 10 * 60 * 1000), // started 10m ago
        endTime: new Date(Date.now() + 50 * 60 * 1000), // ends in 50m
        createdByUserId: wardenUserId,
        startedByUserId: wardenUserId,
      },
    });
    return session;
  }

  // Test 65: VALID PRESENT
  it('65: stable MATCH at ATTENDANCE camera marks resident PRESENT exactly once', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_65');
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');

    const decision = await attendanceDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('ATTENDANCE_MARKED');
    expect(decision.sessionId).toBe(session.id);
    expect(decision.residentId).toBe(resident.id);
    expect(decision.attendanceStatus).toBe(AttendanceRecordStatus.PRESENT);
    expect(decision.markMethod).toBe(AttendanceMarkMethod.FACE_RECOGNITION);

    // Verify database record
    const records = await testPrisma.attendanceRecord.findMany({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(records.length).toBe(1);
    expect(records[0].status).toBe(AttendanceRecordStatus.PRESENT);
    expect(records[0].markMethod).toBe(AttendanceMarkMethod.FACE_RECOGNITION);
  });

  // Test 66: DUPLICATE PRESENT
  it('66: repeated stable MATCH suppresses duplicates and returns ALREADY_MARKED', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_66');

    // First appearance -> marked PRESENT
    const obs1 = createObservation(attendanceCameraId, resident, 'MATCH');
    const decision1 = await attendanceDecisionService.evaluateObservation(obs1);
    expect(decision1.status).toBe('ATTENDANCE_MARKED');

    // Second appearance 10 seconds later -> ALREADY_MARKED
    const obs2 = createObservation(attendanceCameraId, resident, 'MATCH');
    const decision2 = await attendanceDecisionService.evaluateObservation(obs2);
    expect(decision2.status).toBe('ALREADY_MARKED');
    expect(decision2.reason).toContain('already marked');

    // Database must still contain exactly ONE record
    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(recordCount).toBe(1);
  });

  // Test 67: CONCURRENT MARKING
  it('67: concurrent marking (Promise.all 5 calls) safely produces exactly 1 AttendanceRecord', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_67');
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');

    // Fire 5 concurrent evaluation attempts for the same resident and session
    const results = await Promise.all([
      attendanceDecisionService.evaluateObservation(obs),
      attendanceDecisionService.evaluateObservation(obs),
      attendanceDecisionService.evaluateObservation(obs),
      attendanceDecisionService.evaluateObservation(obs),
      attendanceDecisionService.evaluateObservation(obs),
    ]);

    // All results must be valid decisions: ATTENDANCE_MARKED or ALREADY_MARKED
    for (const r of results) {
      expect(['ATTENDANCE_MARKED', 'ALREADY_MARKED']).toContain(r.status);
    }

    // Database uniqueness guarantee: exactly ONE record exists
    const records = await testPrisma.attendanceRecord.findMany({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(records.length).toBe(1);
  });

  // Test 68: UNKNOWN
  it('68: UNKNOWN classification creates zero attendance records', async () => {
    const session = await createActiveSession();
    const obs = createObservation(attendanceCameraId, null, 'UNKNOWN');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('NO_MATCH');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 69: UNCERTAIN
  it('69: UNCERTAIN classification creates zero attendance records', async () => {
    const session = await createActiveSession();
    const obs = createObservation(attendanceCameraId, null, 'UNCERTAIN');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('NO_MATCH');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 70: QUALITY_INSUFFICIENT
  it('70: QUALITY_INSUFFICIENT classification creates zero attendance records', async () => {
    const session = await createActiveSession();
    const obs = createObservation(attendanceCameraId, null, 'QUALITY_INSUFFICIENT');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('NO_MATCH');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 71: IN CAMERA
  it('71: stable MATCH at CameraRole.IN creates NO attendance record', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_71');
    const obs = createObservation(inCameraId, resident, 'MATCH');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('CAMERA_NOT_ATTENDANCE_CAPABLE');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 72: OUT CAMERA
  it('72: stable MATCH at CameraRole.OUT creates NO attendance record', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_72');
    const obs = createObservation(outCameraId, resident, 'MATCH');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('CAMERA_NOT_ATTENDANCE_CAPABLE');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 73: GENERAL CAMERA
  it('73: stable MATCH at CameraRole.GENERAL creates NO attendance record and NO movement', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_73');
    const obs = createObservation(generalCameraId, resident, 'MATCH');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('CAMERA_NOT_ATTENDANCE_CAPABLE');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(recordCount).toBe(0);

    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);
  });

  // Test 74: ATTENDANCE CAMERA
  it('74: stable MATCH at CameraRole.ATTENDANCE creates attendance and ZERO MovementEvents', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_74');
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('ATTENDANCE_MARKED');

    // MovementEvent count must be 0
    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);

    // ResidentPresence must be unchanged (still IN)
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);
  });

  // Test 75: SESSION CLOSED
  it('75: stable MATCH after session is CLOSED creates zero automatic attendance changes', async () => {
    const session = await createActiveSession();
    // Close session
    await testPrisma.attendanceSession.update({
      where: { id: session.id },
      data: { status: AttendanceSessionStatus.CLOSED },
    });

    const resident = await createTestResident('R_ATT_75');
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('NO_ACTIVE_SESSION');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 76: OUTSIDE TIME WINDOW
  it('76: stable MATCH outside configured session time window is rejected', async () => {
    // Session starting 2 hours in future
    const futureSession = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgId,
        hostelId: hostelId,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Future Session',
        attendanceDate: new Date(),
        status: AttendanceSessionStatus.ACTIVE,
        startTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // starts in 2h
        endTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
        createdByUserId: wardenUserId,
      },
    });

    const resident = await createTestResident('R_ATT_76');
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');

    const decision = await attendanceDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('SESSION_NOT_STARTED');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: futureSession.id, residentId: resident.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 77: CROSS HOSTEL
  it('77: rejects attendance when resident belongs to a different hostel (CROSS_HOSTEL_MISMATCH)', async () => {
    const session = await createActiveSession(); // Main Hostel
    const foreignResident = await createTestResident('R_FOREIGN_ATT', foreignHostelId); // Foreign Hostel

    const obs = createObservation(attendanceCameraId, foreignResident, 'MATCH');
    const decision = await attendanceDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('CROSS_HOSTEL_MISMATCH');
    expect(decision.reason).toContain('belongs to hostel');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id, residentId: foreignResident.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 78: RESIDENT DEACTIVATED
  it('78: resident deactivated before decision is rejected (RESIDENT_INACTIVE)', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ATT_78', hostelId, ResidentStatus.INACTIVE);

    const obs = createObservation(attendanceCameraId, resident, 'MATCH');
    const decision = await attendanceDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('RESIDENT_INACTIVE');

    const recordCount = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });
    expect(recordCount).toBe(0);
  });

  // Test 79: NON-ENROLLED RESIDENT IN ROSTER
  it('79: active resident without face enrollment remains in expected roster and can be manually corrected', async () => {
    const nonEnrolled = await createTestResident(
      'R_NOT_ENROLLED',
      hostelId,
      ResidentStatus.ACTIVE,
      FaceEnrollmentStatus.NOT_ENROLLED
    );
    const session = await createActiveSession();

    // Roster query must include this resident in expected residents
    const rosterData = await attendanceService.getAttendanceRoster(session.id);
    expect(rosterData.stats.expectedResidents).toBeGreaterThanOrEqual(1);

    const entry = rosterData.roster.find((r) => r.residentId === nonEnrolled.id);
    expect(entry).toBeDefined();
    expect(entry?.faceEnrollmentStatus).toBe(FaceEnrollmentStatus.NOT_ENROLLED);
    expect(entry?.status).toBe('NOT_RECORDED');

    // Warden can manually correct / mark this resident
    const corrected = await attendanceService.correctAttendanceRecord({
      sessionId: session.id,
      residentId: nonEnrolled.id,
      status: AttendanceRecordStatus.PRESENT,
      reason: 'Resident verified in person by Warden',
      performedByUserId: wardenUserId,
      performedByRole: StaffRole.WARDEN,
    });
    expect(corrected.status).toBe(AttendanceRecordStatus.PRESENT);
    expect(corrected.markMethod).toBe(AttendanceMarkMethod.WARDEN_OVERRIDE);
  });

  // Test 80: CLOSE SESSION
  it('80: closing a session marks all expected residents who are not present as ABSENT', async () => {
    // Create 5 active residents in this hostel
    const r1 = await createTestResident('R_CLOSE_1');
    const r2 = await createTestResident('R_CLOSE_2');
    const r3 = await createTestResident('R_CLOSE_3');
    const r4 = await createTestResident('R_CLOSE_4');
    const r5 = await createTestResident('R_CLOSE_5');

    // Create session in DRAFT and start it
    const sessionDraft = await attendanceService.createSession({
      organizationId: orgId,
      hostelId: hostelId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Roll Call for 5 Residents',
      createdByUserId: wardenUserId,
      createdByRole: StaffRole.WARDEN,
    });
    const session = await attendanceService.startSession(sessionDraft.id, wardenUserId, StaffRole.WARDEN);

    // Mark 2 residents as PRESENT via recognition
    await attendanceDecisionService.evaluateObservation(createObservation(attendanceCameraId, r1, 'MATCH'));
    await attendanceDecisionService.evaluateObservation(createObservation(attendanceCameraId, r2, 'MATCH'));

    // Close session
    const closed = await attendanceService.closeSession(session.id, wardenUserId, StaffRole.WARDEN);
    expect(closed.status).toBe(AttendanceSessionStatus.CLOSED);

    // Verify all 5 residents now have records: 2 PRESENT, 3 ABSENT
    const records = await testPrisma.attendanceRecord.findMany({
      where: { attendanceSessionId: session.id },
    });
    expect(records.length).toBe(5);

    const presents = records.filter((r) => r.status === AttendanceRecordStatus.PRESENT);
    const absents = records.filter((r) => r.status === AttendanceRecordStatus.ABSENT);
    expect(presents.length).toBe(2);
    expect(absents.length).toBe(3);

    // Verify that the absent records were marked with SYSTEM source
    for (const a of absents) {
      expect(a.markMethod).toBe(AttendanceMarkMethod.SYSTEM);
      expect(a.notes).toContain('Automatically marked absent upon session close');
    }
  });

  // Test 81: CLOSE TWICE
  it('81: closing a session twice is idempotent and creates NO duplicate records', async () => {
    const r1 = await createTestResident('R_CLOSE_TWICE_1');
    const r2 = await createTestResident('R_CLOSE_TWICE_2');

    const sessionDraft = await attendanceService.createSession({
      organizationId: orgId,
      hostelId: hostelId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Idempotency Close Test',
      createdByUserId: wardenUserId,
      createdByRole: StaffRole.WARDEN,
    });
    const session = await attendanceService.startSession(sessionDraft.id, wardenUserId, StaffRole.WARDEN);

    // Close first time
    await attendanceService.closeSession(session.id, wardenUserId, StaffRole.WARDEN);
    const recordsFirst = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id },
    });

    // Close second time
    const closedAgain = await attendanceService.closeSession(session.id, wardenUserId, StaffRole.WARDEN);
    expect(closedAgain.status).toBe(AttendanceSessionStatus.CLOSED);

    const recordsSecond = await testPrisma.attendanceRecord.count({
      where: { attendanceSessionId: session.id },
    });
    expect(recordsSecond).toBe(recordsFirst);
  });

  // Test 82: MANUAL CORRECTION
  it('82: Warden changes ABSENT -> PRESENT with mandatory reason, recording audit trail', async () => {
    const resident = await createTestResident('R_CORRECT_82');
    const session = await createActiveSession();

    // Mark as ABSENT first
    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: resident.id,
        status: AttendanceRecordStatus.ABSENT,
        markMethod: AttendanceMarkMethod.SYSTEM,
      },
    });

    // Warden corrects to PRESENT with reason
    const reasonText = 'Resident was at campus clinic during roll call with medical note';
    const corrected = await attendanceService.correctAttendanceRecord({
      sessionId: session.id,
      residentId: resident.id,
      status: AttendanceRecordStatus.PRESENT,
      reason: reasonText,
      performedByUserId: wardenUserId,
      performedByRole: StaffRole.WARDEN,
    });

    expect(corrected.status).toBe(AttendanceRecordStatus.PRESENT);
    expect(corrected.correctionReason).toBe(reasonText);
    expect(corrected.correctedByUserId).toBe(wardenUserId);

    // Audit log must exist
    const audit = await testPrisma.auditLog.findFirst({
      where: {
        entityType: 'ATTENDANCE_RECORD',
        entityId: corrected.id,
        action: 'ATTENDANCE_OVERRIDE',
      },
    });
    expect(audit).toBeDefined();
    expect(audit?.reason).toBe(reasonText);
    expect(audit?.performedByUserId).toBe(wardenUserId);
  });

  // Test 83: GUARD CORRECTION
  it('83: Guard is forbidden (403) from manually correcting attendance', async () => {
    const resident = await createTestResident('R_GUARD_FORBID_83');
    const session = await createActiveSession();

    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: resident.id,
        status: AttendanceRecordStatus.ABSENT,
        markMethod: AttendanceMarkMethod.SYSTEM,
      },
    });

    // Guard attempts correction via service
    await expect(
      attendanceService.correctAttendanceRecord({
        sessionId: session.id,
        residentId: resident.id,
        status: AttendanceRecordStatus.PRESENT,
        reason: 'Guard override attempt',
        performedByUserId: guardUserId,
        performedByRole: StaffRole.GUARD,
      })
    ).rejects.toThrow();

    // Guard attempts correction via REST API -> must be 403 Forbidden
    const res = await request(app)
      .patch(`/api/v1/attendance/sessions/${session.id}/records/${resident.id}`)
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ status: 'PRESENT', reason: 'Guard trying to edit' });

    expect(res.status).toBe(403);
  });

  // Test 84: WARDEN CROSS HOSTEL
  it('84: Warden from another hostel cannot correct or access attendance in foreign hostel (404/scope)', async () => {
    const resident = await createTestResident('R_HOSTEL_A', hostelId);
    const session = await createActiveSession(hostelId);

    // Foreign warden attempts to access / modify session in Main Hostel
    const res = await request(app)
      .patch(`/api/v1/attendance/sessions/${session.id}/records/${resident.id}`)
      .set('Authorization', `Bearer ${foreignWardenToken}`)
      .send({ status: 'PRESENT', reason: 'Cross-hostel edit attempt' });

    expect([403, 404]).toContain(res.status);
  });

  // Test 85: NO MOVEMENT FROM ATTENDANCE
  it('85: attendance recognition creates ZERO MovementEvents and leaves ResidentPresence unchanged', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_ISOLATE_85');

    const initialMovementCount = await testPrisma.movementEvent.count();
    const initialPresence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(initialPresence?.currentState).toBe(PresenceState.IN);

    // Process attendance through attendance bridge
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');
    const decision = await attendanceBridge.processObservation(obs);

    expect(decision.status).toBe('ATTENDANCE_MARKED');

    // MovementEvents count must NOT change
    const postMovementCount = await testPrisma.movementEvent.count();
    expect(postMovementCount).toBe(initialMovementCount);

    // ResidentPresence must be untouched
    const postPresence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(postPresence?.currentState).toBe(initialPresence?.currentState);
    expect(postPresence?.updatedAt).toEqual(initialPresence?.updatedAt);
  });

  // Test: Privacy verification
  it('strictly verifies AttendanceRecord and AttendanceSession never store embeddings or face images', async () => {
    const session = await createActiveSession();
    const resident = await createTestResident('R_PRIVACY_ATT');
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');

    await attendanceDecisionService.evaluateObservation(obs);

    const record = await testPrisma.attendanceRecord.findFirst({
      where: { attendanceSessionId: session.id, residentId: resident.id },
    });

    expect(record).toBeDefined();
    const recordJson = JSON.stringify(record);

    expect(recordJson).not.toContain('embedding');
    expect(recordJson).not.toContain('vector');
    expect(recordJson).not.toContain('faceCrop');
    expect(recordJson).not.toContain('rawFrame');
  });

  // REST API Integration Tests
  describe('Attendance REST API Integration', () => {
    it('GET /api/v1/attendance/sessions lists sessions for authorized user', async () => {
      await createActiveSession();

      const res = await request(app)
        .get('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sessions)).toBe(true);
      expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/v1/attendance/sessions creates a session for Warden', async () => {
      const res = await request(app)
        .get('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${wardenToken}`);

      const createRes = await request(app)
        .post('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({
          title: 'Night Attendance 21:00',
          sessionType: 'NIGHT',
          cameraId: attendanceCameraId,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.session.title).toBe('Night Attendance 21:00');
      expect(createRes.body.session.status).toBe('DRAFT');
    });

    it('POST /api/v1/attendance/sessions is forbidden (403) for Guard', async () => {
      const res = await request(app)
        .post('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({
          title: 'Guard Trying Session Creation',
          sessionType: 'NIGHT',
        });

      expect(res.status).toBe(403);
    });

    it('POST /api/v1/attendance/sessions/:id/start starts session', async () => {
      const draft = await attendanceService.createSession({
        organizationId: orgId,
        hostelId: hostelId,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Start API Test Session',
        createdByUserId: wardenUserId,
        createdByRole: StaffRole.WARDEN,
      });

      const res = await request(app)
        .post(`/api/v1/attendance/sessions/${draft.id}/start`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe('ACTIVE');
    });

    it('POST /api/v1/attendance/sessions/:id/close closes session and finalizes absents', async () => {
      const resident = await createTestResident('R_API_CLOSE');
      const draft = await attendanceService.createSession({
        organizationId: orgId,
        hostelId: hostelId,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Close API Test Session',
        createdByUserId: wardenUserId,
        createdByRole: StaffRole.WARDEN,
      });
      await attendanceService.startSession(draft.id, wardenUserId, StaffRole.WARDEN);

      const res = await request(app)
        .post(`/api/v1/attendance/sessions/${draft.id}/close`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe('CLOSED');
      expect(res.body.stats.absentCount).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/attendance/sessions/:id/records returns full roster with expected and status', async () => {
      const resident = await createTestResident('R_ROSTER_API');
      const session = await createActiveSession();

      const res = await request(app)
        .get(`/api/v1/attendance/sessions/${session.id}/records`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats).toBeDefined();
      expect(res.body.stats.expectedResidents).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.roster)).toBe(true);

      const item = res.body.roster.find((r: any) => r.residentId === resident.id);
      expect(item).toBeDefined();
      expect(item.residentCode).toBe('R_ROSTER_API');
    });

    it('PATCH /api/v1/attendance/sessions/:id/records/:residentId successfully corrects status with reason', async () => {
      const resident = await createTestResident('R_PATCH_CORRECT');
      const session = await createActiveSession();

      const res = await request(app)
        .patch(`/api/v1/attendance/sessions/${session.id}/records/${resident.id}`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({
          status: 'PRESENT',
          reason: 'Resident verified present in person by Warden',
        });

      expect(res.status).toBe(200);
      expect(res.body.record.status).toBe('PRESENT');
      expect(res.body.record.correctionReason).toBe('Resident verified present in person by Warden');
    });

    it('PATCH /api/v1/attendance/sessions/:id/records/:residentId rejects missing reason with 400', async () => {
      const resident = await createTestResident('R_PATCH_NO_REASON');
      const session = await createActiveSession();

      const res = await request(app)
        .patch(`/api/v1/attendance/sessions/${session.id}/records/${resident.id}`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({
          status: 'PRESENT',
          reason: '', // missing
        });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // STEP 08.1 HARDENING TESTS (Tests 87 - 90)
  // ==========================================
  describe('Step 08.1: Traceability, Window Policy & Lifecycle Hardening', () => {
    // Test 87: Traceability
    it('87: verifies RecognitionObservation.id -> AttendanceDecision -> AttendanceRecord.recognitionReference traceability', async () => {
      const session = await createActiveSession();
      const resident = await createTestResident('R_ATT_TRACE');

      // Observation where observationId is undefined, but id is 'rec_123'
      const obs = createObservation(attendanceCameraId, resident, 'MATCH');
      obs.id = 'rec_123';
      obs.observationId = undefined;

      const decision = await attendanceDecisionService.evaluateObservation(obs);
      expect(decision.status).toBe('ATTENDANCE_MARKED');
      expect(decision.recognitionReference).toBe('rec_123');

      const record = await testPrisma.attendanceRecord.findUnique({
        where: {
          attendanceSessionId_residentId: {
            attendanceSessionId: session.id,
            residentId: resident.id,
          },
        },
      });

      expect(record).not.toBeNull();
      expect(record!.recognitionReference).toBe('rec_123');
      expect(record!.status).toBe(AttendanceRecordStatus.PRESENT);
      expect(record!.markMethod).toBe(AttendanceMarkMethod.FACE_RECOGNITION);

      // Verify no biometric vector, image, or face crop is persisted in AttendanceRecord
      const recordKeys = Object.keys(record!);
      expect(recordKeys).not.toContain('vector');
      expect(recordKeys).not.toContain('embedding');
      expect(recordKeys).not.toContain('faceCrop');
      expect(recordKeys).not.toContain('image');
      expect(recordKeys).not.toContain('template');
    });

    // Test 88: Window Ended
    it('88: rejects attendance when current time is after session endTime (SESSION_WINDOW_ENDED)', async () => {
      const pastSession = await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgId,
          hostelId: hostelId,
          title: 'Expired Night Attendance',
          sessionType: AttendanceSessionType.NIGHT,
          status: AttendanceSessionStatus.ACTIVE,
          startTime: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
          endTime: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
          createdByUserId: wardenUserId,
        },
      });

      const resident = await createTestResident('R_ATT_EXPIRED');
      const obs = createObservation(attendanceCameraId, resident, 'MATCH');

      const decision = await attendanceDecisionService.evaluateObservation(obs);
      expect(decision.status).toBe('SESSION_WINDOW_ENDED');
      expect(decision.reason).toContain('time window has ended');

      const recordCount = await testPrisma.attendanceRecord.count({
        where: { attendanceSessionId: pastSession.id, residentId: resident.id },
      });
      expect(recordCount).toBe(0);
    });

    // Test 89: Restart Lifecycle
    it('89: verifies start -> stop -> restart lifecycle on ATTENDANCE camera maintains single bridge listener and clean state', async () => {
      await createActiveSession();
      const resident = await createTestResident('R_ATT_RESTART');

      const mockWorkerClient = new PythonWorkerClient({ mock: true });
      const mockCameraService = new CameraService(testPrisma);
      let streamListener: ((frame: any) => void) | null = null;
      vi.spyOn(mockCameraService, 'subscribeToStream').mockImplementation(async (_cId: string, listener: any) => {
        streamListener = listener;
        return () => {
          streamListener = null;
        };
      });

      const mockTemplateCache = new TemplateCache(testPrisma);
      const recService = new RecognitionService(testPrisma, mockCameraService, mockTemplateCache, mockWorkerClient, {
        attendanceBridge,
      });

      const wardenActor = {
        id: wardenUserId,
        userId: wardenUserId,
        role: StaffRole.WARDEN,
        organizationId: orgId,
        hostelId: hostelId,
      };

      // 1. Start recognition
      await recService.startRecognition(attendanceCameraId, wardenActor);
      const activeSession1 = recService.getActiveSession(attendanceCameraId);
      expect(activeSession1).toBeDefined();
      expect(attendanceBridge.getActiveSubscriptionCount()).toBe(1);
      expect(attendanceBridge.hasSubscription(attendanceCameraId)).toBe(true);
      expect(activeSession1!.eventEmitter.listenerCount('stableMatch')).toBe(1);

      // 2. Stop recognition
      await recService.stopRecognition(attendanceCameraId, wardenActor);
      expect(attendanceBridge.getActiveSubscriptionCount()).toBe(0);
      expect(attendanceBridge.hasSubscription(attendanceCameraId)).toBe(false);
      expect(activeSession1!.eventEmitter.listenerCount('stableMatch')).toBe(0);
      expect(streamListener).toBeNull();

      // 3. Start recognition again (restart)
      await recService.startRecognition(attendanceCameraId, wardenActor);
      const activeSession2 = recService.getActiveSession(attendanceCameraId);
      expect(activeSession2).toBeDefined();
      expect(attendanceBridge.getActiveSubscriptionCount()).toBe(1);
      expect(attendanceBridge.hasSubscription(attendanceCameraId)).toBe(true);
      expect(activeSession2!.eventEmitter.listenerCount('stableMatch')).toBe(1);

      // 4. Verify exactly one decision is generated when stableMatch fires
      const decisions: any[] = [];
      const onDecision = ({ decision }: any) => {
        decisions.push(decision);
      };
      attendanceBridge.on('attendanceDecision', onDecision);

      const obs = createObservation(attendanceCameraId, resident, 'MATCH', 'rec_restart_test_1');

      activeSession2!.eventEmitter.emit('stableMatch', obs);

      await new Promise((r) => setTimeout(r, 100));

      expect(decisions.length).toBe(1);
      expect(decisions[0].status).toBe('ATTENDANCE_MARKED');
      expect(decisions[0].residentId).toBe(resident.id);

      // Clean up
      attendanceBridge.off('attendanceDecision', onDecision);
      await recService.stopRecognition(attendanceCameraId, wardenActor);
      expect(attendanceBridge.getActiveSubscriptionCount()).toBe(0);
    });

    // Test 90: Bridge Listener Cleanup
    it('90: verifies complete cleanup of all bridge listeners and session emitters on stop', async () => {
      const mockWorkerClient = new PythonWorkerClient({ mock: true });
      const mockCameraService = new CameraService(testPrisma);
      vi.spyOn(mockCameraService, 'subscribeToStream').mockImplementation(async () => {
        return () => {};
      });

      const mockTemplateCache = new TemplateCache(testPrisma);
      const movementBridge = new MovementRecognitionBridge(movementDecisionService);

      const recService = new RecognitionService(testPrisma, mockCameraService, mockTemplateCache, mockWorkerClient, {
        attendanceBridge,
        movementBridge,
      });

      const wardenActor = {
        id: wardenUserId,
        userId: wardenUserId,
        role: StaffRole.WARDEN,
        organizationId: orgId,
        hostelId: hostelId,
      };

      // Start ATTENDANCE camera recognition
      await recService.startRecognition(attendanceCameraId, wardenActor);
      const attSession = recService.getActiveSession(attendanceCameraId);
      expect(attSession).toBeDefined();

      // Start IN gate camera recognition
      await recService.startRecognition(inCameraId, wardenActor);
      const inSession = recService.getActiveSession(inCameraId);
      expect(inSession).toBeDefined();

      expect(attendanceBridge.getActiveSubscriptionCount()).toBe(1);
      expect(movementBridge.getActiveSubscriptionCount()).toBe(1);
      expect(attendanceBridge.listenerCount('attendanceDecision')).toBeGreaterThanOrEqual(1);
      expect(movementBridge.listenerCount('movementDecision')).toBeGreaterThanOrEqual(1);

      // Stop ATTENDANCE camera
      await recService.stopRecognition(attendanceCameraId, wardenActor);
      expect(attendanceBridge.getActiveSubscriptionCount()).toBe(0);
      expect(attSession!.eventEmitter.listenerCount('stableMatch')).toBe(0);
      expect(attendanceBridge.listenerCount('attendanceDecision')).toBe(0);

      // Stop IN gate camera
      await recService.stopRecognition(inCameraId, wardenActor);
      expect(movementBridge.getActiveSubscriptionCount()).toBe(0);
      expect(inSession!.eventEmitter.listenerCount('stableMatch')).toBe(0);
      expect(movementBridge.listenerCount('movementDecision')).toBe(0);
    });
  });
});
