import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { ResidentService } from '../src/modules/residents/resident.service';
import { PresenceState, ResidentStatus, MovementType, MovementSource } from '@prisma/client';
import { ConflictError } from '../src/common/errors';

describe('Resident Domain Tests', () => {
  let residentService: ResidentService;
  let testOrgId: string;
  let testHostelId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    residentService = new ResidentService(testPrisma);

    // Setup base organization and hostel
    const org = await testPrisma.organization.create({
      data: { code: 'TEST_ORG', name: 'Test Institution' },
    });
    testOrgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'HOSTEL_1', name: 'Test Hostel 1' },
    });
    testHostelId = hostel.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('should create a resident with initial presence state and audit log', async () => {
    const resident = await residentService.createResident({
      organizationId: testOrgId,
      hostelId: testHostelId,
      residentCode: 'R101',
      fullName: 'Test Resident A',
      roomGroup: 'Room 201',
      initialPresence: PresenceState.IN,
    });

    expect(resident.id).toBeDefined();
    expect(resident.residentCode).toBe('R101');
    expect(resident.status).toBe(ResidentStatus.ACTIVE);

    // Presence check
    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence?.currentState).toBe(PresenceState.IN);

    // Audit check
    const audit = await testPrisma.auditLog.findFirst({
      where: { entityType: 'RESIDENT', entityId: resident.id },
    });
    expect(audit).toBeDefined();
    expect(audit?.action).toBe('CREATE');
  });

  it('should reject duplicate resident code within the same organization', async () => {
    await residentService.createResident({
      organizationId: testOrgId,
      hostelId: testHostelId,
      residentCode: 'R_DUP',
      fullName: 'Resident One',
      roomGroup: 'Room 101',
    });

    await expect(
      residentService.createResident({
        organizationId: testOrgId,
        hostelId: testHostelId,
        residentCode: 'R_DUP',
        fullName: 'Resident Two',
        roomGroup: 'Room 102',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('should deactivate resident with mandatory reason and preserve history', async () => {
    const resident = await residentService.createResident({
      organizationId: testOrgId,
      hostelId: testHostelId,
      residentCode: 'R_DEACT',
      fullName: 'Deactivation Candidate',
      roomGroup: 'Room 303',
      initialPresence: PresenceState.IN,
    });

    // Create a historical movement event
    await testPrisma.movementEvent.create({
      data: {
        residentId: resident.id,
        hostelId: testHostelId,
        movementType: MovementType.IN,
        source: MovementSource.MANUAL,
        effectiveTimestamp: new Date(),
        recordedTimestamp: new Date(),
      },
    });

    // Deactivate resident
    const updated = await residentService.deactivateResident(
      resident.id,
      'Resident graduated from institution'
    );
    expect(updated.status).toBe(ResidentStatus.INACTIVE);

    // Historical records must still exist intact!
    const events = await testPrisma.movementEvent.findMany({
      where: { residentId: resident.id },
    });
    expect(events.length).toBe(1);

    const presence = await testPrisma.residentPresence.findUnique({
      where: { residentId: resident.id },
    });
    expect(presence).not.toBeNull();
  });
});
