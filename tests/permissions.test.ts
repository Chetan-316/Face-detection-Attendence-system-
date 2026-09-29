import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { PresenceState, MovementType, MovementSource, StaffRole } from '@prisma/client';
import { PermissionDeniedError, InvalidStateTransitionError } from '../src/common/errors';

describe('Guard vs Warden Permissions Tests', () => {
  let movementService: MovementService;
  let residentService: ResidentService;
  let orgId: string;
  let hostelId: string;
  let guardUserId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    movementService = new MovementService(testPrisma);
    residentService = new ResidentService(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'PERM_ORG', name: 'Permissions Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'PERM_HOSTEL', name: 'Permissions Hostel' },
    });
    hostelId = hostel.id;

    const guard = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'guard_bob',
        fullName: 'Guard Bob',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardUserId = guard.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('allows Guard to record valid normal IN and normal OUT', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_GUARD_1',
      fullName: 'Resident For Guard',
      roomGroup: '101',
      initialPresence: PresenceState.IN,
    });

    // Guard records normal OUT
    const outEvent = await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.OUT,
      source: MovementSource.GUARD_CONFIRMATION,
      performedByUserId: guardUserId,
      performedByRole: StaffRole.GUARD,
    });
    expect(outEvent.movementType).toBe(MovementType.OUT);

    // Guard records normal IN
    const inEvent = await movementService.recordNormalMovement({
      residentId: resident.id,
      hostelId: hostelId,
      movementType: MovementType.IN,
      source: MovementSource.GUARD_CONFIRMATION,
      performedByUserId: guardUserId,
      performedByRole: StaffRole.GUARD,
    });
    expect(inEvent.movementType).toBe(MovementType.IN);
  });

  it('strictly forbids Guard from creating historical corrections', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_GUARD_2',
      fullName: 'Resident Attempting Guard Correction',
      roomGroup: '102',
      initialPresence: PresenceState.OUT,
    });

    await expect(
      movementService.executeWardenCorrection({
        residentId: resident.id,
        targetState: PresenceState.IN,
        hostelId: hostelId,
        effectiveTimestamp: new Date(),
        reason: 'Guard attempting correction without authorization',
        authorizedByUserId: guardUserId,
        authorizedByRole: StaffRole.GUARD,
      })
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('prevents Guard from bypassing invalid state transitions', async () => {
    // Resident is OUT
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_GUARD_3',
      fullName: 'Resident Guard Invalid Transition',
      roomGroup: '103',
      initialPresence: PresenceState.OUT,
    });

    // Guard attempts OUT -> OUT
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
});
