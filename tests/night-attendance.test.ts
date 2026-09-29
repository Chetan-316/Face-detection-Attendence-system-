import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { NightAttendanceService } from '../src/modules/night-attendance/night-attendance.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import {
  AttendanceSessionType,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
  StaffRole,
  PresenceState,
  MovementSource,
} from '@prisma/client';
import { AttendanceRuleViolationError, PermissionDeniedError } from '../src/common/errors';

describe('General Hostel Night Attendance Workflow Tests', () => {
  let nightAttendanceService: NightAttendanceService;
  let attendanceService: AttendanceService;
  let residentService: ResidentService;
  let orgId: string;
  let hostelId: string;
  let wardenUserId: string;
  let guardUserId: string;
  let nightSessionId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    nightAttendanceService = new NightAttendanceService(testPrisma);
    attendanceService = new AttendanceService(testPrisma);
    residentService = new ResidentService(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'NIGHT_ORG', name: 'Night Attendance Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'NIGHT_HOSTEL', name: 'Night Attendance Hostel' },
    });
    hostelId = hostel.id;

    const warden = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'warden_night',
        fullName: 'Night Warden',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    wardenUserId = warden.id;

    const guard = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'guard_night',
        fullName: 'Night Guard',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardUserId = guard.id;

    // Create and activate Night Attendance session
    const session = await attendanceService.createSession({
      organizationId: orgId,
      hostelId: hostelId,
      sessionType: AttendanceSessionType.NIGHT,
      title: 'Night Curfew Attendance 21:30',
      startTime: new Date('2026-09-29T21:30:00Z'),
      createdByUserId: wardenUserId,
      createdByRole: StaffRole.WARDEN,
    });
    const active = await attendanceService.startSession(session.id, wardenUserId, StaffRole.WARDEN);
    nightSessionId = active.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('allows resident currently IN to be marked PRESENT during Night Attendance', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_NIGHT_IN',
      fullName: 'Resident Safely Inside',
      roomGroup: '101',
      initialPresence: PresenceState.IN,
    });

    const record = await nightAttendanceService.markNightAttendancePresent({
      sessionId: nightSessionId,
      residentId: resident.id,
      markedByUserId: wardenUserId,
      markedByRole: StaffRole.WARDEN,
      markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
    });

    expect(record.status).toBe(AttendanceRecordStatus.PRESENT);
  });

  it('strictly blocks resident currently OUT from automatically being marked PRESENT in Night Attendance', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_NIGHT_OUT',
      fullName: 'Resident Recorded As Out',
      roomGroup: '102',
      initialPresence: PresenceState.OUT,
    });

    // Even if face recognition or staff attempts to mark PRESENT, it must be BLOCKED
    await expect(
      nightAttendanceService.markNightAttendancePresent({
        sessionId: nightSessionId,
        residentId: resident.id,
        markedByUserId: guardUserId,
        markedByRole: StaffRole.GUARD,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      })
    ).rejects.toThrow(AttendanceRuleViolationError);

    // No attendance record created
    const record = await testPrisma.attendanceRecord.findUnique({
      where: {
        attendanceSessionId_residentId: {
          attendanceSessionId: nightSessionId,
          residentId: resident.id,
        },
      },
    });
    expect(record).toBeNull();
  });

  it('strictly forbids Guard from overriding or resolving missed IN night attendance', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_NIGHT_GUARD_FAIL',
      fullName: 'Resident Guard Override Fail',
      roomGroup: '103',
      initialPresence: PresenceState.OUT,
    });

    await expect(
      nightAttendanceService.resolveMissedInAndMarkPresent({
        sessionId: nightSessionId,
        residentId: resident.id,
        effectiveReturnTime: new Date('2026-09-29T21:15:00Z'),
        correctionReason: 'Guard attempting to override missed IN',
        wardenUserId: guardUserId,
        wardenRole: StaffRole.GUARD,
      })
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('allows Warden to correct missed IN with reason, updates presence to IN, and completes Night Attendance', async () => {
    // 1. Resident R004 is currently recorded as OUT
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R004_TEST',
      fullName: 'Taylor Singh',
      roomGroup: 'Room 104',
      initialPresence: PresenceState.OUT,
    });

    // 2. Night Attendance attempts automatic mark -> blocked
    await expect(
      nightAttendanceService.markNightAttendancePresent({
        sessionId: nightSessionId,
        residentId: resident.id,
        markedByUserId: wardenUserId,
        markedByRole: StaffRole.WARDEN,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      })
    ).rejects.toThrow(AttendanceRuleViolationError);

    // 3. Warden verifies resident in person and resolves missed IN with return time and reason
    const result = await nightAttendanceService.resolveMissedInAndMarkPresent({
      sessionId: nightSessionId,
      residentId: resident.id,
      effectiveReturnTime: new Date('2026-09-29T20:15:00Z'),
      correctionReason: 'Resident physically entered with library group at 20:15; gate entry scan was missed',
      wardenUserId: wardenUserId,
      wardenRole: StaffRole.WARDEN,
    });

    // 4. Movement event was created with source WARDEN_CORRECTION
    expect(result.movementEvent.movementType).toBe('IN');
    expect(result.movementEvent.source).toBe(MovementSource.WARDEN_CORRECTION);
    expect(result.movementEvent.isCorrection).toBe(true);

    // 5. Current presence updated to IN
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);

    // 6. Attendance record created as CORRECTED_PRESENT
    expect(result.attendanceRecord.status).toBe(AttendanceRecordStatus.CORRECTED_PRESENT);

    // 7. Audit log verified
    const auditLogs = await testPrisma.auditLog.findMany({
      where: { performedByUserId: wardenUserId },
    });
    expect(auditLogs.length).toBeGreaterThan(0);
    const correctionAudit = auditLogs.find((a) => a.action === 'CORRECTION');
    expect(correctionAudit?.reason).toContain('Resident physically entered with library group');
  });
});
