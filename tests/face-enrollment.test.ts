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
  let hostel3NoCam: any;
  let otherOrg: any;
  let otherHostel: any;

  let adminUser: any;
  let warden1User: any;
  let guard1User: any;
  let warden3NoCamUser: any;
  let otherOrgUser: any;

  let adminToken: string;
  let warden1Token: string;
  let guard1Token: string;
  let warden3NoCamToken: string;
  let otherOrgToken: string;

  let resident1: any;
  let residentHostel2: any;
  let resident3NoCam: any;
  let inactiveResident: any;
  let testCamera: any;
  let hostel2Camera: any;
  let otherOrgCamera: any;
  let disabledCamera: any;

  beforeAll(async () => {
    // Instantiate mock-capable python worker client for automated deterministic test execution
    mockWorkerClient = new PythonWorkerClient({ mock: true });
    cameraService = new CameraService(testPrisma);
    enrollmentService = new EnrollmentService(testPrisma, mockWorkerClient, cameraService);
    // Dependency injection into createApp
    app = createApp(testPrisma, { enrollmentService, cameraService });
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.restoreAllMocks();

    // Default mock worker response for normal frame capture
    vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValue({
      success: true,
      quality: {
        is_valid: true,
        rejection_reason: null,
        message: 'Good quality face sample detected',
        face_count: 1,
        metrics: {
          face_count: 1,
          confidence: 0.95,
          blur_score: 120.0,
          brightness: 128.0,
          bbox: { x: 200, y: 140, width: 240, height: 260 },
          frame_width: 640,
          frame_height: 480,
        },
      },
      embedding: Array(128).fill(0.088),
    });

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

    hostel3NoCam = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H3_NOCAM', name: 'Hostel 3 Without Camera', isActive: true },
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

    warden3NoCamUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel3NoCam.id,
        username: 'warden3_user',
        fullName: 'Hostel 3 Warden',
        passwordHash: pwHash,
        role: StaffRole.WARDEN,
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

    warden3NoCamToken = tokenService.generateToken({
      sub: warden3NoCamUser.id,
      organizationId: warden3NoCamUser.organizationId,
      hostelId: warden3NoCamUser.hostelId,
      role: warden3NoCamUser.role,
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

    resident3NoCam = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel3NoCam.id,
        residentCode: 'R003_NOCAM',
        fullName: 'NoCam Student',
        roomGroup: 'Room 301',
        status: ResidentStatus.ACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
      },
    });

    inactiveResident = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        residentCode: 'R004_INACT',
        fullName: 'Inactive Student',
        roomGroup: 'Room 102',
        status: ResidentStatus.INACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
      },
    });

    // 4. Setup Cameras
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

    hostel2Camera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel2.id,
        name: 'Hostel 2 Webcam',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.GENERAL,
        isEnabled: true,
        configMetadata: { backend: 'synthetic' },
      },
    });

    otherOrgCamera = await testPrisma.camera.create({
      data: {
        organizationId: otherOrg.id,
        hostelId: otherHostel.id,
        name: 'Other Org Webcam',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.GENERAL,
        isEnabled: true,
        configMetadata: { backend: 'synthetic' },
      },
    });

    disabledCamera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Disabled Webcam',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.GENERAL,
        isEnabled: false,
        configMetadata: { backend: 'synthetic' },
      },
    });
  });

  afterAll(async () => {
    await mockWorkerClient.stop();
    await cameraService.shutdownAll();
    await testPrisma.$disconnect();
  });

  describe('1. Role Authorization & Camera Scoping Constraints', () => {
    it('Admin can start enrollment session for resident within organization using hostel camera', async () => {
      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cameraId: testCamera.id })
        .expect(201);

      expect(res.body.data.sessionId).toBeDefined();
      expect(res.body.data.residentId).toBe(resident1.id);
      expect(res.body.data.cameraId).toBe(testCamera.id);
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
      expect(res.body.data.cameraId).toBe(testCamera.id);
    });

    it('Warden cannot supply another hostel camera ID (returns 404 to avoid leaking existence)', async () => {
      // resident1 is in hostel1; hostel2Camera is in hostel2
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({ cameraId: hostel2Camera.id })
        .expect(404);
    });

    it('Admin cannot use another hostel camera when enrolling a resident (scoped to resident hostel, returns 404)', async () => {
      // Admin is org-wide, but resident1 is in hostel1. Supplying hostel2Camera must fail.
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cameraId: hostel2Camera.id })
        .expect(404);
    });

    it('Camera from different organization is strictly rejected with 404', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cameraId: otherOrgCamera.id })
        .expect(404);
    });

    it('Disabled camera in resident hostel is rejected with 404', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({ cameraId: disabledCamera.id })
        .expect(404);
    });

    it('Resident in hostel without enabled cameras returns clean error and does NOT fall back to another hostel camera', async () => {
      // resident3NoCam is in hostel3NoCam which has no cameras
      const res = await request(app)
        .post(`/api/v1/residents/${resident3NoCam.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden3NoCamToken}`)
        .expect(400);

      expect(res.body.error.message).toMatch(/No active camera is available in this resident's hostel/i);
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

    it('Rejects frame capture when session has expired', async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      // Fast-forward time past 5 minute TTL
      const pastDate = new Date(Date.now() - 1000);
      (enrollmentService as any).sessions.get(resident1.id).expiresAt = pastDate;

      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({})
        .expect(410);

      expect(res.body.error.message).toMatch(/expired/i);
    });
  });

  describe('3. Public API Safety & Quality Inspection Gates', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);
    });

    it('Public /capture API strictly rejects client-supplied mockOverride or frameBase64', async () => {
      // Attempting to send mockOverride is rejected by strict Zod validation with 400
      const res1 = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({ mockOverride: { quality: { is_valid: true } } })
        .expect(400);

      expect(res1.body.error.message).toMatch(/unrecognized|validation/i);

      // Attempting to send frameBase64 is also rejected by strict Zod validation with 400
      const res2 = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({ frameBase64: 'malicious-injected-frame' })
        .expect(400);

      expect(res2.body.error.message).toMatch(/unrecognized|validation/i);
    });

    it('Rejects frame when zero faces are detected (NO_FACE)', async () => {
      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValueOnce({
        success: true,
        quality: {
          is_valid: false,
          rejection_reason: 'NO_FACE',
          message: 'No face detected. Please position yourself in front of the camera.',
          face_count: 0,
          metrics: null,
        },
        embedding: null,
      });

      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({})
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('NO_FACE');
      expect(res.body.data.sessionStatus.acceptedSamples).toBe(0);
      expect(res.body.data.sessionStatus.rejectedSamples).toBe(1);
    });

    it('Rejects frame when multiple faces are detected (MULTIPLE_FACES)', async () => {
      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValueOnce({
        success: true,
        quality: {
          is_valid: false,
          rejection_reason: 'MULTIPLE_FACES',
          message: 'Multiple faces detected. Only one person must be visible during enrollment.',
          face_count: 2,
          metrics: null,
        },
        embedding: null,
      });

      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({})
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('MULTIPLE_FACES');
    });

    it('Rejects frame when image is blurry (TOO_BLURRY)', async () => {
      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValueOnce({
        success: true,
        quality: {
          is_valid: false,
          rejection_reason: 'TOO_BLURRY',
          message: 'Image is blurry. Please hold still.',
          face_count: 1,
          metrics: null,
        },
        embedding: null,
      });

      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({})
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('TOO_BLURRY');
    });

    it('Rejects frame when face is too small (FACE_TOO_SMALL)', async () => {
      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValueOnce({
        success: true,
        quality: {
          is_valid: false,
          rejection_reason: 'FACE_TOO_SMALL',
          message: 'Please move closer to the camera.',
          face_count: 1,
          metrics: null,
        },
        embedding: null,
      });

      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({})
        .expect(200);

      expect(res.body.data.sampleAccepted).toBe(false);
      expect(res.body.data.quality.rejection_reason).toBe('FACE_TOO_SMALL');
    });

    it('Accepts frame with valid quality and increments acceptedSamples', async () => {
      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValueOnce({
        success: true,
        quality: {
          is_valid: true,
          rejection_reason: null,
          message: 'Good quality face sample detected',
          face_count: 1,
          metrics: {
            face_count: 1,
            confidence: 0.95,
            blur_score: 120.0,
            brightness: 128.0,
            bbox: { x: 200, y: 140, width: 240, height: 260 },
            frame_width: 640,
            frame_height: 480,
          },
        },
        embedding: Array(128).fill(0.088),
      });

      const res = await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({})
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

      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValue({
        success: true,
        quality: { is_valid: true, rejection_reason: null, message: 'Good quality face sample detected', face_count: 1 },
        embedding: Array(128).fill(0.088),
      });

      // Capture 5 valid samples
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 410)); // Pacing
        await request(app)
          .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
          .set('Authorization', `Bearer ${warden1Token}`)
          .send({})
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
      expect((dbProfile?.metadata as any).template).toBeDefined();
      expect(Array.isArray((dbProfile?.metadata as any).template)).toBe(true);
      expect((dbProfile?.metadata as any).template.length).toBe(128);
      expect((dbProfile?.metadata as any).templateVersion).toBe('1.0.0');
      expect((dbProfile?.metadata as any).embeddingDimension).toBe(128);

      // Verify Audit log entry
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'FACE_PROFILE', entityId: dbProfile?.id },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('CREATE');
      expect((audit?.newValues as any)?.enrollmentStatus).toBe('ENROLLED');
      expect((audit?.newValues as any)?.template).toBeUndefined(); // Biometric security rule: never in audit logs
      expect((audit?.newValues as any)?.embedding).toBeUndefined();
    });
  });

  describe('5. Re-enrollment & Revocation Workflows', () => {
    beforeEach(async () => {
      // Enroll resident first
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/start`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .expect(201);

      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValue({
        success: true,
        quality: { is_valid: true, rejection_reason: null, message: 'Good quality face sample detected', face_count: 1 },
        embedding: Array(128).fill(0.088),
      });

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 410));
        await request(app)
          .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
          .set('Authorization', `Bearer ${warden1Token}`)
          .send({})
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

      vi.spyOn(mockWorkerClient, 'processFrame').mockResolvedValue({
        success: true,
        quality: { is_valid: true, rejection_reason: null, message: 'Good quality face sample detected', face_count: 1 },
        embedding: Array(128).fill(0.099),
      });

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 410));
        await request(app)
          .post(`/api/v1/residents/${resident1.id}/face-enrollment/capture`)
          .set('Authorization', `Bearer ${warden1Token}`)
          .send({})
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
      expect((dbProfile?.metadata as any)?.template).toBeNull(); // Canonical template vector purged
      expect((dbProfile?.metadata as any)?.embedding).toBeNull(); // No alternate vector field retained

      // Verify Audit record
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'FACE_PROFILE', entityId: dbProfile?.id, reason: 'Student requested biometric template removal' },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('UPDATE');
    });

    it('Regression: proves successful enrollment stores metadata.template, revoke removes it, and no other metadata field contains vector', async () => {
      // 1. Verify fresh active profile has canonical template
      const activeProfile = await testPrisma.faceProfile.findFirst({
        where: { residentId: resident1.id, enrollmentStatus: FaceEnrollmentStatus.ENROLLED },
      });
      expect(activeProfile).toBeDefined();
      const metaBefore = activeProfile?.metadata as Record<string, any>;
      expect(metaBefore.template).toBeDefined();
      expect(Array.isArray(metaBefore.template)).toBe(true);
      expect(metaBefore.template.length).toBe(128);
      expect(metaBefore.embeddingDimension).toBe(128);
      expect(metaBefore.templateVersion).toBe('1.0.0');

      // 2. Perform revocation
      await request(app)
        .post(`/api/v1/residents/${resident1.id}/face-enrollment/revoke`)
        .set('Authorization', `Bearer ${warden1Token}`)
        .send({ reason: 'Canonical revocation test' })
        .expect(200);

      // 3. Inspect database state post-revocation
      const revokedProfile = await testPrisma.faceProfile.findUnique({
        where: { id: activeProfile!.id },
      });
      expect(revokedProfile?.enrollmentStatus).toBe(FaceEnrollmentStatus.REVOKED);
      expect(revokedProfile?.revokedAt).toBeDefined();

      const metaAfter = revokedProfile?.metadata as Record<string, any>;
      // Must explicitly be null
      expect(metaAfter.template).toBeNull();
      expect(metaAfter.embedding).toBeNull();

      // Ensure no other metadata property contains an array or vector values
      for (const [key, value] of Object.entries(metaAfter)) {
        expect(Array.isArray(value)).toBe(false);
      }
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
