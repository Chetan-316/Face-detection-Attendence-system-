import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import {
  AttendanceSessionType,
  AttendanceSessionStatus,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
  StaffRole,
} from '@prisma/client';
import { ConflictError } from '../src/common/errors';

describe('Attendance Session & Record Domain Tests', () => {
  let attendanceService: AttendanceService;
  let residentService: ResidentService;
  let orgId: string;
  let hostelId: string;
  let staffUserId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    attendanceService = new AttendanceService(testPrisma);
    residentService = new ResidentService(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'ATT_ORG', name: 'Attendance Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'ATT_HOSTEL', name: 'Attendance Hostel' },
    });
    hostelId = hostel.id;

    const user = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'warden_att',
        fullName: 'Warden Att',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    staffUserId = user.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('manages attendance session lifecycle from DRAFT -> ACTIVE -> CLOSED', async () => {
    // 1. Create session (DRAFT)
    const session = await attendanceService.createSession({
      organizationId: orgId,
      hostelId: hostelId,
      sessionType: AttendanceSessionType.GENERAL,
      title: 'Daily General Attendance',
      createdByUserId: staffUserId,
      createdByRole: StaffRole.WARDEN,
    });
    expect(session.status).toBe(AttendanceSessionStatus.DRAFT);

    // 2. Start session (ACTIVE)
    const activeSession = await attendanceService.startSession(
      session.id,
      staffUserId,
      StaffRole.WARDEN
    );
    expect(activeSession.status).toBe(AttendanceSessionStatus.ACTIVE);

    // 3. Close session (CLOSED)
    const closedSession = await attendanceService.closeSession(
      session.id,
      staffUserId,
      StaffRole.WARDEN
    );
    expect(closedSession.status).toBe(AttendanceSessionStatus.CLOSED);
    expect(closedSession.endTime).not.toBeNull();
  });

  it('marks resident attendance and strictly rejects duplicate attendance in the same session', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_ATT_1',
      fullName: 'Attendance Candidate',
      roomGroup: '101',
    });

    const session = await attendanceService.createSession({
      organizationId: orgId,
      hostelId: hostelId,
      sessionType: AttendanceSessionType.GENERAL,
      title: 'Afternoon Roll Call',
      createdByUserId: staffUserId,
      createdByRole: StaffRole.WARDEN,
    });
    await attendanceService.startSession(session.id, staffUserId, StaffRole.WARDEN);

    // First mark succeeds
    const record = await attendanceService.markAttendance({
      sessionId: session.id,
      residentId: resident.id,
      status: AttendanceRecordStatus.PRESENT,
      markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      markedByUserId: staffUserId,
    });
    expect(record.status).toBe(AttendanceRecordStatus.PRESENT);

    // Second mark in the same session MUST fail with ConflictError
    await expect(
      attendanceService.markAttendance({
        sessionId: session.id,
        residentId: resident.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        markedByUserId: staffUserId,
      })
    ).rejects.toThrow(ConflictError);
  });
});
