import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';
import { StaffRole, PresenceState, MovementType, MovementSource } from '@prisma/client';

describe('Gate Regular Comer Quick Registration & Access Audit', () => {
  let app: any;
  let guardToken: string;
  let guardUser: any;
  let adminToken: string;
  let adminUser: any;
  let orgId: string;
  let hostelId: string;
  let testCamera: any;

  beforeEach(async () => {
    await resetTestDatabase();
    app = createApp(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'GATE_ORG', name: 'Gate Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'GATE_HOSTEL', name: 'Gate Hostel' },
    });
    hostelId = hostel.id;

    guardUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'gate_guard_1',
        fullName: 'Gate Guard 1',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });
    guardToken = tokenService.generateToken({
      sub: guardUser.id,
      role: StaffRole.GUARD,
      organizationId: org.id,
      hostelId: hostel.id,
    }).token;

    adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'admin_sys',
        fullName: 'Admin System',
        passwordHash: 'dummy',
        role: StaffRole.ADMIN,
      },
    });
    adminToken = tokenService.generateToken({
      sub: adminUser.id,
      role: StaffRole.ADMIN,
      organizationId: org.id,
      hostelId: hostel.id,
    }).token;

    testCamera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Gate Cam',
        sourceType: 'WEBCAM',
        role: 'IN',
        isEnabled: true,
      },
    });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('allows Guard to quick-register a regular visitor with automatic IN movement event', async () => {
    const res = await request(app)
      .post('/api/v1/residents/regular-comer')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({
        fullName: 'Ramesh Delivery Boy',
        category: 'Delivery / Courier',
        contactPhone: '9876500000',
        markInNow: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.fullName).toBe('Ramesh Delivery Boy');
    expect(res.body.roomGroup).toBe('[Non-Resident] Delivery / Courier');
    expect(res.body.residentCode).toMatch(/^VIS-/);
    expect(res.body.presence.currentState).toBe(PresenceState.IN);

    // Verify MovementEvent created
    const event = await testPrisma.movementEvent.findFirst({
      where: { residentId: res.body.id },
    });
    expect(event).not.toBeNull();
    expect(event?.movementType).toBe(MovementType.IN);
    expect(event?.source).toBe(MovementSource.GUARD_CONFIRMATION);
  });

  it('allows Guard to start face enrollment for non-resident regular visitor', async () => {
    const regRes = await request(app)
      .post('/api/v1/residents/regular-comer')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({
        fullName: 'Daily Milkman Suresh',
        category: 'Daily Vendor',
        contactPhone: '9876511111',
        markInNow: false,
      });
    expect(regRes.status).toBe(201);

    const enrRes = await request(app)
      .post(`/api/v1/residents/${regRes.body.id}/face-enrollment/start`)
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ cameraId: testCamera.id });

    expect(enrRes.status).toBe(201);
    expect(enrRes.body.data.status).toBe('CAPTURING');
  });

  it('strictly blocks Guard from enrolling face for official resident/student', async () => {
    const student = await testPrisma.resident.create({
      data: {
        organizationId: orgId,
        hostelId: hostelId,
        residentCode: 'STU-001',
        fullName: 'Regular Student',
        roomGroup: 'Room 201',
      },
    });

    const enrRes = await request(app)
      .post(`/api/v1/residents/${student.id}/face-enrollment/start`)
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ cameraId: testCamera.id });

    expect(enrRes.status).toBe(403);
    expect(enrRes.body.error.message).toContain('Guards are not authorized to perform face enrollment');
  });

  it('strictly blocks Guard from creating standard residents via POST /api/v1/residents', async () => {
    const res = await request(app)
      .post('/api/v1/residents')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({
        residentCode: 'R_HACK',
        fullName: 'Unauthorized Student',
        roomGroup: 'Room 999',
      });

    expect(res.status).toBe(403);
  });
});
