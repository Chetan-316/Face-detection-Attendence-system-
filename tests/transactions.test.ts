import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { PresenceState, MovementType, MovementSource } from '@prisma/client';

describe('Movement Transaction Safety Tests', () => {
  let movementService: MovementService;
  let residentService: ResidentService;
  let orgId: string;
  let hostelId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    movementService = new MovementService(testPrisma);
    residentService = new ResidentService(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'TX_ORG', name: 'Transaction Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'TX_HOSTEL', name: 'Transaction Hostel' },
    });
    hostelId = hostel.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('should rollback transaction completely if an unexpected error occurs during movement', async () => {
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_TX_1',
      fullName: 'Transaction Rollback Test',
      roomGroup: '101',
      initialPresence: PresenceState.IN,
    });

    const initialEventCount = await testPrisma.movementEvent.count();

    // Trigger an intentional database foreign key violation inside the transaction
    await expect(
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: '00000000-0000-0000-0000-000000000000', // Non-existent hostel ID violates FK constraint!
        movementType: MovementType.OUT,
        source: MovementSource.MANUAL,
      })
    ).rejects.toThrow();

    // Verify atomic rollback: No MovementEvent was created
    const finalEventCount = await testPrisma.movementEvent.count();
    expect(finalEventCount).toBe(initialEventCount);

    // Current presence remained untouched as IN
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);
  });

  it('should prevent race condition corruption when two concurrent gate operations hit simultaneously', async () => {
    // Resident starts IN
    const resident = await residentService.createResident({
      organizationId: orgId,
      hostelId: hostelId,
      residentCode: 'R_TX_RACE',
      fullName: 'Concurrency Test Resident',
      roomGroup: '102',
      initialPresence: PresenceState.IN,
    });

    // Execute two simultaneous OUT requests for the exact same resident
    const results = await Promise.allSettled([
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelId,
        movementType: MovementType.OUT,
        source: MovementSource.FACE_RECOGNITION,
      }),
      movementService.recordNormalMovement({
        residentId: resident.id,
        hostelId: hostelId,
        movementType: MovementType.OUT,
        source: MovementSource.GUARD_CONFIRMATION,
      }),
    ]);

    // Exactly one operation must succeed, and exactly one must fail due to state validation
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify current presence is consistently OUT
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.OUT);

    // Verify exactly one movement event was recorded
    const events = await testPrisma.movementEvent.findMany({
      where: { residentId: resident.id },
    });
    expect(events.length).toBe(1);
  });
});
