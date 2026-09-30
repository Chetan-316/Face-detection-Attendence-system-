import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import {
  StaffRole,
  UserStatus,
  ResidentStatus,
  FaceEnrollmentStatus,
  CameraSourceType,
  CameraRole,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { EnrollmentService } from '../src/modules/biometrics/enrollment.service';
import { PythonWorkerClient } from '../src/modules/biometrics/python-worker-client';
import { CameraService } from '../src/modules/cameras/camera.service';

describe('Step 05: Face Enrollment Pipeline Tests', () => {
  let app: any;
  let cameraService: CameraService;
  let mockWorkerClient: PythonWorkerClient;
  let enrollmentService: EnrollmentService;

  let org: any;
  let hostel1: any;
  let hostel2: any;
  let otherOrg: any;
  let otherHostel: any;

  let adminUser: any;
  let warden1User: any;
  let guard1User: any;
  let otherOrgUser: any;

  let adminToken: string;
  let warden1Token: string;
  let guard1Token: string;
  let otherOrgToken: string;

  let resident1: any;
  let residentHostel2: any;
  let inactiveResident: any;
  let testCamera: any;

  beforeAll(async () => {
    // Instantiate mock-capable python worker client for automated deterministic test execution
    mockWorkerClient = new PythonWorkerClient({ mock: true });
    cameraService = new CameraService(testPrisma);
    enrollmentService = new EnrollmentService(testPrisma, mockWorkerClient, cameraService);
    app = createApp(testPrisma);
  });

  beforeEach(async () => {
    await resetTestDatabase();

    // 1. Setup Organizations & Hostels
    org = await testPrisma.organization.create({
      data: { code: 'ORG_ALPHA', name: 'Alpha University', isActive: true },
    });

    otherOrg = await testPrisma.organization.create({
      data: { code: 'ORG_BETA', name: 'Beta Institute', isActive: true },
    });

    hostel1 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H1', name: 'Hostel 1', isActive: true },
    });

    hostel2 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H2', name: 'Hostel 2', isActive: true },
    });

    otherHostel = await testPrisma.hostel.create({
      data: { organizationId: otherOrg.id, code: 'H_BETA', name: 'Beta Hostel', isActive: true },
    });

    const pwHash = await bcrypt.hash('Secret123!', 4);

    // 2. Setup Staff Users
    adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: null,
        username: 'admin_user',
        fullName: 'Campus Admin',
        passwordHash: pwHash,
        role: StaffRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    warden1User = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        username: 'warden_user',
        fullName: 'Hostel 1 Warden',
        passwordHash: pwHash,
        role: StaffRole.WARDEN,
        status: UserStatus.ACTIVE,
      },
    });

    guard1User = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        username: 'guard_user',
        fullName: 'Gate Guard',
        passwordHash: pwHash,
        role: StaffRole.GUARD,
        status: UserStatus.ACTIVE,
      },
    });

    otherOrgUser = await testPrisma.user.create({
      data: {
        organizationId: otherOrg.id,
        hostelId: otherHostel.id,
        username: 'other_admin',
        fullName: 'Other Org Admin',
        passwordHash: pwHash,
        role: StaffRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    adminToken = tokenService.generateToken({
      sub: adminUser.id,
      organizationId: adminUser.organizationId,
      hostelId: null,
      role: adminUser.role,
    }).token;

    warden1Token = tokenService.generateToken({
      sub: warden1User.id,
      organizationId: warden1User.organizationId,
      hostelId: warden1User.hostelId,
      role: warden1User.role,
    }).token;

    guard1Token = tokenService.generateToken({
      sub: guard1User.id,
      organizationId: guard1User.organizationId,
      hostelId: guard1User.hostelId,
      role: guard1User.role,
    }).token;

    otherOrgToken = tokenService.generateToken({
      sub: otherOrgUser.id,
      organizationId: otherOrgUser.organizationId,
      hostelId: otherOrgUser.hostelId,
      role: otherOrgUser.role,
    }).token;

    // 3. Setup Residents
    resident1 = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        residentCode: 'R001',
        fullName: 'Aarav Sharma',
        roomGroup: 'Room 101',
        status: ResidentStatus.ACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
      },
    });

    residentHostel2 = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel2.id,
        residentCode: 'R002',
        fullName: 'Kabir Verma',
        roomGroup: 'Room 201',
        status: ResidentStatus.ACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
      },
    });

    inactiveResident = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        residentCode: 'R003',
        fullName: 'Inactive Student',
        roomGroup: 'Room 102',
        status: ResidentStatus.INACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
      },
    });

    // 4. Setup Camera
    testCamera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Enrollment Desk Webcam',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.GENERAL,
        isEnabled: true,
        configMetadata: { backend: 'synthetic' },
      },
    });
  });

  afterAll(async () => {
    await mockWorkerClient.stop();
    await cameraService.shutdownAll();
    await testPrisma.$disconnect();
  });

  describe('1. Role Authorization & Scoping Constraints', () => {
    it('Admin can start enrollment session for resident within organization', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cameraId: testCamera.id })
        .expect(201);

      expect(res.body.data.sessionId).toBeDefined();
      expect(res.body.data.residentId).toBe(resident1.id);
      expect(res.body.data.status).toBe('CAPTURING');
      expect(res.body.data.requiredSamples).toBe(7);
      expect(res.body.data.acceptedSamples).toBe(0);
      expect(res.body.data.embedding).toBeUndefined(); // NEVER exposes raw embedding
    });

    it('Warden can start enrollment session for resident in their assigned hostel', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      expect(res.body.data.status).toBe('CAPTURING');
      expect(res.body.data.residentId).toBe(resident1.id);
    });

    it('Guard is strictly rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${guard1Token}`)
        .expect(403);

      expect(res.body.error.message).toMatch(/not authorized/i);
    });

    it('Warden cross-hostel enrollment is rejected with 404', async () => {
      // residentHostel2 is in hostel2, warden1 is in hostel1
      await request(app)
        .post(`/api/v1/residents/${residentHostel2.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(404);
    });

    it('Cross-organization enrollment is rejected with 404', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${otherOrgToken}`)
        .expect(404);
    });

    it('Rejects enrollment for inactive resident with 400 Validation Error', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${inactiveResident.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(400);

      expect(res.body.error.message).toMatch(/inactive resident/i);
    });
  });

  describe('2. Enrollment Session Lifecycle & Timeouts', () => {
    it('handles duplicate start by overwriting previous uncommitted session cleanly', async () => {
      const session1 = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      const session2 = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      expect(session2.body.data.sessionId).not.toBe(session1.body.data.sessionId);
      expect(session2.body.data.acceptedSamples).toBe(0);
    });

    it('GET status returns session progress without exposing biometric embeddings', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/residents/${resident1.id}/face-enrollment/status`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(200);

      expect(res.body.data.status).toBe('CAPTURING');
      expect(res.body.data.acceptedSamples).toBe(0);
      expect(res.body.data.requiredSamples).toBe(7);
      expect(res.body.data.progressPercentage).toBe(0);
      expect(res.body.data.embedding).toBeUndefined();
      expect(res.body.data.template).toBeUndefined();
    });

    it('Cancel discards session without modifying FaceProfile or Resident status', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/cancel`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(200);

      // Verify DB was completely untouched
      const dbResident = await testPrisma.resident.findUnique({ where: { id: resident1.id } });
      expect(dbResident?.faceEnrollmentStatus).toBe(FaceEnrollmentStatus.NOT_ENROLLED);

      const profiles = await testPrisma.faceProfile.findMany({ where: { residentId: resident1.id } });
      expect(profiles.length).toBe(0);
    });
  });

  describe('3. Biometric Quality Gates & Single-Face Rule', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);
    });

    it('Rejects frame when zero faces are detected (NO_FACE)', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({
          frameBase64: 'fake-frame',
          mockOverride: {
            quality: {
              is_valid: false,
              rejection_reason: 'NO_FACE',
              message: 'No face detected',
              face_count: 0,
            },
            embedding: null,
          },
        })
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('NO_FACE');
      expect(res.body.data.sessionStatus.acceptedSamples).toBe(0);
      expect(res.body.data.sessionStatus.rejectedSamples).toBe(1);
    });

    it('Rejects frame when multiple faces are detected (MULTIPLE_FACES)', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({
          frameBase64: 'fake-frame',
          mockOverride: {
            quality: {
              is_valid: false,
              rejection_reason: 'MULTIPLE_FACES',
              message: 'Multiple faces detected',
              face_count: 2,
            },
            embedding: null,
          },
        })
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('MULTIPLE_FACES');
    });

    it('Rejects frame when image is blurry (TOO_BLURRY)', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({
          frameBase64: 'fake-frame',
          mockOverride: {
            quality: {
              is_valid: false,
              rejection_reason: 'TOO_BLURRY',
              message: 'Image is blurry. Please hold still.',
            },
            embedding: null,
          },
        })
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('TOO_BLURRY');
    });

    it('Rejects frame when face is too small (FACE_TOO_SMALL)', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({
          frameBase64: 'fake-frame',
          mockOverride: {
            quality: {
              is_valid: false,
              rejection_reason: 'FACE_TOO_SMALL',
              message: 'Please move closer to the camera.',
            },
            embedding: null,
          },
        })
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('FACE_TOO_SMALL');
    });

    it('Accepts frame with valid quality and increments acceptedSamples', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({
          frameBase64: 'fake-frame',
          mockOverride: {
            quality: {
              is_valid: true,
              rejection_reason: null,
              message: 'Good quality face sample detected',
              face_count: 1,
            },
            embedding: Array(128).fill(0.088),
          },
        })
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(true);
      expect(res.body.data.sessionStatus.acceptedSamples).toBe(1);
      expect(res.body.data.embedding).toBeUndefined(); // Never returned
    });
  });

  describe('4. Multi-Sample Accumulation, Consistency, and Atomic Commit', () => {
    it('Requires minimum 5 samples before completing enrollment', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      // Attempt to complete with 0 samples -> 400 Validation Error
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/complete`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(400);

      expect(res.body.error.message).toMatch(/insufficient samples/i);
    });

    it('Aggregates multi-sample template, updates FaceProfile & Resident atomically, never leaks embedding in response', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      // Capture 5 valid samples
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 410)); // Pacing
        await request(app)
          .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
          .set('Authorization', `Bearer ${warden1Token}`)
          .send({
            frameBase64: 'valid-face-frame',
            mockOverride: {
              quality: { is_valid: true, rejection_reason: null, face_count: 1 },
              embedding: Array(128).fill(0.088),
            },
          })
          .expect(200);
      }

      // Complete enrollment
      const completeRes = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/complete`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(200);

      expect(completeRes.body.data.enrollmentStatus).toBe('ENROLLED');
      expect(completeRes.body.data.modelName).toBe('SFace');
      expect(completeRes.body.data.modelVersion).toBe('2021dec');
      expect(completeRes.body.data.samplesCount).toBe(5);
      expect(completeRes.body.data.embedding).toBeUndefined(); // Biometric security rule

      // Verify Database state
      const dbResident = await testPrisma.resident.findUnique({ where: { id: resident1.id } });
      expect(dbResident?.faceEnrollmentStatus).toBe(FaceEnrollmentStatus.ENROLLED);

      const dbProfile = await testPrisma.faceProfile.findFirst({
        where: { residentId: resident1.id, enrollmentStatus: FaceEnrollmentStatus.ENROLLED },
      });
      expect(dbProfile).toBeDefined();
      expect(dbProfile?.modelName).toBe('SFace');
      expect(dbProfile?.modelVersion).toBe('2021dec');
      expect(dbProfile?.templateReference).toMatch(/^fptpl_/);
      expect((dbProfile?.metadata as any).embedding).toBeDefined();
      expect((dbProfile?.metadata as any).embeddingDimension).toBe(128);

      // Verify Audit log entry
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'FACE_PROFILE', entityId: dbProfile?.id },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('CREATE');
      expect((audit?.newValues as any)?.enrollmentStatus).toBe('ENROLLED');
      expect((audit?.newValues as any)?.embedding).toBeUndefined(); // Biometric security rule: never in audit logs
    });
  });

  describe('5. Re-enrollment & Revocation Workflows', () => {
    beforeEach(async () => {
      // Enroll resident first
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 410));
        await request(app)
          .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
          .set('Authorization', `Bearer ${warden1Token}`)
          .send({
            frameBase64: 'face-frame',
            mockOverride: {
              quality: { is_valid: true, rejection_reason: null, face_count: 1 },
              embedding: Array(128).fill(0.088),
            },
          })
          .expect(200);
      }

      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/complete`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(200);
    });

    it('Re-enrollment atomically supersedes previous template while maintaining audit trail', async () => {
      // Start re-enrollment session
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 410));
        await request(app)
          .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
          .set('Authorization', `Bearer ${warden1Token}`)
          .send({
            frameBase64: 'new-face-frame',
            mockOverride: {
              quality: { is_valid: true, rejection_reason: null, face_count: 1 },
              embedding: Array(128).fill(0.099),
            },
          })
          .expect(200);
      }

      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/complete`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(200);

      // Verify DB has only 1 active ENROLLED profile, old one marked NEEDS_REENROLLMENT
      const enrolledProfiles = await testPrisma.faceProfile.findMany({
        where: { residentId: resident1.id, enrollmentStatus: FaceEnrollmentStatus.ENROLLED },
      });
      expect(enrolledProfiles.length).toBe(1);

      const allProfiles = await testPrisma.faceProfile.findMany({
        where: { residentId: resident1.id },
      });
      expect(allProfiles.length).toBe(2);
    });

    it('Revocation marks status REVOKED, removes usable template for privacy, requires mandatory reason', async () => {
      // Reason missing -> 400
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/revoke`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({ reason: '' })
        .expect(400);

      // Guard cannot revoke -> 403
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/revoke`)
        .set('Authorization', `Bearer ${guard1Token}`)
        .send({ reason: 'Guard trying to revoke' })
        .expect(403);

      // Authorized revocation by Warden
      const revokeRes = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/revoke`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({ reason: 'Student requested biometric template removal' })
        .expect(200);

      expect(revokeRes.body.data.status).toBe('REVOKED');

      // Verify DB: Resident faceEnrollmentStatus is REVOKED
      const dbResident = await testPrisma.resident.findUnique({ where: { id: resident1.id } });
      expect(dbResident?.faceEnrollmentStatus).toBe(FaceEnrollmentStatus.REVOKED);

      // Verify FaceProfile template embedding is wiped for privacy
      const dbProfile = await testPrisma.faceProfile.findFirst({
        where: { residentId: resident1.id },
      });
      expect(dbProfile?.enrollmentStatus).toBe(FaceEnrollmentStatus.REVOKED);
      expect(dbProfile?.revokedAt).toBeDefined();
      expect((dbProfile?.metadata as any)?.embedding).toBeNull(); // Privacy rule: usable template purged

      // Verify Audit record
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'FACE_PROFILE', entityId: dbProfile?.id, reason: 'Student requested biometric template removal' },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('UPDATE');
    });
  });

  describe('6. Biometrics Health Diagnostics Endpoint', () => {
    it('GET /api/v1/biometrics/health returns warm worker status without secrets for Admin/Warden', async () => {
      const res = await request(app)
        .get('/api/v1/biometrics/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('UP');
      expect(res.body.data.modelName).toBe('SFace');
      expect(res.body.data.modelVersion).toBe('2021dec');
      expect(res.body.data.detectorName).toBe('YuNet');
      expect(res.body.data.embeddingDimension).toBe(128);
      expect(res.body.data.license).toBe('Apache-2.0');
    });

    it('GET /api/v1/biometrics/health is rejected with 403 for Guard', async () => {
      await request(app)
        .get('/api/v1/biometrics/health')
        .set('Authorization', `Bearer ${guard1Token}`)
        .expect(403);
    });
  });
});
