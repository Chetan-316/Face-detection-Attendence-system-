import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import {
  PresenceState,
  MovementType,
  MovementSource,
  StaffRole,
  AttendanceSessionType,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
} from '@prisma/client';
import { InvalidStateTransitionError } from '../src/common/errors';

describe('Movement & Presence Domain Tests', () => {
  let movementService: MovementService;
  let residentService: ResidentService;
  let attendanceService: AttendanceService;
  let orgId: string;
  let hostelId: string;
  let guardUserId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    movementService = new MovementService(testPrisma);
    residentService = new ResidentService(testPrisma);
    attendanceService = new AttendanceService(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'ORG_MOV', name: 'Movement Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H_MOV', name: 'Movement Hostel' },
    });
    hostelId = hostel.id;

    const guard = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'guard_test',
        fullName: 'Gate Guard',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardUserId = guard.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('should successfully record IN -> OUT movement and update presence', async () => {
    // Start with resident currently IN
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_MOV_1',
      fullName: 'Movement Resident 1',
      roomGroup: '101',
      initialPresence: PresenceState.IN,
    });

    const event = await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.OUT,
      source: MovementSource.GUARD_CONFIRMATION,
      performedByUserId: guardUserId,
      performedByRole: StaffRole.GUARD,
    });

    expect(event.movementType).toBe(MovementType.OUT);

    // Current presence must be OUT
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.OUT);
    expect(presence?.lastMovementEventId).toBe(event.id);
  });

  it('should successfully record OUT -> IN movement and update presence', async () => {
    // Start with resident currently OUT
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_MOV_2',
      fullName: 'Movement Resident 2',
      roomGroup: '102',
      initialPresence: PresenceState.OUT,
    });

    const event = await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.IN,
      source: MovementSource.GUARD_CONFIRMATION,
      performedByUserId: guardUserId,
      performedByRole: StaffRole.GUARD,
    });

    expect(event.movementType).toBe(MovementType.IN);

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);
    expect(presence?.lastMovementEventId).toBe(event.id);
  });

  it('should reject invalid IN -> IN transition', async () => {
    // Resident is currently IN
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_MOV_3',
      fullName: 'Movement Resident 3',
      roomGroup: '103',
      initialPresence: PresenceState.IN,
    });

    await expect(
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelId,
        movementType: MovementType.IN,
        source: MovementSource.GUARD_CONFIRMATION,
        performedByUserId: guardUserId,
        performedByRole: StaffRole.GUARD,
      })
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it('should reject invalid OUT -> OUT transition', async () => {
    // Resident is currently OUT
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_MOV_4',
      fullName: 'Movement Resident 4',
      roomGroup: '104',
      initialPresence: PresenceState.OUT,
    });

    await expect(
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelId,
        movementType: MovementType.OUT,
        source: MovementSource.GUARD_CONFIRMATION,
        performedByUserId: guardUserId,
        performedByRole: StaffRole.GUARD,
      })
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it('should preserve all movement history across sequential transitions', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_MOV_5',
      fullName: 'Movement Resident 5',
      roomGroup: '105',
      initialPresence: PresenceState.IN,
    });

    // 1. IN -> OUT
    await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.OUT,
      source: MovementSource.GUARD_CONFIRMATION,
      effectiveTimestamp: new Date('2026-09-29T10:00:00Z'),
    });

    // 2. OUT -> IN
    await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.IN,
      source: MovementSource.GUARD_CONFIRMATION,
      effectiveTimestamp: new Date('2026-09-29T12:00:00Z'),
    });

    // 3. IN -> OUT
    await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.OUT,
      source: MovementSource.GUARD_CONFIRMATION,
      effectiveTimestamp: new Date('2026-09-29T16:00:00Z'),
    });

    // History must contain all 3 events
    const history = await movementService.getResidentMovementHistory(resident.id);
    expect(history.length).toBe(3);
    expect(history[0].movementType).toBe(MovementType.OUT);
    expect(history[1].movementType).toBe(MovementType.IN);
    expect(history[2].movementType).toBe(MovementType.OUT);

    // Current presence must be OUT
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.OUT);
  });

  it('proves presence state is decoupled from attendance (Attendance=PRESENT, Presence=OUT)', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_MOV_6',
      fullName: 'Movement Resident 6',
      roomGroup: '106',
      initialPresence: PresenceState.IN,
    });

    // Warden creates and conducts attendance session in morning
    const session = await attendanceService.createSession({
      organizationId: orgId,
      hostelId: hostelId,
      sessionType: AttendanceSessionType.GENERAL,
      title: 'Morning Assembly',
      createdByUserId: guardUserId,
      createdByRole: StaffRole.ADMIN,
    });
    await attendanceService.startSession(session.id, guardUserId, StaffRole.ADMIN);

    // Resident attends session -> Marked PRESENT
    await attendanceService.markAttendance({
      sessionId: session.id,
      residentId: resident.id,
      status: AttendanceRecordStatus.PRESENT,
      markMethod: AttendanceMarkMethod.MANUAL_STAFF,
      markedByUserId: guardUserId,
    });

    // Resident subsequently leaves hostel at 11:00 AM -> OUT
    await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.OUT,
      source: MovementSource.GUARD_CONFIRMATION,
      effectiveTimestamp: new Date('2026-09-29T11:00:00Z'),
    });

    // Verify decoupling:
    const record = await testPrisma.attendanceRecord.findUnique({
      where: {
        attendanceSessionId_residentId: {
          attendanceSessionId: session.id,
          residentId: resident.id,
        },
      },
    });
    expect(record?.status).toBe(AttendanceRecordStatus.PRESENT);

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.OUT);
  });
});
