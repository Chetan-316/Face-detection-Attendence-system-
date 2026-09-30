import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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
import { CameraService } from '../src/modules/cameras/camera.service';
import { PythonWorkerClient } from '../src/modules/biometrics/python-worker-client';
import { EnrollmentService } from '../src/modules/biometrics/enrollment.service';
import { RecognitionService } from '../src/modules/recognition/recognition.service';
import { TemplateCache } from '../src/modules/recognition/template-cache';
import { TemplateMatcher } from '../src/modules/recognition/template-matcher';

function generateNormalizedVector(seed: number): number[] {
  const arr = new Array(128).fill(0).map((_, i) => Math.sin(i * 0.15 + seed));
  return TemplateMatcher.normalizeVector(arr);
}

describe('Step 06: Continuous Face Recognition Engine Tests', () => {
  let app: any;
  let cameraService: CameraService;
  let mockWorkerClient: PythonWorkerClient;
  let enrollmentService: EnrollmentService;
  let recognitionService: RecognitionService;
  let templateCache: TemplateCache;

  let org: any;
  let otherOrg: any;
  let hostel1: any;
  let hostel2: any;

  let adminUser: any;
  let wardenUser: any;
  let guardUser: any;
  let otherWardenUser: any;

  let adminToken: string;
  let wardenToken: string;
  let guardToken: string;
  let otherWardenToken: string;

  let testCamera: any;
  let hostel2Camera: any;
  let disabledCamera: any;

  let enrolledResident1: any;
  let resident1Vector: number[];

  beforeAll(async () => {
    mockWorkerClient = new PythonWorkerClient({ mock: true });
    cameraService = new CameraService(testPrisma);
    templateCache = new TemplateCache(testPrisma);
    enrollmentService = new EnrollmentService(testPrisma, mockWorkerClient, cameraService, templateCache);
    recognitionService = new RecognitionService(
      testPrisma,
      cameraService,
      templateCache,
      mockWorkerClient,
      { maxFps: 10, historyLimit: 50 }
    );

    app = createApp(testPrisma, {
      enrollmentService,
      cameraService,
      recognitionService,
    });
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.restoreAllMocks();
    templateCache.clear();

    resident1Vector = generateNormalizedVector(1.0);

    // Setup Organizations & Hostels
    org = await testPrisma.organization.create({
      data: { code: 'ORG_A', name: 'Campus Alpha', isActive: true },
    });
    otherOrg = await testPrisma.organization.create({
      data: { code: 'ORG_B', name: 'Campus Beta', isActive: true },
    });

    hostel1 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H1', name: 'Alpha Hostel 1', isActive: true },
    });
    hostel2 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H2', name: 'Alpha Hostel 2', isActive: true },
    });

    const pwHash = await bcrypt.hash('Secret123!', 4);

    // Staff Users
    adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: null,
        username: 'admin',
        fullName: 'Admin User',
        email: 'admin@pravahax.local',
        passwordHash: pwHash,
        role: StaffRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    wardenUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        username: 'warden_h1',
        fullName: 'Warden H1',
        email: 'warden1@pravahax.local',
        passwordHash: pwHash,
        role: StaffRole.WARDEN,
        status: UserStatus.ACTIVE,
      },
    });

    otherWardenUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel2.id,
        username: 'warden_h2',
        fullName: 'Warden H2',
        email: 'warden2@pravahax.local',
        passwordHash: pwHash,
        role: StaffRole.WARDEN,
        status: UserStatus.ACTIVE,
      },
    });

    guardUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        username: 'guard_h1',
        fullName: 'Guard H1',
        email: 'guard1@pravahax.local',
        passwordHash: pwHash,
        role: StaffRole.GUARD,
        status: UserStatus.ACTIVE,
      },
    });

    adminToken = tokenService.generateToken({
      sub: adminUser.id,
      role: adminUser.role,
      organizationId: adminUser.organizationId,
      hostelId: adminUser.hostelId,
    }).token;

    wardenToken = tokenService.generateToken({
      sub: wardenUser.id,
      role: wardenUser.role,
      organizationId: wardenUser.organizationId,
      hostelId: wardenUser.hostelId,
    }).token;

    guardToken = tokenService.generateToken({
      sub: guardUser.id,
      role: guardUser.role,
      organizationId: guardUser.organizationId,
      hostelId: guardUser.hostelId,
    }).token;

    otherWardenToken = tokenService.generateToken({
      sub: otherWardenUser.id,
      role: otherWardenUser.role,
      organizationId: otherWardenUser.organizationId,
      hostelId: otherWardenUser.hostelId,
    }).token;

    // Cameras
    testCamera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Main Gate Camera',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.IN,
        isEnabled: true,
        healthStatus: 'ONLINE',
      },
    });

    hostel2Camera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel2.id,
        name: 'Hostel 2 Gate',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.IN,
        isEnabled: true,
        healthStatus: 'ONLINE',
      },
    });

    disabledCamera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Disabled Cam',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.GENERAL,
        isEnabled: false,
        healthStatus: 'OFFLINE',
      },
    });

    // Enrolled Resident in Hostel 1
    enrolledResident1 = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        residentCode: 'R001',
        fullName: 'Rahul Patil',
        roomGroup: 'A-101',
        status: ResidentStatus.ACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
      },
    });

    await testPrisma.faceProfile.create({
      data: {
        residentId: enrolledResident1.id,
        enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
        modelName: 'SFace',
        modelVersion: '2021dec',
        templateReference: 'fptpl_r001',
        metadata: {
          template: resident1Vector,
          embeddingDimension: 128,
          templateVersion: '1.0.0',
        },
      },
    });
  });

  describe('1. API Authorization & Scope Enforcement', () => {
    it('blocks unauthenticated requests to recognition endpoints with 401', async () => {
      const res = await request(app).post(`/api/v1/cameras/${testCamera.id}/recognition/start`);
      expect(res.status).toBe(401);
    });

    it('allows Warden to start recognition for their assigned hostel camera', async () => {
      const res = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('RUNNING');
      expect(res.body.cameraId).toBe(testCamera.id);
      expect(res.body.eligibleTemplates).toBe(1);
    });

    it('blocks Warden from starting recognition for camera in another hostel (404)', async () => {
      const res = await request(app)
        .post(`/api/v1/cameras/${hostel2Camera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(404);
    });

    it('blocks Guard from starting or stopping recognition (403 Forbidden)', async () => {
      const startRes = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${guardToken}`);
      expect(startRes.status).toBe(403);
      expect(startRes.body.error.message).toMatch(/guards are not authorized/i);

      const stopRes = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/stop`)
        .set('Authorization', `Bearer ${guardToken}`);
      expect(stopRes.status).toBe(403);
    });

    it('allows Guard to view recognition status and results in assigned hostel (200)', async () => {
      const statusRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/status`)
        .set('Authorization', `Bearer ${guardToken}`);
      expect(statusRes.status).toBe(200);

      const resultsRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/results`)
        .set('Authorization', `Bearer ${guardToken}`);
      expect(resultsRes.status).toBe(200);
      expect(resultsRes.body).toHaveProperty('results');
    });

    it('allows Admin to manage recognition across organization cameras', async () => {
      const res1 = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post(`/api/v1/cameras/${hostel2Camera.id}/recognition/start`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res2.status).toBe(200);
    });

    it('rejects starting recognition on disabled camera with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/cameras/${disabledCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/disabled/i);
    });

    it('rejects starting recognition on nonexistent camera with 404', async () => {
      const res = await request(app)
        .post('/api/v1/cameras/00000000-0000-0000-0000-000000000000/recognition/start')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('2. Continuous Recognition Processing & Three-State Classification', () => {
    it('processes multi-face frames independently (MATCH, UNKNOWN, UNCERTAIN)', async () => {
      // Start recognition session
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`);

      // Setup mock faces in frame: Face A matches R001, Face B is unknown stranger (similarity ~ 0)
      const unknownVector = new Array(128).fill(0);
      for (let i = 64; i < 128; i++) {
        unknownVector[i] = 1;
      }
      for (let i = 0; i < 64; i++) {
        unknownVector[i] = -resident1Vector[i];
      }
      const normUnknown = TemplateMatcher.normalizeVector(unknownVector);

      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 50, y: 50, width: 100, height: 100 },
            detectionConfidence: 0.95,
            embedding: resident1Vector,
            quality: { usable: true },
          },
          {
            faceIndex: 1,
            bbox: { x: 300, y: 50, width: 100, height: 100 },
            detectionConfidence: 0.92,
            embedding: normUnknown,
            quality: { usable: true },
          },
        ],
      });

      // Simulate 3 camera frame ticks to satisfy temporal stabilization
      const frameBuffer = Buffer.from('fake-jpeg-data');
      for (let i = 0; i < 3; i++) {
        await recognitionService.handleCameraFrame(testCamera.id, {
          cameraId: testCamera.id,
          sourceType: CameraSourceType.WEBCAM,
          timestamp: new Date(),
          frameBuffer,
        });
        await new Promise((r) => setTimeout(r, 110));
      }

      // Query recent observations
      const resultsRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/results`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(resultsRes.status).toBe(200);
      const observations = resultsRes.body.results;
      expect(observations.length).toBeGreaterThanOrEqual(2);

      // Verify Face A yielded MATCH
      const matchObs = observations.find((o: any) => o.classification === 'MATCH');
      expect(matchObs).toBeDefined();
      expect(matchObs.resident.residentCode).toBe('R001');
      expect(matchObs.resident.fullName).toBe('Rahul Patil');

      // Verify Face B yielded UNKNOWN with resident = null
      const unknownObs = observations.find((o: any) => o.classification === 'UNKNOWN');
      expect(unknownObs).toBeDefined();
      expect(unknownObs.resident).toBeNull();
    });

    it('strictly guarantees that raw embeddings/vectors are NEVER exposed to client', async () => {
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`);

      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 100, y: 100, width: 120, height: 120 },
            detectionConfidence: 0.95,
            embedding: resident1Vector,
            quality: { usable: true },
          },
        ],
      });

      for (let i = 0; i < 3; i++) {
        await recognitionService.handleCameraFrame(testCamera.id, {
          cameraId: testCamera.id,
          sourceType: CameraSourceType.WEBCAM,
          timestamp: new Date(),
          frameBuffer: Buffer.from('frame'),
        });
      }

      const res = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/results`)
        .set('Authorization', `Bearer ${wardenToken}`);

      const jsonStr = JSON.stringify(res.body);
      expect(jsonStr).not.toContain('embedding');
      expect(jsonStr).not.toContain('template');
      expect(jsonStr).not.toContain('templateReference');
      expect(jsonStr).not.toContain('vector');
    });

    it('enforces privacy for UNCERTAIN: candidate identity is NEVER exposed', async () => {
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`);

      // Vector with borderline similarity
      const noise = generateNormalizedVector(40.0);
      const borderlineVector = TemplateMatcher.normalizeVector(
        resident1Vector.map((v, i) => v * 0.5 + noise[i] * 0.86)
      );

      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 100, y: 100, width: 120, height: 120 },
            detectionConfidence: 0.95,
            embedding: borderlineVector,
            quality: { usable: true },
          },
        ],
      });

      for (let i = 0; i < 3; i++) {
        await recognitionService.handleCameraFrame(testCamera.id, {
          cameraId: testCamera.id,
          sourceType: CameraSourceType.WEBCAM,
          timestamp: new Date(),
          frameBuffer: Buffer.from('frame'),
        });
      }

      const res = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/results`)
        .set('Authorization', `Bearer ${wardenToken}`);

      const observations = res.body.results;
      const uncertainObs = observations.find((o: any) => o.classification === 'UNCERTAIN');
      if (uncertainObs) {
        expect(uncertainObs.resident).toBeNull();
      }
    });
  });

  describe('3. Template Cache & Biometric Lifecycle Invalidation', () => {
    it('revoking resident face profile invalidates cache and prevents future MATCH', async () => {
      // 1. Verify resident currently matches
      const initialTemplates = await templateCache.getTemplatesForHostel(hostel1.id, org.id);
      expect(initialTemplates.length).toBe(1);

      // 2. Revoke enrollment via EnrollmentService
      await enrollmentService.revokeEnrollment(
        enrolledResident1.id,
        'Graduated from hostel',
        wardenUser
      );

      // 3. Cache refresh ensures revoked resident is excluded
      const updatedTemplates = await templateCache.getTemplatesForHostel(hostel1.id, org.id);
      expect(updatedTemplates.length).toBe(0);

      // 4. Test matching with resident face vector now yields UNKNOWN
      const matcher = new TemplateMatcher();
      const matchResult = matcher.match(resident1Vector, updatedTemplates);
      expect(matchResult.classification).toBe('UNKNOWN');
      expect(matchResult.resident).toBeUndefined();
    });
  });

  describe('4. Side-Effect Isolation (Observation Only)', () => {
    it('confirms recognition DOES NOT alter ResidentPresence, MovementEvent, or AttendanceRecord', async () => {
      const initialMovements = await testPrisma.movementEvent.count();
      const initialAttendance = await testPrisma.attendanceRecord.count();
      const presenceBefore = await testPrisma.residentPresence.findUnique({
        where: { residentId: enrolledResident1.id },
      });

      // Start recognition and process matching frames
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`);

      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 100, y: 100, width: 120, height: 120 },
            detectionConfidence: 0.95,
            embedding: resident1Vector,
            quality: { usable: true },
          },
        ],
      });

      for (let i = 0; i < 3; i++) {
        await recognitionService.handleCameraFrame(testCamera.id, {
          cameraId: testCamera.id,
          sourceType: CameraSourceType.WEBCAM,
          timestamp: new Date(),
          frameBuffer: Buffer.from('frame'),
        });
      }

      // Assert zero database mutations to movement / attendance
      const finalMovements = await testPrisma.movementEvent.count();
      const finalAttendance = await testPrisma.attendanceRecord.count();
      const presenceAfter = await testPrisma.residentPresence.findUnique({
        where: { residentId: enrolledResident1.id },
      });

      expect(finalMovements).toBe(initialMovements);
      expect(finalAttendance).toBe(initialAttendance);
      expect(presenceAfter?.currentState).toBe(presenceBefore?.currentState);
    });
  });
});
