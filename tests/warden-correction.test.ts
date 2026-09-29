import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { PresenceState, MovementType, MovementSource, StaffRole } from '@prisma/client';
import { ValidationError } from '../src/common/errors';

describe('Warden Correction Workflow Tests', () => {
  let movementService: MovementService;
  let residentService: ResidentService;
  let orgId: string;
  let hostelId: string;
  let wardenUserId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    movementService = new MovementService(testPrisma);
    residentService = new ResidentService(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'CORR_ORG', name: 'Correction Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'CORR_HOSTEL', name: 'Correction Hostel' },
    });
    hostelId = hostel.id;

    const warden = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'warden_alice',
        fullName: 'Warden Alice',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });
    wardenUserId = warden.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('allows Warden to create a Missed IN correction with mandatory reason', async () => {
    // 1. Resident left earlier at 18:00
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_CORR_1',
      fullName: 'Missed IN Candidate',
      roomGroup: '101',
      initialPresence: PresenceState.IN,
    });

    const originalOutTime = new Date(Date.now() - 2 * 3600 * 1000);
    const missedInTime = new Date(Date.now() - 1 * 3600 * 1000);

    const originalOutEvent = await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.OUT,
      source: MovementSource.GUARD_CONFIRMATION,
      effectiveTimestamp: originalOutTime,
    });

    // Resident physically returned at missedInTime but gate missed recording it.
    // Warden notices resident inside and records Missed IN correction:
    const correctionEvent = await movementService.executeWardenCorrection({
      residentId: resident.id,
      targetState: PresenceState.IN,
      hostelId: hostelId,
      effectiveTimestamp: missedInTime,
      reason: 'Resident returned at missedInTime but gate scanner was temporarily offline',
      authorizedByUserId: wardenUserId,
      authorizedByRole: StaffRole.WARDEN,
    });

    expect(correctionEvent.movementType).toBe(MovementType.IN);
    expect(correctionEvent.source).toBe(MovementSource.WARDEN_CORRECTION);
    expect(correctionEvent.isCorrection).toBe(true);

    // Verify original event is untouched
    const oldEvent = await testPrisma.movementEvent.findUnique({
      where: { id: originalOutEvent.id },
    });
    expect(oldEvent).not.toBeNull();
    expect(oldEvent?.movementType).toBe(MovementType.OUT);

    // Verify current presence is now IN
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);
    expect(presence?.lastMovementEventId).toBe(correctionEvent.id);

    // Verify audit log exists
    const audit = await testPrisma.auditLog.findFirst({
      where: { entityType: 'CORRECTION', performedByUserId: wardenUserId },
    });
    expect(audit).toBeDefined();
    expect(audit?.reason).toBe('Resident returned at missedInTime but gate scanner was temporarily offline');
  });

  it('allows Warden to create a Missed OUT correction with mandatory reason', async () => {
    // Resident appears IN in system
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_CORR_2',
      fullName: 'Missed OUT Candidate',
      roomGroup: '102',
      initialPresence: PresenceState.IN,
    });

    const missedOutTime = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago

    const correctionEvent = await movementService.executeWardenCorrection({
      residentId: resident.id,
      targetState: PresenceState.OUT,
      hostelId: hostelId,
      effectiveTimestamp: missedOutTime,
      reason: 'Resident left for home with approved weekend leave at earlier time',
      authorizedByUserId: wardenUserId,
      authorizedByRole: StaffRole.WARDEN,
    });

    expect(correctionEvent.movementType).toBe(MovementType.OUT);
    expect(correctionEvent.isCorrection).toBe(true);

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.OUT);
  });

  it('rejects correction if mandatory reason is missing or empty', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_CORR_3',
      fullName: 'No Reason Candidate',
      roomGroup: '103',
      initialPresence: PresenceState.OUT,
    });

    await expect(
      movementService.executeWardenCorrection({
        residentId: resident.id,
        targetState: PresenceState.IN,
        hostelId: hostelId,
        effectiveTimestamp: new Date(),
        reason: '   ', // Blank reason!
        authorizedByUserId: wardenUserId,
        authorizedByRole: StaffRole.WARDEN,
      })
    ).rejects.toThrow(ValidationError);
  });
});
