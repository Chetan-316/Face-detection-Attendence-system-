import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase, verifyTestDatabaseSafety } from './helpers/test-db';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { NightAttendanceService } from '../src/modules/night-attendance/night-attendance.service';
import {
  PresenceState,
  MovementType,
  MovementSource,
  StaffRole,
  CameraSourceType,
  LocationType,
  AttendanceSessionType,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
} from '@prisma/client';
import {
  DomainIntegrityError,
  InvalidStateTransitionError,
  PermissionDeniedError,
  ValidationError,
  ConflictError,
} from '../src/common/errors';
import { runSeed } from '../prisma/seed';

describe('Step 01.1 Domain Integrity & Hardening Tests', () => {
  let movementService: MovementService;
  let residentService: ResidentService;
  let attendanceService: AttendanceService;
  let nightAttendanceService: NightAttendanceService;

  let orgAId: string;
  let orgBId: string;
  let hostelAId: string;
  let hostelBId: string;
  let locationAId: string;
  let locationBId: string;
  let cameraAId: string;
  let cameraBId: string;
  let disabledCameraAId: string;

  let wardenAId: string;
  let guardAId: string;
  let wardenBId: string;
  let guardBId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    movementService = new MovementService(testPrisma);
    residentService = new ResidentService(testPrisma);
    attendanceService = new AttendanceService(testPrisma);
    nightAttendanceService = new NightAttendanceService(testPrisma);

    // Setup Org A and Org B
    const orgA = await testPrisma.organization.create({
      data: { code: 'ORG_A', name: 'Organization Alpha' },
    });
    orgAId = orgA.id;

    const orgB = await testPrisma.organization.create({
      data: { code: 'ORG_B', name: 'Organization Beta' },
    });
    orgBId = orgB.id;

    // Hostels
    const hostelA = await testPrisma.hostel.create({
      data: { organizationId: orgAId, code: 'HOSTEL_A', name: 'Hostel Alpha' },
    });
    hostelAId = hostelA.id;

    const hostelB = await testPrisma.hostel.create({
      data: { organizationId: orgAId, code: 'HOSTEL_B', name: 'Hostel Beta' },
    });
    hostelBId = hostelB.id;

    // Locations
    const locA = await testPrisma.location.create({
      data: { hostelId: hostelAId, code: 'GATE_A', name: 'Gate A', locationType: LocationType.GATE },
    });
    locationAId = locA.id;

    const locB = await testPrisma.location.create({
      data: { hostelId: hostelBId, code: 'GATE_B', name: 'Gate B', locationType: LocationType.GATE },
    });
    locationBId = locB.id;

    // Cameras
    const camA = await testPrisma.camera.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelAId,
        locationId: locationAId,
        name: 'Cam Gate A',
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: true,
      },
    });
    cameraAId = camA.id;

    const camB = await testPrisma.camera.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelBId,
        locationId: locationBId,
        name: 'Cam Gate B',
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: true,
      },
    });
    cameraBId = camB.id;

    const disCamA = await testPrisma.camera.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelAId,
        name: 'Disabled Cam A',
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: false,
      },
    });
    disabledCameraAId = disCamA.id;

    // Staff Users
    const wardenA = await testPrisma.user.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelAId,
        username: 'warden_a',
        fullName: 'Warden Alpha',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    wardenAId = wardenA.id;

    const guardA = await testPrisma.user.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelAId,
        username: 'guard_a',
        fullName: 'Guard Alpha',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardAId = guardA.id;

    const wardenB = await testPrisma.user.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelBId,
        username: 'warden_b',
        fullName: 'Warden Beta',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    wardenBId = wardenB.id;

    const guardB = await testPrisma.user.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelBId,
        username: 'guard_b',
        fullName: 'Guard Beta',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardBId = guardB.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  // ---------------------------------------------------------------
  // 1. Cross-Hostel Movement Integrity
  // ---------------------------------------------------------------
  it('rejects normal movement when resident belongs to Hostel A but movement requested for Hostel B', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_CROSS_1',
      fullName: 'Hostel A Resident',
      roomGroup: 'A-101',
      initialPresence: PresenceState.IN,
    });

    const initialEventCount = await testPrisma.movementEvent.count();
    const initialAuditCount = await testPrisma.auditLog.count();

    await expect(
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelBId, // Mismatched Hostel B!
        movementType: MovementType.OUT,
        source: MovementSource.GUARD_CONFIRMATION,
        performedByUserId: guardAId,
        performedByRole: StaffRole.GUARD,
      })
    ).rejects.toThrow(DomainIntegrityError);

    // Verify zero side effects
    expect(await testPrisma.movementEvent.count()).toBe(initialEventCount);
    expect(await testPrisma.auditLog.count()).toBe(initialAuditCount);
    const presence = await testPrisma.residentPresence.findUnique({ where: { residentId: resident.id } });
    expect(presence?.currentState).toBe(PresenceState.IN);
  });

  it('rejects Warden correction when resident belongs to Hostel A but correction requested for Hostel B', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_CROSS_2',
      fullName: 'Hostel A Resident 2',
      roomGroup: 'A-102',
      initialPresence: PresenceState.OUT,
    });

    const initialEventCount = await testPrisma.movementEvent.count();
    const initialCorrectionCount = await testPrisma.movementCorrection.count();

    await expect(
      movementService.executeWardenCorrection({
        residentId: resident.id,
        targetState: PresenceState.IN,
        hostelId: hostelBId, // Mismatched Hostel B!
        effectiveTimestamp: new Date(Date.now() - 10 * 60 * 1000),
        reason: 'Attempted cross-hostel correction',
        authorizedByUserId: wardenAId,
        authorizedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(DomainIntegrityError);

    expect(await testPrisma.movementEvent.count()).toBe(initialEventCount);
    expect(await testPrisma.movementCorrection.count()).toBe(initialCorrectionCount);
    const presence = await testPrisma.residentPresence.findUnique({ where: { residentId: resident.id } });
    expect(presence?.currentState).toBe(PresenceState.OUT);
  });

  // ---------------------------------------------------------------
  // 2. Camera Integrity
  // ---------------------------------------------------------------
  it('rejects movement using a camera belonging to a different hostel', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_CAM_1',
      fullName: 'Camera Test Resident',
      roomGroup: 'A-103',
      initialPresence: PresenceState.IN,
    });

    await expect(
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelAId,
        cameraId: cameraBId, // Camera from Hostel B!
        movementType: MovementType.OUT,
        source: MovementSource.FACE_RECOGNITION,
      })
    ).rejects.toThrow(DomainIntegrityError);
  });

  it('rejects movement using a disabled camera', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_CAM_DIS',
      fullName: 'Disabled Cam Resident',
      roomGroup: 'A-104',
      initialPresence: PresenceState.IN,
    });

    await expect(
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelAId,
        cameraId: disabledCameraAId, // Disabled camera
        movementType: MovementType.OUT,
        source: MovementSource.FACE_RECOGNITION,
      })
    ).rejects.toThrow(ValidationError);
  });

  // ---------------------------------------------------------------
  // 3. Location Integrity
  // ---------------------------------------------------------------
  it('rejects movement using a location belonging to another hostel', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_LOC_1',
      fullName: 'Location Test Resident',
      roomGroup: 'A-105',
      initialPresence: PresenceState.IN,
    });

    await expect(
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelAId,
        locationId: locationBId, // Gate B belongs to Hostel B!
        movementType: MovementType.OUT,
        source: MovementSource.GUARD_CONFIRMATION,
      })
    ).rejects.toThrow(DomainIntegrityError);
  });

  it('rejects attendance session creation using a location from another hostel', async () => {
    await expect(
      attendanceService.createSession({
        organizationId: orgAId,
        hostelId: hostelAId,
        locationId: locationBId, // Location from Hostel B!
        sessionType: AttendanceSessionType.GENERAL,
        title: 'Invalid Location Session',
        createdByUserId: wardenAId,
        createdByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(DomainIntegrityError);
  });

  // ---------------------------------------------------------------
  // 4. Attendance Cross-Hostel & Cross-Organization Integrity
  // ---------------------------------------------------------------
  it('rejects marking attendance for a resident belonging to Hostel B in Hostel A session', async () => {
    const residentB = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelBId,
      residentCode: 'R_B_ATT',
      fullName: 'Resident in Hostel B',
      roomGroup: 'B-101',
    });

    const sessionA = await attendanceService.createSession({
      organizationId: orgAId,
      hostelId: hostelAId,
      sessionType: AttendanceSessionType.GENERAL,
      title: 'Hostel A Morning Roll Call',
      createdByUserId: wardenAId,
      createdByRole: StaffRole.WARDEN,
    });
    await attendanceService.startSession(sessionA.id, wardenAId, StaffRole.WARDEN);

    await expect(
      attendanceService.markAttendance({
        sessionId: sessionA.id,
        residentId: residentB.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.MANUAL_STAFF,
        markedByUserId: wardenAId,
      })
    ).rejects.toThrow(DomainIntegrityError);
  });

  it('rejects attendance session creation when Hostel belongs to a different organization', async () => {
    await expect(
      attendanceService.createSession({
        organizationId: orgBId, // Org B
        hostelId: hostelAId,    // Hostel A belongs to Org A!
        sessionType: AttendanceSessionType.GENERAL,
        title: 'Mismatched Org Session',
        createdByUserId: wardenAId,
        createdByRole: StaffRole.ADMIN,
      })
    ).rejects.toThrow(DomainIntegrityError);
  });

  // ---------------------------------------------------------------
  // 5. Same-State Warden Correction Rejection
  // ---------------------------------------------------------------
  it('strictly rejects IN -> IN Warden correction', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_SAME_IN',
      fullName: 'Same State In Resident',
      roomGroup: 'A-106',
      initialPresence: PresenceState.IN,
    });

    await expect(
      movementService.executeWardenCorrection({
        residentId: resident.id,
        targetState: PresenceState.IN, // Already IN!
        hostelId: hostelAId,
        effectiveTimestamp: new Date(Date.now() - 10 * 60 * 1000),
        reason: 'Attempting invalid same-state correction',
        authorizedByUserId: wardenAId,
        authorizedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it('strictly rejects OUT -> OUT Warden correction', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_SAME_OUT',
      fullName: 'Same State Out Resident',
      roomGroup: 'A-107',
      initialPresence: PresenceState.OUT,
    });

    await expect(
      movementService.executeWardenCorrection({
        residentId: resident.id,
        targetState: PresenceState.OUT, // Already OUT!
        hostelId: hostelAId,
        effectiveTimestamp: new Date(Date.now() - 10 * 60 * 1000),
        reason: 'Attempting invalid same-state correction',
        authorizedByUserId: wardenAId,
        authorizedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  // ---------------------------------------------------------------
  // 6. Night Attendance Atomicity & Safety
  // ---------------------------------------------------------------
  it('blocks cross-hostel resident in Night Attendance session', async () => {
    const residentB = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelBId,
      residentCode: 'R_NIGHT_CROSS',
      fullName: 'Cross Night Resident',
      roomGroup: 'B-102',
      initialPresence: PresenceState.IN,
    });

    const sessionA = await attendanceService.createSession({
      organizationId: orgAId,
      hostelId: hostelAId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Hostel A Night Curfew',
      createdByUserId: wardenAId,
      createdByRole: StaffRole.WARDEN,
    });
    await attendanceService.startSession(sessionA.id, wardenAId, StaffRole.WARDEN);

    await expect(
      nightAttendanceService.markNightAttendancePresent({
        sessionId: sessionA.id,
        residentId: residentB.id,
        markedByUserId: wardenAId,
        markedByRole: StaffRole.WARDEN,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      })
    ).rejects.toThrow(DomainIntegrityError);
  });

  it('rejects duplicate Night Attendance before mutating movement/presence in missed-IN workflow', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_NIGHT_PRE_DUP',
      fullName: 'Pre Duplicate Candidate',
      roomGroup: 'A-108',
      initialPresence: PresenceState.IN,
    });

    const session = await attendanceService.createSession({
      organizationId: orgAId,
      hostelId: hostelAId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Pre-check Night Session',
      createdByUserId: wardenAId,
      createdByRole: StaffRole.WARDEN,
    });
    await attendanceService.startSession(session.id, wardenAId, StaffRole.WARDEN);

    // First mark attendance as PRESENT
    await nightAttendanceService.markNightAttendancePresent({
      sessionId: session.id,
      residentId: resident.id,
      markedByUserId: wardenAId,
      markedByRole: StaffRole.WARDEN,
      markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
    });

    // Manually set resident presence to OUT (e.g. resident went out and came back)
    await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelAId,
      movementType: MovementType.OUT,
      source: MovementSource.GUARD_CONFIRMATION,
    });

    const initialCorrectionCount = await testPrisma.movementCorrection.count();

    // Now attempt missed IN resolution on the session where resident is ALREADY marked:
    await expect(
      nightAttendanceService.resolveMissedInAndMarkPresent({
        sessionId: session.id,
        residentId: resident.id,
        effectiveReturnTime: new Date(Date.now() - 5 * 60 * 1000),
        correctionReason: 'Warden attempts duplicate resolution',
        wardenUserId: wardenAId,
        wardenRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(ConflictError);

    // Verify pre-check prevented any mutation: presence remains OUT, no correction created!
    const presence = await testPrisma.residentPresence.findUnique({ where: { residentId: resident.id } });
    expect(presence?.currentState).toBe(PresenceState.OUT);
    expect(await testPrisma.movementCorrection.count()).toBe(initialCorrectionCount);
  });

  it('guarantees complete atomic rollback if attendance record insertion fails during missed-IN resolution', async () => {
    const resident = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelAId,
      residentCode: 'R_ATOMIC_ROLLBACK',
      fullName: 'Atomic Rollback Test',
      roomGroup: 'A-109',
      initialPresence: PresenceState.OUT,
    });

    const session = await attendanceService.createSession({
      organizationId: orgAId,
      hostelId: hostelAId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Atomic Rollback Session',
      createdByUserId: wardenAId,
      createdByRole: StaffRole.WARDEN,
    });
    await attendanceService.startSession(session.id, wardenAId, StaffRole.WARDEN);

    // Pre-insert an attendance record directly to trigger unique constraint failure on insert
    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: resident.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.MANUAL_STAFF,
      },
    });

    const initialEventCount = await testPrisma.movementEvent.count();
    const initialCorrectionCount = await testPrisma.movementCorrection.count();

    // Trigger resolveMissedInAndMarkPresent -> pre-check catches or insertion fails
    await expect(
      nightAttendanceService.resolveMissedInAndMarkPresent({
        sessionId: session.id,
        residentId: resident.id,
        effectiveReturnTime: new Date(Date.now() - 10 * 60 * 1000),
        correctionReason: 'Warden attempting atomic test',
        wardenUserId: wardenAId,
        wardenRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow();

    // VERIFY ATOMICITY: No correction created, no movement event created, presence remains OUT!
    expect(await testPrisma.movementEvent.count()).toBe(initialEventCount);
    expect(await testPrisma.movementCorrection.count()).toBe(initialCorrectionCount);
    const presence = await testPrisma.residentPresence.findUnique({ where: { residentId: resident.id } });
    expect(presence?.currentState).toBe(PresenceState.OUT);
  });

  // ---------------------------------------------------------------
  // 7. Staff Scope & Boundary Enforcement
  // ---------------------------------------------------------------
  it('forbids Guard assigned to Hostel A from operating on Hostel B', async () => {
    const residentB = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelBId,
      residentCode: 'R_GUARD_SCOPE',
      fullName: 'Hostel B Resident',
      roomGroup: 'B-103',
      initialPresence: PresenceState.IN,
    });

    await expect(
      movementService.recordNormalMovement({
        residentId: residentB.id,
        hostelId: hostelBId,
        movementType: MovementType.OUT,
        source: MovementSource.GUARD_CONFIRMATION,
        performedByUserId: guardAId, // Guard A is assigned to Hostel A!
        performedByRole: StaffRole.GUARD,
      })
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('forbids Warden assigned to Hostel A from executing correction on Hostel B', async () => {
    const residentB = await residentService.createResident({
      organizationId: orgAId,
      hostelId: hostelBId,
      residentCode: 'R_WARDEN_SCOPE',
      fullName: 'Hostel B Resident 2',
      roomGroup: 'B-104',
      initialPresence: PresenceState.OUT,
    });

    await expect(
      movementService.executeWardenCorrection({
        residentId: residentB.id,
        targetState: PresenceState.IN,
        hostelId: hostelBId,
        effectiveTimestamp: new Date(Date.now() - 5 * 60 * 1000),
        reason: 'Cross hostel warden unauthorized correction',
        authorizedByUserId: wardenAId, // Warden A is assigned to Hostel A!
        authorizedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(PermissionDeniedError);
  });

  // ---------------------------------------------------------------
  // 8. Seed & Test DB Safety
  // ---------------------------------------------------------------
  it('verifies that test database safety guard refuses non-test database targets', () => {
    expect(() => {
      verifyTestDatabaseSafety('postgresql://postgres:secret@localhost:5432/pravahax_production');
    }).toThrow(/SAFETY ERROR: Refusing to connect tests to unsafe database/);

    expect(() => {
      verifyTestDatabaseSafety(
        'postgresql://postgres:secret@localhost:5432/pravahax_test_db',
        'postgresql://postgres:secret@localhost:5432/pravahax_test_db'
      );
    }).toThrow(/SAFETY ERROR: TEST_DATABASE_URL cannot be identical to DATABASE_URL/);
  });

  it('verifies that seed safety guard refuses to run in production', async () => {
    const originalEnv = process.env.APP_ENV;
    process.env.APP_ENV = 'production';

    try {
      await expect(runSeed()).rejects.toThrow(
        /SAFETY ERROR: Destructive database seed is prohibited in production/
      );
    } finally {
      process.env.APP_ENV = originalEnv;
    }
  });
});
