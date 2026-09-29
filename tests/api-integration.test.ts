import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { createApp } from '../src/api/app';
import { StaffRole, UserStatus, PresenceState, ResidentStatus, MovementType, MovementSource } from '@prisma/client';
import { tokenService } from '../src/api/auth/token.service';

describe('Step 02 API Integration Test Suite', () => {
  let app: any;

  // Organizations
  let org1Id: string;
  let org2Id: string;

  // Hostels
  let hostel1AId: string;
  let hostel1BId: string;
  let hostel2Id: string;

  // Users
  let admin1Id: string;
  let warden1AId: string;
  let warden1BId: string;
  let guard1AId: string;
  let inactiveUserId: string;
  let suspendedUserId: string;

  // Tokens
  let admin1Token: string;
  let warden1AToken: string;
  let warden1BToken: string;
  let guard1AToken: string;

  const testPassword = 'Password@123';

  beforeEach(async () => {
    await resetTestDatabase();
    app = createApp(testPrisma);

    const passwordHash = await bcrypt.hash(testPassword, 10);

    // 1. Create Org 1 and Hostels
    const org1 = await testPrisma.organization.create({
      data: { code: 'ORG_1', name: 'Institution 1' },
    });
    org1Id = org1.id;

    const hostel1A = await testPrisma.hostel.create({
      data: { organizationId: org1Id, code: 'H1A', name: 'Hostel 1A' },
    });
    hostel1AId = hostel1A.id;

    const hostel1B = await testPrisma.hostel.create({
      data: { organizationId: org1Id, code: 'H1B', name: 'Hostel 1B' },
    });
    hostel1BId = hostel1B.id;

    // 2. Create Org 2 and Hostel
    const org2 = await testPrisma.organization.create({
      data: { code: 'ORG_2', name: 'Institution 2' },
    });
    org2Id = org2.id;

    const hostel2 = await testPrisma.hostel.create({
      data: { organizationId: org2Id, code: 'H2', name: 'Hostel 2' },
    });
    hostel2Id = hostel2.id;

    // 3. Create Users
    const admin1 = await testPrisma.user.create({
      data: {
        organizationId: org1Id,
        hostelId: null, // Org-level admin
        username: 'admin1',
        fullName: 'Admin One',
        email: 'admin1@org1.test',
        passwordHash,
        role: StaffRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    admin1Id = admin1.id;

    const warden1A = await testPrisma.user.create({
      data: {
        organizationId: org1Id,
        hostelId: hostel1AId,
        username: 'warden1a',
        fullName: 'Warden 1A',
        email: 'warden1a@org1.test',
        passwordHash,
        role: StaffRole.WARDEN,
        status: UserStatus.ACTIVE,
      },
    });
    warden1AId = warden1A.id;

    const warden1B = await testPrisma.user.create({
      data: {
        organizationId: org1Id,
        hostelId: hostel1BId,
        username: 'warden1b',
        fullName: 'Warden 1B',
        email: 'warden1b@org1.test',
        passwordHash,
        role: StaffRole.WARDEN,
        status: UserStatus.ACTIVE,
      },
    });
    warden1BId = warden1B.id;

    const guard1A = await testPrisma.user.create({
      data: {
        organizationId: org1Id,
        hostelId: hostel1AId,
        username: 'guard1a',
        fullName: 'Guard 1A',
        email: 'guard1a@org1.test',
        passwordHash,
        role: StaffRole.GUARD,
        status: UserStatus.ACTIVE,
      },
    });
    guard1AId = guard1A.id;

    const inactiveUser = await testPrisma.user.create({
      data: {
        organizationId: org1Id,
        hostelId: hostel1AId,
        username: 'inactive_staff',
        fullName: 'Inactive Staff',
        passwordHash,
        role: StaffRole.WARDEN,
        status: UserStatus.INACTIVE,
      },
    });
    inactiveUserId = inactiveUser.id;

    const suspendedUser = await testPrisma.user.create({
      data: {
        organizationId: org1Id,
        hostelId: hostel1AId,
        username: 'suspended_staff',
        fullName: 'Suspended Staff',
        passwordHash,
        role: StaffRole.WARDEN,
        status: UserStatus.SUSPENDED,
      },
    });
    suspendedUserId = suspendedUser.id;

    // Login each to acquire tokens via real login endpoint
    const adminRes = await request(app).post('/api/v1/auth/login').send({ username: 'admin1', password: testPassword });
    admin1Token = adminRes.body.token;

    const warden1ARes = await request(app).post('/api/v1/auth/login').send({ username: 'warden1a', password: testPassword });
    warden1AToken = warden1ARes.body.token;

    const warden1BRes = await request(app).post('/api/v1/auth/login').send({ username: 'warden1b', password: testPassword });
    warden1BToken = warden1BRes.body.token;

    const guardRes = await request(app).post('/api/v1/auth/login').send({ username: 'guard1a', password: testPassword });
    guard1AToken = guardRes.body.token;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  // ----------------------------------------------------
  // HEALTH CHECK
  // ----------------------------------------------------
  it('GET /health returns 200 with stage STEP_02_RESIDENT_API', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.stage).toBe('STEP_02_RESIDENT_API');
    expect(res.body.database).toBe('CONNECTED');
  });

  // ----------------------------------------------------
  // AUTHENTICATION TESTS
  // ----------------------------------------------------
  describe('Authentication API', () => {
    it('valid Admin login succeeds and returns user info + token without password hash', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'admin1',
        password: testPassword,
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.expiresIn).toBe(28800);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('admin1');
      expect(res.body.user.role).toBe(StaffRole.ADMIN);
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('valid Warden login succeeds', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'warden1a',
        password: testPassword,
      });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe(StaffRole.WARDEN);
      expect(res.body.user.hostelId).toBe(hostel1AId);
    });

    it('valid Guard login succeeds', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'guard1a',
        password: testPassword,
      });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe(StaffRole.GUARD);
    });

    it('GET /api/v1/auth/me returns current authenticated user context', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('warden1a');
      expect(res.body.user.role).toBe(StaffRole.WARDEN);
      expect(res.body.user.hostelId).toBe(hostel1AId);
    });

    it('incorrect password is rejected with generic 401', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'admin1',
        password: 'wrong_password',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid username or password');
    });

    it('unknown username is rejected with generic 401', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'nonexistent_user',
        password: testPassword,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid username or password');
    });

    it('inactive user login is rejected with 401', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'inactive_staff',
        password: testPassword,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('suspended user login is rejected with 401', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'suspended_staff',
        password: testPassword,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('protected route without token returns 401', async () => {
      const res = await request(app).get('/api/v1/residents');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('protected route with malformed/invalid token returns 401', async () => {
      const res = await request(app)
        .get('/api/v1/residents')
        .set('Authorization', 'Bearer invalid.jwt.token');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('token belonging to deleted user returns 401', async () => {
      // Create user, get token, then delete user
      const tempUser = await testPrisma.user.create({
        data: {
          organizationId: org1Id,
          username: 'to_be_deleted',
          fullName: 'To Delete',
          passwordHash: 'dummy',
          role: StaffRole.WARDEN,
        },
      });
      const { token } = tokenService.generateToken({
        sub: tempUser.id,
        role: StaffRole.WARDEN,
        organizationId: org1Id,
        hostelId: hostel1AId,
      });

      await testPrisma.user.delete({ where: { id: tempUser.id } });

      const res = await request(app)
        .get('/api/v1/residents')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('no longer exists');
    });
  });

  // ----------------------------------------------------
  // RESIDENT CREATION TESTS
  // ----------------------------------------------------
  describe('Resident Creation API', () => {
    it('Warden creates resident in own hostel successfully', async () => {
      const res = await request(app)
        .post('/api/v1/residents')
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({
          residentCode: 'R_W1_001',
          fullName: 'Warden Resident A',
          roomGroup: 'Room 101',
          contactPhone: '9876543210',
          contactEmail: 'r_w1@example.com',
          initialPresence: PresenceState.IN,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.residentCode).toBe('R_W1_001');
      expect(res.body.hostelId).toBe(hostel1AId);
      expect(res.body.presence.currentState).toBe(PresenceState.IN);
      expect(res.body.faceEnrollmentStatus).toBe('NOT_ENROLLED');

      // Check DB directly
      const residentInDb = await testPrisma.resident.findUnique({
        where: { id: res.body.id },
        include: { presence: true },
      });
      expect(residentInDb).not.toBeNull();
      expect(residentInDb?.presence?.currentState).toBe(PresenceState.IN);
    });

    it('Admin creates resident in permitted scope', async () => {
      const res = await request(app)
        .post('/api/v1/residents')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({
          hostelId: hostel1BId,
          residentCode: 'R_ADM_001',
          fullName: 'Admin Resident B',
          roomGroup: 'Room 202',
          initialPresence: PresenceState.OUT,
        });

      expect(res.status).toBe(201);
      expect(res.body.residentCode).toBe('R_ADM_001');
      expect(res.body.hostelId).toBe(hostel1BId);
      expect(res.body.presence.currentState).toBe(PresenceState.OUT);
    });

    it('Guard creation is rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/residents')
        .set('Authorization', `Bearer ${guard1AToken}`)
        .send({
          residentCode: 'R_GUARD_001',
          fullName: 'Guard Attempt',
          roomGroup: 'Room 303',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('duplicate resident code in same organization is rejected with 409 Conflict', async () => {
      // First creation
      await request(app)
        .post('/api/v1/residents')
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({
          residentCode: 'R_DUP_01',
          fullName: 'Original',
          roomGroup: 'Room 101',
        });

      // Second creation attempt with same code
      const res = await request(app)
        .post('/api/v1/residents')
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({
          residentCode: 'R_DUP_01',
          fullName: 'Duplicate',
          roomGroup: 'Room 102',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toContain('already exists');
    });

    it('invalid payload is rejected with 400 Validation Error', async () => {
      const res = await request(app)
        .post('/api/v1/residents')
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({
          residentCode: '', // Empty
          fullName: 'Missing Room',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('client-supplied fake Admin role or foreign hostel in body is ignored / enforced server-side', async () => {
      // Warden 1A sends hostelId of Hostel 1B and fake role
      const res = await request(app)
        .post('/api/v1/residents')
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({
          residentCode: 'R_SPOOF_01',
          fullName: 'Spoof Attempt',
          roomGroup: 'Room 101',
          hostelId: hostel1BId, // Trying to create in 1B!
          role: 'ADMIN',
          organizationId: org2Id,
        });

      expect(res.status).toBe(201);
      // Must be created in Warden's assigned hostel (Hostel 1A), NOT 1B, and NOT org 2!
      expect(res.body.hostelId).toBe(hostel1AId);
      expect(res.body.organizationId).toBe(org1Id);
    });
  });

  // ----------------------------------------------------
  // RESIDENT LIST & PAGINATION & SEARCH TESTS
  // ----------------------------------------------------
  describe('Resident List & Search API', () => {
    beforeEach(async () => {
      // Seed 5 residents in Hostel 1A
      for (let i = 1; i <= 5; i++) {
        await testPrisma.resident.create({
          data: {
            organizationId: org1Id,
            hostelId: hostel1AId,
            residentCode: `R_1A_00${i}`,
            fullName: `Student 1A ${i}`,
            roomGroup: i <= 3 ? 'Wing A' : 'Wing B',
            status: i === 5 ? ResidentStatus.INACTIVE : ResidentStatus.ACTIVE,
            presence: {
              create: {
                hostelId: hostel1AId,
                currentState: i % 2 === 0 ? PresenceState.IN : PresenceState.OUT,
              },
            },
          },
        });
      }

      // Seed 2 residents in Hostel 1B
      for (let i = 1; i <= 2; i++) {
        await testPrisma.resident.create({
          data: {
            organizationId: org1Id,
            hostelId: hostel1BId,
            residentCode: `R_1B_00${i}`,
            fullName: `Student 1B ${i}`,
            roomGroup: 'Wing C',
            status: ResidentStatus.ACTIVE,
            presence: {
              create: {
                hostelId: hostel1BId,
                currentState: PresenceState.IN,
              },
            },
          },
        });
      }
    });

    it('Warden sees only their hostel residents', async () => {
      const res = await request(app)
        .get('/api/v1/residents')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(5);
      res.body.data.forEach((r: any) => {
        expect(r.hostelId).toBe(hostel1AId);
      });
    });

    it('pagination works correctly', async () => {
      const res = await request(app)
        .get('/api/v1/residents?page=1&pageSize=2')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination).toEqual({
        page: 1,
        pageSize: 2,
        total: 5,
        totalPages: 3,
      });

      const page2 = await request(app)
        .get('/api/v1/residents?page=2&pageSize=2')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(2);
      expect(page2.body.data[0].residentCode).not.toBe(res.body.data[0].residentCode);
    });

    it('search filter matches residentCode and fullName', async () => {
      const res = await request(app)
        .get('/api/v1/residents?search=003')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].residentCode).toBe('R_1A_003');
    });

    it('status filter works (ACTIVE vs INACTIVE)', async () => {
      const inactiveRes = await request(app)
        .get('/api/v1/residents?status=INACTIVE')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(inactiveRes.status).toBe(200);
      expect(inactiveRes.body.data.length).toBe(1);
      expect(inactiveRes.body.data[0].residentCode).toBe('R_1A_005');
    });

    it('presence filter works (IN vs OUT)', async () => {
      const inRes = await request(app)
        .get('/api/v1/residents?presence=IN')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(inRes.status).toBe(200);
      // R_1A_002 and R_1A_004 have presence IN
      expect(inRes.body.data.length).toBe(2);
    });

    it('faceEnrollmentStatus filter works', async () => {
      const res = await request(app)
        .get('/api/v1/residents?faceEnrollmentStatus=NOT_ENROLLED')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(5);
    });

    it('Admin can list across all hostels or filter by specific hostel', async () => {
      // Without hostel filter -> sees all in Org 1 (5 in 1A + 2 in 1B = 7)
      const allRes = await request(app)
        .get('/api/v1/residents')
        .set('Authorization', `Bearer ${admin1Token}`);

      expect(allRes.status).toBe(200);
      expect(allRes.body.pagination.total).toBe(7);

      // With specific hostel filter
      const hostelBRes = await request(app)
        .get(`/api/v1/residents?hostelId=${hostel1BId}`)
        .set('Authorization', `Bearer ${admin1Token}`);

      expect(hostelBRes.status).toBe(200);
      expect(hostelBRes.body.pagination.total).toBe(2);
    });

    it('Admin cannot query another organization hostel (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/residents?hostelId=${hostel2Id}`)
        .set('Authorization', `Bearer ${admin1Token}`);

      expect(res.status).toBe(404);
    });

    it('GET /api/v1/residents/summary returns accurate scoped counts for Warden', async () => {
      const res = await request(app)
        .get('/api/v1/residents/summary')
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        total: 5,
        active: 4,
        inactive: 1,
        currentlyIn: 2,
        currentlyOut: 3,
        faceEnrolled: 0,
        notEnrolled: 5,
        needsReEnrollment: 0,
        revoked: 0,
      });
    });

    it('GET /api/v1/residents/summary returns accurate scoped counts for Admin', async () => {
      const res = await request(app)
        .get('/api/v1/residents/summary')
        .set('Authorization', `Bearer ${admin1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      expect(res.body.active).toBe(6);
      expect(res.body.inactive).toBe(1);
    });
  });

  // ----------------------------------------------------
  // RESIDENT DETAIL TESTS & SCOPE ISOLATION
  // ----------------------------------------------------
  describe('Resident Detail & Scope Isolation', () => {
    let res1AId: string;
    let res1BId: string;
    let res2Id: string;

    beforeEach(async () => {
      const r1A = await testPrisma.resident.create({
        data: {
          organizationId: org1Id,
          hostelId: hostel1AId,
          residentCode: 'R_DETAIL_1A',
          fullName: 'Detail Resident 1A',
          roomGroup: 'Room 10',
          presence: { create: { hostelId: hostel1AId, currentState: PresenceState.IN } },
        },
      });
      res1AId = r1A.id;

      const r1B = await testPrisma.resident.create({
        data: {
          organizationId: org1Id,
          hostelId: hostel1BId,
          residentCode: 'R_DETAIL_1B',
          fullName: 'Detail Resident 1B',
          roomGroup: 'Room 20',
          presence: { create: { hostelId: hostel1BId, currentState: PresenceState.OUT } },
        },
      });
      res1BId = r1B.id;

      const r2 = await testPrisma.resident.create({
        data: {
          organizationId: org2Id,
          hostelId: hostel2Id,
          residentCode: 'R_DETAIL_2',
          fullName: 'Detail Resident 2',
          roomGroup: 'Room 30',
          presence: { create: { hostelId: hostel2Id, currentState: PresenceState.IN } },
        },
      });
      res2Id = r2.id;
    });

    it('Warden can view resident in assigned hostel', async () => {
      const res = await request(app)
        .get(`/api/v1/residents/${res1AId}`)
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(res1AId);
      expect(res.body.residentCode).toBe('R_DETAIL_1A');
      expect(res.body.presence.currentState).toBe(PresenceState.IN);
      expect(res.body.hostel.id).toBe(hostel1AId);
    });

    it('cross-hostel lookup by Warden returns 404', async () => {
      const res = await request(app)
        .get(`/api/v1/residents/${res1BId}`)
        .set('Authorization', `Bearer ${warden1AToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('cross-organization lookup by Admin returns 404', async () => {
      const res = await request(app)
        .get(`/api/v1/residents/${res2Id}`)
        .set('Authorization', `Bearer ${admin1Token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('GET /api/v1/residents/by-code/:code works in scope and returns 404 cross-hostel', async () => {
      const okRes = await request(app)
        .get('/api/v1/residents/by-code/R_DETAIL_1A')
        .set('Authorization', `Bearer ${warden1AToken}`);
      expect(okRes.status).toBe(200);
      expect(okRes.body.id).toBe(res1AId);

      const crossRes = await request(app)
        .get('/api/v1/residents/by-code/R_DETAIL_1B')
        .set('Authorization', `Bearer ${warden1AToken}`);
      expect(crossRes.status).toBe(404);
    });
  });

  // ----------------------------------------------------
  // RESIDENT UPDATE TESTS
  // ----------------------------------------------------
  describe('Resident Update API', () => {
    let resId: string;

    beforeEach(async () => {
      const r = await testPrisma.resident.create({
        data: {
          organizationId: org1Id,
          hostelId: hostel1AId,
          residentCode: 'R_UP_01',
          fullName: 'Before Update',
          roomGroup: 'Room 50',
          contactPhone: '1111111111',
          contactEmail: 'before@test.com',
          presence: { create: { hostelId: hostel1AId, currentState: PresenceState.IN } },
        },
      });
      resId = r.id;
    });

    it('Warden updates allowed resident fields successfully', async () => {
      const res = await request(app)
        .patch(`/api/v1/residents/${resId}`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({
          fullName: 'After Update',
          roomGroup: 'Room 51',
          contactPhone: '9999999999',
          contactEmail: 'after@test.com',
        });

      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe('After Update');
      expect(res.body.roomGroup).toBe('Room 51');
      expect(res.body.contactPhone).toBe('9999999999');
      expect(res.body.contactEmail).toBe('after@test.com');

      // Verify audit entry
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'RESIDENT', entityId: resId, action: 'UPDATE' },
      });
      expect(audit).not.toBeNull();
      expect((audit?.newValues as any)?.fullName).toBe('After Update');
    });

    it('Guard cannot update resident (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/v1/residents/${resId}`)
        .set('Authorization', `Bearer ${guard1AToken}`)
        .send({ fullName: 'Hacked By Guard' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('attempting to modify forbidden fields (hostelId, organizationId, presence) is rejected by strict validation', async () => {
      const res = await request(app)
        .patch(`/api/v1/residents/${resId}`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({
          hostelId: hostel1BId,
          currentState: PresenceState.OUT,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('invalid email is rejected with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/residents/${resId}`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({ contactEmail: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ----------------------------------------------------
  // DEACTIVATION & REACTIVATION TESTS
  // ----------------------------------------------------
  describe('Resident Deactivation & Reactivation API', () => {
    let resId: string;

    beforeEach(async () => {
      const r = await testPrisma.resident.create({
        data: {
          organizationId: org1Id,
          hostelId: hostel1AId,
          residentCode: 'R_DEACT_01',
          fullName: 'Deactivation Candidate',
          roomGroup: 'Room 99',
          status: ResidentStatus.ACTIVE,
          presence: { create: { hostelId: hostel1AId, currentState: PresenceState.IN } },
        },
      });
      resId = r.id;

      // Create historical movement event
      await testPrisma.movementEvent.create({
        data: {
          residentId: resId,
          hostelId: hostel1AId,
          movementType: MovementType.IN,
          source: MovementSource.MANUAL,
          effectiveTimestamp: new Date(),
          recordedTimestamp: new Date(),
        },
      });
    });

    it('Warden deactivates resident with mandatory reason and preserves history', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resId}/deactivate`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({ reason: 'Graduated from college' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(ResidentStatus.INACTIVE);

      // Verify movement history survives
      const movements = await testPrisma.movementEvent.findMany({
        where: { residentId: resId },
      });
      expect(movements.length).toBe(1);

      // Verify audit entry
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'RESIDENT', entityId: resId, action: 'DEACTIVATE' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe('Graduated from college');
    });

    it('deactivation without reason is rejected with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resId}/deactivate`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('Guard cannot deactivate resident (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resId}/deactivate`)
        .set('Authorization', `Bearer ${guard1AToken}`)
        .send({ reason: 'Guard attempt' });

      expect(res.status).toBe(403);
    });

    it('Warden can reactivate deactivated resident with mandatory reason', async () => {
      // First deactivate
      await request(app)
        .post(`/api/v1/residents/${resId}/deactivate`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({ reason: 'Semester break' });

      // Then reactivate
      const res = await request(app)
        .post(`/api/v1/residents/${resId}/reactivate`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({ reason: 'Re-enrolled for next term' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(ResidentStatus.ACTIVE);

      const inDb = await testPrisma.resident.findUnique({ where: { id: resId } });
      expect(inDb?.status).toBe(ResidentStatus.ACTIVE);
    });

    it('reactivation without reason is rejected with 400', async () => {
      // First deactivate
      await request(app)
        .post(`/api/v1/residents/${resId}/deactivate`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({ reason: 'Semester break' });

      const res = await request(app)
        .post(`/api/v1/residents/${resId}/reactivate`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('reactivating already active resident is rejected with 409 Conflict', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resId}/reactivate`)
        .set('Authorization', `Bearer ${warden1AToken}`)
        .send({ reason: 'Already active try' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });
});
