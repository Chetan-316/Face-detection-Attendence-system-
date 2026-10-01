import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { MovementService } from '../src/modules/movements/movement.service';
import { ResidentService } from '../src/modules/residents/resident.service';
import { PresenceState, MovementType, MovementSource, StaffRole } from '@prisma/client';
import { PermissionDeniedError, InvalidStateTransitionError } from '../src/common/errors';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';

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

describe('Backend Role Enforcement: Camera Infrastructure vs Operations', () => {
  let app: any;
  let adminToken: string;
  let wardenToken: string;
  let guardToken: string;
  let testCamera: any;
  let hostelId: string;
  let orgId: string;

  beforeEach(async () => {
    await resetTestDatabase();
    app = createApp(testPrisma);

    const org = await testPrisma.organization.create({
      data: { code: 'ROLE_ORG', name: 'Role Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'ROLE_HOSTEL', name: 'Role Hostel' },
    });
    hostelId = hostel.id;

    const admin = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        username: 'admin_role',
        fullName: 'Admin Role',
        passwordHash: 'dummy',
        role: StaffRole.ADMIN,
      },
    });

    const warden = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'warden_role',
        fullName: 'Warden Role',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    const guard = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'guard_role',
        fullName: 'Guard Role',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });

    adminToken = tokenService.generateToken({
      sub: admin.id,
      organizationId: org.id,
      hostelId: null,
      role: StaffRole.ADMIN,
    }).token;

    wardenToken = tokenService.generateToken({
      sub: warden.id,
      organizationId: org.id,
      hostelId: hostel.id,
      role: StaffRole.WARDEN,
    }).token;

    guardToken = tokenService.generateToken({
      sub: guard.id,
      organizationId: org.id,
      hostelId: hostel.id,
      role: StaffRole.GUARD,
    }).token;

    testCamera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Gate Cam 1',
        sourceType: 'WEBCAM',
        role: 'IN',
        isEnabled: true,
      },
    });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('allows Admin to register camera and forbids Warden and Guard (403)', async () => {
    // Admin creates camera -> 201
    const adminRes = await request(app)
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Admin Created Camera',
        hostelId,
        sourceType: 'WEBCAM',
        role: 'IN',
      });
    expect(adminRes.status).toBe(201);

    // Warden tries to register camera -> 403 Forbidden
    const wardenRes = await request(app)
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({
        name: 'Warden Unauthorized Camera',
        hostelId,
        sourceType: 'WEBCAM',
        role: 'IN',
      });
    expect(wardenRes.status).toBe(403);

    // Guard tries to register camera -> 403 Forbidden
    const guardRes = await request(app)
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({
        name: 'Guard Unauthorized Camera',
        hostelId,
        sourceType: 'WEBCAM',
        role: 'IN',
      });
    expect(guardRes.status).toBe(403);
  });

  it('allows Admin to update camera configuration and forbids Warden and Guard (403)', async () => {
    // Admin updates camera -> 200
    const adminRes = await request(app)
      .put(`/api/v1/cameras/${testCamera.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin Renamed Cam' });
    expect(adminRes.status).toBe(200);

    // Warden updates camera -> 403 Forbidden
    const wardenRes = await request(app)
      .put(`/api/v1/cameras/${testCamera.id}`)
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({ name: 'Warden Renamed Cam' });
    expect(wardenRes.status).toBe(403);

    // Guard updates camera -> 403 Forbidden
    const guardRes = await request(app)
      .put(`/api/v1/cameras/${testCamera.id}`)
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ name: 'Guard Renamed Cam' });
    expect(guardRes.status).toBe(403);
  });

  it('allows Admin to test camera connection and forbids Warden and Guard (403)', async () => {
    // Warden test connection -> 403 Forbidden
    const wardenRes = await request(app)
      .post('/api/v1/cameras/test-connection')
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({ sourceType: 'WEBCAM', deviceIndex: 0 });
    expect(wardenRes.status).toBe(403);

    // Guard test connection -> 403 Forbidden
    const guardRes = await request(app)
      .post('/api/v1/cameras/test-connection')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ sourceType: 'WEBCAM', deviceIndex: 0 });
    expect(guardRes.status).toBe(403);
  });

  it('allows Warden to view scoped cameras, detail, health and forbids Guard from start/stop', async () => {
    // Warden lists scoped cameras
    const wardenList = await request(app)
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${wardenToken}`);
    expect(wardenList.status).toBe(200);
    expect(wardenList.body.data.length).toBeGreaterThan(0);

    // Warden gets camera detail
    const wardenDetail = await request(app)
      .get(`/api/v1/cameras/${testCamera.id}`)
      .set('Authorization', `Bearer ${wardenToken}`);
    expect(wardenDetail.status).toBe(200);

    // Warden gets health
    const wardenHealth = await request(app)
      .get(`/api/v1/cameras/${testCamera.id}/health`)
      .set('Authorization', `Bearer ${wardenToken}`);
    expect(wardenHealth.status).toBe(200);

    // Guard lists cameras in assigned hostel
    const guardList = await request(app)
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${guardToken}`);
    expect(guardList.status).toBe(200);

    // Guard is forbidden from start/stop
    const guardStart = await request(app)
      .post(`/api/v1/cameras/${testCamera.id}/start`)
      .set('Authorization', `Bearer ${guardToken}`);
    expect(guardStart.status).toBe(403);

    const guardStop = await request(app)
      .post(`/api/v1/cameras/${testCamera.id}/stop`)
      .set('Authorization', `Bearer ${guardToken}`);
    expect(guardStop.status).toBe(403);
  });
});

