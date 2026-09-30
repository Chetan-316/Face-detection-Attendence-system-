import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { MovementDecisionService } from '../src/modules/movement-decision/movement-decision.service';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';
import {
  CameraRole,
  CameraSourceType,
  MovementSource,
  MovementType,
  PresenceState,
  ResidentStatus,
  FaceEnrollmentStatus,
  StaffRole,
} from '@prisma/client';
import { RecognitionObservation } from '../src/modules/recognition/recognition.types';

describe('Step 07: Movement Decision Engine & Gate Automation Tests', () => {
  let movementDecisionService: MovementDecisionService;
  let movementService: MovementService;
  let residentService: ResidentService;
  let app: any;

  let orgId: string;
  let hostelId: string;
  let foreignHostelId: string;
  let inCameraId: string;
  let outCameraId: string;
  let generalCameraId: string;
  let attendanceCameraId: string;

  let adminToken: string;
  let wardenToken: string;
  let guardToken: string;

  beforeEach(async () => {
    await resetTestDatabase();

    movementService = new MovementService(testPrisma);
    movementDecisionService = new MovementDecisionService(testPrisma, movementService, {
      globalAutomationEnabled: true,
      minTransitionIntervalMs: 5000,
    });
    residentService = new ResidentService(testPrisma);
    app = createApp(testPrisma, { movementDecisionService });

    // 1. Create Organization & Hostels
    const org = await testPrisma.organization.create({
      data: { code: 'ORG_DECISION', name: 'Movement Decision Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H_MAIN', name: 'Main Campus Hostel' },
    });
    hostelId = hostel.id;

    const foreignHostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H_FOREIGN', name: 'Foreign Hostel' },
    });
    foreignHostelId = foreignHostel.id;

    // 2. Create Users & Auth Tokens
    const adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        username: 'admin_decision',
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
        username: 'warden_decision',
        fullName: 'Warden User',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    wardenToken = tokenService.generateToken({
      sub: wardenUser.id,
      role: wardenUser.role,
      organizationId: wardenUser.organizationId,
      hostelId: wardenUser.hostelId,
    }).token;

    const guardUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'guard_decision',
        fullName: 'Gate Guard',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardToken = tokenService.generateToken({
      sub: guardUser.id,
      role: guardUser.role,
      organizationId: guardUser.organizationId,
      hostelId: guardUser.hostelId,
    }).token;

    // 3. Create Cameras with diverse roles
    const inCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Main Ingress Gate Camera',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.IN,
        isEnabled: true,
        configMetadata: { movementAutomationEnabled: true },
      },
    });
    inCameraId = inCam.id;

    const outCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Main Egress Gate Camera',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.OUT,
        isEnabled: true,
        configMetadata: { movementAutomationEnabled: true },
      },
    });
    outCameraId = outCam.id;

    const genCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Perimeter General Camera',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.GENERAL,
        isEnabled: true,
      },
    });
    generalCameraId = genCam.id;

    const attCam = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Assembly Point Attendance Camera',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.ATTENDANCE,
        isEnabled: true,
      },
    });
    attendanceCameraId = attCam.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  const createTestResident = async (
    code: string,
    initialPresence: PresenceState = PresenceState.OUT,
    targetHostelId = hostelId
  ) => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: targetHostelId,
      residentCode: code,
      fullName: `Resident ${code}`,
      roomGroup: 'A-101',
      initialPresence,
    });

    // Mark as enrolled for recognition eligibility
    await testPrisma.resident.update({
      where: { id: resident.id },
      data: { faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED },
    });

    return resident;
  };

  /**
   * Creates a resident with NO ResidentPresence row (simulates a brand-new, never-before-seen resident
   * who has not gone through initial setup).
   */
  const createResidentNoPresence = async (code: string) => {
    const resident = await testPrisma.resident.create({
      data: {
        organizationId: orgId,
        hostelId: hostelId,
        residentCode: code,
        fullName: `Resident ${code}`,
        roomGroup: 'B-200',
        faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
      },
    });
    return resident;
  };

  const createObservation = (
    cameraId: string,
    resident: any,
    classification: any = 'MATCH',
    obsId = `obs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  ): RecognitionObservation => ({
    id: obsId,
    faceId: 'track_1',
    cameraId,
    classification,
    resident: resident ? { id: resident.id, residentCode: resident.residentCode, fullName: resident.fullName } : null,
    similarity: 0.85,
    secondBestSimilarity: 0.20,
    bbox: { x: 10, y: 10, width: 100, height: 100 },
    qualityUsable: true,
    detectedAt: new Date().toISOString(),
    isStable: true,
    shouldEmitEvent: true,
  });

  // Test 53: IN TRANSITION
  it('53: creates IN MovementEvent and transitions ResidentPresence from OUT -> IN exactly once', async () => {
    const resident = await createTestResident('R_IN_1', PresenceState.OUT);
    const obs = createObservation(inCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('MOVEMENT_CREATED');
    expect(decision.direction).toBe(MovementType.IN);
    expect(decision.currentPresence).toBe(PresenceState.IN);
    expect(decision.movementEventId).toBeDefined();

    // Verify DB state
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);
    expect(presence?.lastMovementEventId).toBe(decision.movementEventId);

    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(1);
  });

  // Test 54: DUPLICATE IN
  it('54: suppresses duplicate IN transition when resident is already IN (Result = ALREADY_IN, no DB movement)', async () => {
    const resident = await createTestResident('R_IN_2', PresenceState.IN);
    const obs = createObservation(inCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('ALREADY_IN');
    expect(decision.currentPresence).toBe(PresenceState.IN);
    expect(decision.movementEventId).toBeUndefined();

    // No movement event written
    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);
  });

  // Test 55: OUT TRANSITION
  it('55: creates OUT MovementEvent and transitions ResidentPresence from IN -> OUT', async () => {
    const resident = await createTestResident('R_OUT_1', PresenceState.IN);
    const obs = createObservation(outCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('MOVEMENT_CREATED');
    expect(decision.direction).toBe(MovementType.OUT);
    expect(decision.currentPresence).toBe(PresenceState.OUT);
    expect(decision.movementEventId).toBeDefined();

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.OUT);
  });

  // Test 56: DUPLICATE OUT
  it('56: suppresses duplicate OUT transition when resident is already OUT (Result = ALREADY_OUT)', async () => {
    const resident = await createTestResident('R_OUT_2', PresenceState.OUT);
    const obs = createObservation(outCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('ALREADY_OUT');
    expect(decision.currentPresence).toBe(PresenceState.OUT);
    expect(decision.movementEventId).toBeUndefined();

    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);
  });

  // Test 57: GENERAL CAMERA
  it('57: creates NO movement event and changes NO presence for CameraRole.GENERAL', async () => {
    const resident = await createTestResident('R_GEN_1', PresenceState.OUT);
    const obs = createObservation(generalCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('CAMERA_NOT_MOVEMENT_CAPABLE');
    expect(decision.movementEventId).toBeUndefined();

    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);
  });

  // Test 58: ATTENDANCE CAMERA
  it('58: creates NO movement event and changes NO presence for CameraRole.ATTENDANCE', async () => {
    const resident = await createTestResident('R_ATT_1', PresenceState.OUT);
    const obs = createObservation(attendanceCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('CAMERA_NOT_MOVEMENT_CAPABLE');
    expect(decision.movementEventId).toBeUndefined();

    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);
  });

  // Test 59: UNKNOWN
  it('59: creates NO movement event for UNKNOWN classification', async () => {
    const obs = createObservation(inCameraId, null, 'UNKNOWN');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('NO_MATCH');
    expect(decision.movementEventId).toBeUndefined();

    const totalMovements = await testPrisma.movementEvent.count();
    expect(totalMovements).toBe(0);
  });

  // Test 60: UNCERTAIN
  it('60: creates NO movement event for UNCERTAIN classification', async () => {
    const obs = createObservation(inCameraId, null, 'UNCERTAIN');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('NO_MATCH');
    expect(decision.movementEventId).toBeUndefined();
  });

  // Test 61: QUALITY_INSUFFICIENT
  it('61: creates NO movement event for QUALITY_INSUFFICIENT classification', async () => {
    const obs = createObservation(inCameraId, null, 'QUALITY_INSUFFICIENT');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('NO_MATCH');
    expect(decision.movementEventId).toBeUndefined();
  });

  // Test 62: SEQUENTIAL IDEMPOTENCY
  it('62: processing the same recognition observation twice (sequential) produces only ONE MovementEvent', async () => {
    const resident = await createTestResident('R_IDEMP_1', PresenceState.OUT);
    const observationId = `obs_idemp_${Date.now()}`;
    const obs = createObservation(inCameraId, resident, 'MATCH', observationId);

    // First evaluation: successfully creates movement
    const decision1 = await movementDecisionService.evaluateObservation(obs);
    expect(decision1.status).toBe('MOVEMENT_CREATED');
    expect(decision1.movementEventId).toBeDefined();

    // Replay same observation (e.g. SSE reconnect or retry)
    const decision2 = await movementDecisionService.evaluateObservation(obs);
    expect(decision2.status).toBe('DUPLICATE_OBSERVATION_SUPPRESSED');

    // DB must contain exactly ONE movement event
    const events = await testPrisma.movementEvent.findMany({
      where: { recognitionReference: observationId },
    });
    expect(events.length).toBe(1);
    expect(events[0].id).toBe(decision1.movementEventId);
  });

  // Test 62c: CONCURRENT IDEMPOTENCY REGRESSION
  it('62c: concurrent evaluation of the same observationId produces exactly ONE MovementEvent even when calls begin simultaneously', async () => {
    const resident = await createTestResident('R_CONCURRENT_1', PresenceState.OUT);
    const observationId = `obs_concurrent_${Date.now()}`;
    const obs = createObservation(inCameraId, resident, 'MATCH', observationId);

    // Clear cache to ensure a clean slate (no prior in-memory result)
    movementDecisionService.clearCache();

    // Fire 5 concurrent evaluations of the exact same observationId
    const results = await Promise.all([
      movementDecisionService.evaluateObservation(obs),
      movementDecisionService.evaluateObservation(obs),
      movementDecisionService.evaluateObservation(obs),
      movementDecisionService.evaluateObservation(obs),
      movementDecisionService.evaluateObservation(obs),
    ]);

    // All results must be either MOVEMENT_CREATED or DUPLICATE_OBSERVATION_SUPPRESSED
    // (never ERROR — idempotency layers must absorb all duplicates gracefully)
    for (const result of results) {
      expect(['MOVEMENT_CREATED', 'DUPLICATE_OBSERVATION_SUPPRESSED']).toContain(result.status);
    }

    // CRITICAL INVARIANT: Database must contain exactly ONE MovementEvent for this observation,
    // regardless of how many concurrent callers reported MOVEMENT_CREATED.
    // This is enforced by: (1) in-flight promise dedup map, (2) DB unique constraint on recognitionReference.
    const events = await testPrisma.movementEvent.findMany({
      where: { recognitionReference: observationId },
    });
    expect(events.length).toBe(1);

    // ResidentPresence must be IN (updated exactly once)
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);
    expect(presence?.lastMovementEventId).toBe(events[0].id);
  });

  // Test 63: TRANSITION GUARD
  it('63: suppresses rapid opposite transition within minimum transition interval (Result = TRANSITION_SUPPRESSED)', async () => {
    const resident = await createTestResident('R_GUARD_1', PresenceState.OUT);

    // 1. IN movement at Gate IN
    const inObs = createObservation(inCameraId, resident, 'MATCH');
    const inDecision = await movementDecisionService.evaluateObservation(inObs);
    expect(inDecision.status).toBe('MOVEMENT_CREATED');

    // 2. Opposite OUT movement detected only 500ms later (overlap / oscillation)
    const outObs = createObservation(outCameraId, resident, 'MATCH');
    const outDecision = await movementDecisionService.evaluateObservation(outObs);

    expect(outDecision.status).toBe('TRANSITION_SUPPRESSED');
    expect(outDecision.reason).toContain('Rapid opposite transition suppressed');

    // Resident presence must remain IN
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);

    // Total movement events in DB must remain 1
    const totalEvents = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(totalEvents).toBe(1);
  });

  // Test 64: HOSTEL SCOPE
  it('64: rejects movement when camera and resident belong to different hostels (Result = CROSS_HOSTEL_MISMATCH)', async () => {
    // Resident belongs to Foreign Hostel
    const foreignResident = await createTestResident('R_FOREIGN_1', PresenceState.OUT, foreignHostelId);
    // Camera belongs to Main Hostel
    const obs = createObservation(inCameraId, foreignResident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('CROSS_HOSTEL_MISMATCH');
    expect(decision.reason).toContain('mismatch');

    const movements = await testPrisma.movementEvent.count({
      where: { residentId: foreignResident.id },
    });
    expect(movements).toBe(0);
  });

  // Test 65: INACTIVE RESIDENT
  it('65: rejects movement for deactivated resident (Result = RESIDENT_INACTIVE)', async () => {
    const resident = await createTestResident('R_INACT_1', PresenceState.OUT);
    await testPrisma.resident.update({
      where: { id: resident.id },
      data: { status: ResidentStatus.INACTIVE },
    });

    const obs = createObservation(inCameraId, resident, 'MATCH');
    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('RESIDENT_INACTIVE');
    expect(decision.reason).toContain('must be ACTIVE');

    const movements = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movements).toBe(0);
  });

  // Test 65.1: NOT ENROLLED RESIDENT
  it('65.1: rejects movement if resident face enrollment status is NOT_ENROLLED (Result = RESIDENT_NOT_ENROLLED)', async () => {
    const resident = await createTestResident('R_NOT_ENR_1', PresenceState.OUT);
    await testPrisma.resident.update({
      where: { id: resident.id },
      data: { faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED },
    });

    const obs = createObservation(inCameraId, resident, 'MATCH');
    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('RESIDENT_NOT_ENROLLED');
  });

  // Test 66: ATOMIC ROLLBACK (resident WITH existing presence)
  it('66: atomic rollback prevents partial writes if database transaction fails', async () => {
    const resident = await createTestResident('R_ROLLBACK_1', PresenceState.OUT);
    const obs = createObservation(inCameraId, resident, 'MATCH');

    const recordNormalSpy = vi.spyOn(movementService, 'recordNormalMovement').mockRejectedValueOnce(
      new Error('Simulated atomic failure during transaction')
    );

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('ERROR');
    expect(decision.reason).toContain('Simulated atomic failure');

    // Assert that no partial records were persisted
    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.OUT);
    expect(presence?.lastMovementEventId).toBeNull();

    recordNormalSpy.mockRestore();
  });

  // Test 66a: ATOMIC ROLLBACK — initial presence resident
  it('66a: atomic rollback on initial-presence resident leaves ZERO MovementEvents AND ZERO ResidentPresence rows', async () => {
    // Resident with NO ResidentPresence row at all (brand new, uninitialized)
    const resident = await createResidentNoPresence('R_ROLLBACK_INIT_1');

    const obs = createObservation(inCameraId, resident, 'MATCH');

    // Spy on recordNormalMovement to simulate a DB failure after the transaction starts
    const recordNormalSpy = vi.spyOn(movementService, 'recordNormalMovement').mockRejectedValueOnce(
      new Error('Simulated atomic failure on initial presence')
    );

    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('ERROR');
    expect(decision.reason).toContain('Simulated atomic failure');

    // CRITICAL: No MovementEvent must exist
    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);

    // CRITICAL: No ResidentPresence must exist — no temporary OUT placeholder row
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence).toBeNull();

    recordNormalSpy.mockRestore();
  });

  // Test 67: NO ATTENDANCE SIDE EFFECT
  it('67: regression proves that movement recognition creates zero attendance records and modifies zero attendance sessions', async () => {
    // Create an active attendance session
    const session = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgId,
        hostelId: hostelId,
        sessionType: 'GENERAL',
        title: 'Morning Assembly',
        status: 'ACTIVE',
        startTime: new Date(),
        createdByUserId: (await testPrisma.user.findFirstOrThrow({ where: { role: 'WARDEN' } })).id,
      },
    });

    const resident = await createTestResident('R_ATT_SIDE_1', PresenceState.OUT);
    const obs = createObservation(inCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('MOVEMENT_CREATED');

    // Regression assertions:
    const attendanceRecordsCount = await testPrisma.attendanceRecord.count();
    expect(attendanceRecordsCount).toBe(0);

    const refreshedSession = await testPrisma.attendanceSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(refreshedSession.status).toBe('ACTIVE');
  });

  // Test 68: INITIAL PRESENCE ATOMICITY — IN camera creates presence atomically
  it('68: first-ever IN movement on resident with no prior ResidentPresence creates presence atomically (no temp OUT row outside transaction)', async () => {
    const resident = await createResidentNoPresence('R_INIT_ATOMIC_1');

    // Confirm NO presence row before
    const beforePresence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(beforePresence).toBeNull();

    const obs = createObservation(inCameraId, resident, 'MATCH');
    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('MOVEMENT_CREATED');
    expect(decision.direction).toBe(MovementType.IN);

    // Presence must now be IN (not OUT, no intermediate state)
    const afterPresence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(afterPresence?.currentState).toBe(PresenceState.IN);
    expect(afterPresence?.lastMovementEventId).toBe(decision.movementEventId);

    // Exactly 1 MovementEvent
    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(1);
  });

  // Test 69: INITIAL PRESENCE OUT POLICY MAINTAINED
  it('69: OUT camera on resident with no prior ResidentPresence is safely refused (INITIAL_PRESENCE_MISSING)', async () => {
    const resident = await createResidentNoPresence('R_INIT_OUT_1');

    const obs = createObservation(outCameraId, resident, 'MATCH');
    const decision = await movementDecisionService.evaluateObservation(obs);

    expect(decision.status).toBe('INITIAL_PRESENCE_MISSING');

    // No movement, no presence row created
    const movementCount = await testPrisma.movementEvent.count({
      where: { residentId: resident.id },
    });
    expect(movementCount).toBe(0);

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence).toBeNull();
  });

  // Test 70: SAFETY SWITCH VERIFICATION
  it('70: global and per-camera automation switches safely suppress movement while keeping recognition functional', async () => {
    const resident = await createTestResident('R_SWITCH_1', PresenceState.OUT);

    // Disable globally
    movementDecisionService.setGlobalAutomation(false);

    const obs1 = createObservation(inCameraId, resident, 'MATCH');
    const decision1 = await movementDecisionService.evaluateObservation(obs1);

    expect(decision1.status).toBe('AUTOMATION_DISABLED');
    expect(decision1.reason).toContain('disabled globally');

    // Re-enable globally
    movementDecisionService.setGlobalAutomation(true);

    // Disable specifically for inCamera via configMetadata
    await testPrisma.camera.update({
      where: { id: inCameraId },
      data: { configMetadata: { movementAutomationEnabled: false } },
    });

    const obs2 = createObservation(inCameraId, resident, 'MATCH');
    const decision2 = await movementDecisionService.evaluateObservation(obs2);

    expect(decision2.status).toBe('AUTOMATION_DISABLED');
    expect(decision2.reason).toContain('disabled for camera');

    // Restore camera automation
    await testPrisma.camera.update({
      where: { id: inCameraId },
      data: { configMetadata: { movementAutomationEnabled: true } },
    });

    const obs3 = createObservation(inCameraId, resident, 'MATCH');
    const decision3 = await movementDecisionService.evaluateObservation(obs3);
    expect(decision3.status).toBe('MOVEMENT_CREATED');
  });

  // Privacy verification: MovementEvent does NOT store embeddings, templates, or face crops
  it('strictly verifies MovementEvent never stores embeddings, face crops, or vectors', async () => {
    const resident = await createTestResident('R_PRIV_1', PresenceState.OUT);
    const obs = createObservation(inCameraId, resident, 'MATCH');

    const decision = await movementDecisionService.evaluateObservation(obs);
    expect(decision.status).toBe('MOVEMENT_CREATED');

    const event = await testPrisma.movementEvent.findUniqueOrThrow({
      where: { id: decision.movementEventId },
    });

    const stringified = JSON.stringify(event);
    expect(stringified).not.toContain('vector');
    expect(stringified).not.toContain('embedding');
    expect(stringified).not.toContain('templateReference');
    expect(event.source).toBe(MovementSource.FACE_RECOGNITION);
    expect(event.recognitionReference).toBe(obs.id);
  });

  // API Integration Tests
  describe('Movement REST API Endpoints', () => {
    it('GET /api/v1/movements returns paginated movements for authorized Warden', async () => {
      const resident = await createTestResident('R_API_1', PresenceState.OUT);
      const obs = createObservation(inCameraId, resident, 'MATCH');
      await movementDecisionService.evaluateObservation(obs);

      const res = await request(app)
        .get('/api/v1/movements')
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].resident.residentCode).toBe('R_API_1');
      expect(res.body.data[0].movementType).toBe('IN');
      expect(res.body.data[0].source).toBe('FACE_RECOGNITION');
      expect(res.body.total).toBe(1);
    });

    it('GET /api/v1/residents/:id/presence returns authoritative presence state', async () => {
      const resident = await createTestResident('R_PRES_1', PresenceState.OUT);

      const res = await request(app)
        .get(`/api/v1/residents/${resident.id}/presence`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.currentState).toBe('OUT');
      expect(res.body.resident.residentCode).toBe('R_PRES_1');
    });

    it('GET /api/v1/movements/presence-counts returns accurate hostel-wide counts', async () => {
      await createTestResident('R_CNT_1', PresenceState.IN);
      await createTestResident('R_CNT_2', PresenceState.IN);
      await createTestResident('R_CNT_3', PresenceState.OUT);

      const res = await request(app)
        .get('/api/v1/movements/presence-counts')
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.currentlyIn).toBe(2);
      expect(res.body.currentlyOut).toBe(1);
      expect(res.body.totalResidents).toBe(3);
    });

    it('GET /api/v1/movements/automation-status is readable by all authenticated roles', async () => {
      const getRes = await request(app)
        .get('/api/v1/movements/automation-status')
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.globalAutomationEnabled).toBe(true);
    });

    it('PATCH /api/v1/movements/automation-status: ADMIN can toggle global automation', async () => {
      const res = await request(app)
        .patch('/api/v1/movements/automation-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.globalAutomationEnabled).toBe(false);

      // Re-enable
      await request(app)
        .patch('/api/v1/movements/automation-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: true });
    });

    it('PATCH /api/v1/movements/automation-status: GUARD is forbidden (403)', async () => {
      const res = await request(app)
        .patch('/api/v1/movements/automation-status')
        .set('Authorization', `Bearer ${guardToken}`)
        .send({ enabled: false });

      expect(res.status).toBe(403);
    });

    it('PATCH /api/v1/movements/automation-status: WARDEN is forbidden (403) — global toggle is ADMIN only', async () => {
      const res = await request(app)
        .patch('/api/v1/movements/automation-status')
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({ enabled: false });

      expect(res.status).toBe(403);
      // Automation state must NOT have changed
      const statusRes = await request(app)
        .get('/api/v1/movements/automation-status')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(statusRes.body.globalAutomationEnabled).toBe(true);
    });
  });
});
