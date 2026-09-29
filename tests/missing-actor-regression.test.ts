import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { MovementService } from '../src/modules/movements/movement.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { NightAttendanceService } from '../src/modules/night-attendance/night-attendance.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import {
  MovementType,
  MovementSource,
  PresenceState,
  StaffRole,
  AttendanceSessionType,
  AttendanceMarkMethod,
  AttendanceRecordStatus,
} from '@prisma/client';
import { NotFoundError } from '../src/common/errors';

describe('Missing Actor Regression Tests (Gap Fix)', () => {
  let movementService: MovementService;
  let attendanceService: AttendanceService;
  let nightAttendanceService: NightAttendanceService;
  let residentService: ResidentService;

  let testOrgId: string;
  let testHostelId: string;
  let residentId: string;
  const nonexistentUserId = '00000000-0000-0000-0000-000000000000';

  beforeEach(async () => {
    await resetTestDatabase();
    movementService = new MovementService(testPrisma);
    attendanceService = new AttendanceService(testPrisma);
    nightAttendanceService = new NightAttendanceService(testPrisma);
    residentService = new ResidentService(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'REG_ORG', name: 'Regression Org' },
    });
    testOrgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'REG_HOSTEL', name: 'Regression Hostel' },
    });
    testHostelId = hostel.id;

    const resident = await residentService.createResident({
      organizationId: testOrgId,
      hostelId: testHostelId,
      residentCode: 'R_REG_01',
      fullName: 'Regression Resident',
      roomGroup: 'Room 101',
      initialPresence: PresenceState.OUT,
    });
    residentId = resident.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('rejects normal movement when performedByUserId does not exist', async () => {
    await expect(
      movementService.recordNormalMovement({
        residentId,
        hostelId: testHostelId,
        movementType: MovementType.IN,
        source: MovementSource.GUARD_CONFIRMATION,
        performedByUserId: nonexistentUserId,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects warden correction when authorizedByUserId does not exist', async () => {
    await expect(
      movementService.executeWardenCorrection({
        residentId,
        targetState: PresenceState.IN,
        hostelId: testHostelId,
        effectiveTimestamp: new Date(),
        reason: 'Missed tap IN',
        authorizedByUserId: nonexistentUserId,
        authorizedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects attendance session creation when createdByUserId does not exist', async () => {
    await expect(
      attendanceService.createSession({
        organizationId: testOrgId,
        hostelId: testHostelId,
        sessionType: AttendanceSessionType.GENERAL,
        title: 'Morning Rollcall',
        createdByUserId: nonexistentUserId,
        createdByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects starting attendance session when startedByUserId does not exist', async () => {
    // Create a real warden to create session
    const warden = await testPrisma.user.create({
      data: {
        organizationId: testOrgId,
        hostelId: testHostelId,
        username: 'warden_start',
        fullName: 'Warden Starter',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    const session = await attendanceService.createSession({
      organizationId: testOrgId,
      hostelId: testHostelId,
      sessionType: AttendanceSessionType.GENERAL,
      title: 'Draft Rollcall',
      createdByUserId: warden.id,
      createdByRole: StaffRole.WARDEN,
    });

    await expect(
      attendanceService.startSession(session.id, nonexistentUserId, StaffRole.WARDEN)
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects closing attendance session when closedByUserId does not exist', async () => {
    const warden = await testPrisma.user.create({
      data: {
        organizationId: testOrgId,
        hostelId: testHostelId,
        username: 'warden_close',
        fullName: 'Warden Closer',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    const session = await attendanceService.createSession({
      organizationId: testOrgId,
      hostelId: testHostelId,
      sessionType: AttendanceSessionType.GENERAL,
      title: 'Active Rollcall',
      createdByUserId: warden.id,
      createdByRole: StaffRole.WARDEN,
    });

    await attendanceService.startSession(session.id, warden.id, StaffRole.WARDEN);

    await expect(
      attendanceService.closeSession(session.id, nonexistentUserId, StaffRole.WARDEN)
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects marking attendance when markedByUserId does not exist', async () => {
    const warden = await testPrisma.user.create({
      data: {
        organizationId: testOrgId,
        hostelId: testHostelId,
        username: 'warden_mark',
        fullName: 'Warden Marker',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    const session = await attendanceService.createSession({
      organizationId: testOrgId,
      hostelId: testHostelId,
      sessionType: AttendanceSessionType.GENERAL,
      title: 'Rollcall To Mark',
      createdByUserId: warden.id,
      createdByRole: StaffRole.WARDEN,
    });

    await attendanceService.startSession(session.id, warden.id, StaffRole.WARDEN);

    await expect(
      attendanceService.markAttendance({
        sessionId: session.id,
        residentId,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.MANUAL_STAFF,
        markedByUserId: nonexistentUserId,
        markedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects night attendance mark when markedByUserId does not exist', async () => {
    const warden = await testPrisma.user.create({
      data: {
        organizationId: testOrgId,
        hostelId: testHostelId,
        username: 'warden_night',
        fullName: 'Warden Night',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    const session = await attendanceService.createSession({
      organizationId: testOrgId,
      hostelId: testHostelId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Night Attendance',
      createdByUserId: warden.id,
      createdByRole: StaffRole.WARDEN,
    });

    await attendanceService.startSession(session.id, warden.id, StaffRole.WARDEN);

    // Set resident to IN
    await testPrisma.residentPresence.update({
      where: { residentId },
      data: { currentState: PresenceState.IN },
    });

    await expect(
      nightAttendanceService.markNightAttendancePresent({
        sessionId: session.id,
        residentId,
        markedByUserId: nonexistentUserId,
        markedByRole: StaffRole.WARDEN,
        markMethod: AttendanceMarkMethod.MANUAL_STAFF,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects night attendance resolve missed IN when wardenUserId does not exist', async () => {
    const warden = await testPrisma.user.create({
      data: {
        organizationId: testOrgId,
        hostelId: testHostelId,
        username: 'warden_resolve',
        fullName: 'Warden Resolver',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    const session = await attendanceService.createSession({
      organizationId: testOrgId,
      hostelId: testHostelId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Night Attendance Resolve',
      createdByUserId: warden.id,
      createdByRole: StaffRole.WARDEN,
    });

    await attendanceService.startSession(session.id, warden.id, StaffRole.WARDEN);

    await expect(
      nightAttendanceService.resolveMissedInAndMarkPresent({
        sessionId: session.id,
        residentId,
        effectiveReturnTime: new Date(),
        correctionReason: 'Gate forgot tap',
        wardenUserId: nonexistentUserId,
        wardenRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects resident creation when performedByUserId does not exist', async () => {
    await expect(
      residentService.createResident({
        organizationId: testOrgId,
        hostelId: testHostelId,
        residentCode: 'R_FAIL_CREATE',
        fullName: 'Fail Resident',
        roomGroup: 'Room 999',
        performedByUserId: nonexistentUserId,
        performedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects resident update when actor does not exist', async () => {
    await expect(
      residentService.updateResident(
        residentId,
        { fullName: 'New Name' },
        {
          id: nonexistentUserId,
          role: StaffRole.WARDEN,
          organizationId: testOrgId,
          hostelId: testHostelId,
        }
      )
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects resident deactivation when performedByUserId does not exist', async () => {
    await expect(
      residentService.deactivateResident(
        residentId,
        'Moving away',
        nonexistentUserId,
        StaffRole.WARDEN
      )
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects resident reactivation when performedByUserId does not exist', async () => {
    // First deactivate safely with valid warden
    const warden = await testPrisma.user.create({
      data: {
        organizationId: testOrgId,
        hostelId: testHostelId,
        username: 'warden_reactivate',
        fullName: 'Warden Reactivator',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    await residentService.deactivateResident(residentId, 'Temp leave', warden.id, StaffRole.WARDEN);

    await expect(
      residentService.reactivateResident(
        residentId,
        'Re-admitted',
        nonexistentUserId,
        StaffRole.WARDEN
      )
    ).rejects.toThrow(NotFoundError);
  });
});
