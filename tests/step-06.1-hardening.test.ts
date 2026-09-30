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

describe('Step 06.1: Hardening Regression Tests', () => {
  let app: any;
  let cameraService: CameraService;
  let mockWorkerClient: PythonWorkerClient;
  let enrollmentService: EnrollmentService;
  let recognitionService: RecognitionService;
  let templateCache: TemplateCache;

  let org: any;
  let hostel1: any;
  let hostel2: any;

  let adminUser: any;
  let wardenUser: any;
  let otherWardenUser: any;

  let adminToken: string;
  let wardenToken: string;
  let otherWardenToken: string;

  let testCamera: any;
  let cameraB: any;

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

    org = await testPrisma.organization.create({
      data: { code: 'ORG_A', name: 'Campus Alpha', isActive: true },
    });

    hostel1 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H1', name: 'Alpha Hostel 1', isActive: true },
    });
    hostel2 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H2', name: 'Alpha Hostel 2', isActive: true },
    });

    const pwHash = await bcrypt.hash('Secret123!', 4);

    adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: null,
        username: 'admin_test',
        fullName: 'Admin User',
        email: 'admin@alpha.com',
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
        email: 'warden1@alpha.com',
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
        email: 'warden2@alpha.com',
        passwordHash: pwHash,
        role: StaffRole.WARDEN,
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

    otherWardenToken = tokenService.generateToken({
      sub: otherWardenUser.id,
      role: otherWardenUser.role,
      organizationId: otherWardenUser.organizationId,
      hostelId: otherWardenUser.hostelId,
    }).token;

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

    cameraB = await testPrisma.camera.create({
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

    enrolledResident1 = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        residentCode: 'R001',
        fullName: 'Rahul Patil',
        roomGroup: 'Room-101',
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
        templateReference: 'internal_template_v1',
        enrolledByUserId: wardenUser.id,
        metadata: {
          modelName: 'SFace',
          modelVersion: '2021dec',
          templateVersion: 1,
          embeddingDimension: 128,
          template: resident1Vector,
        },
      },
    });
  });

  describe('1. Recognition Quality Semantics Hardening', () => {
    it('proves unusable face becomes QUALITY_INSUFFICIENT and does NOT become UNKNOWN', async () => {
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      // Low quality / unusable face (e.g. TOO_BLURRY, missing embedding)
      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 50, y: 50, width: 40, height: 40 },
            detectionConfidence: 0.88,
            embedding: null as any,
            quality: {
              usable: false,
              rejectionReason: 'TOO_BLURRY',
              blurScore: 12.4,
              brightness: 60.0,
            },
          },
        ],
      });

      await recognitionService.handleCameraFrame(testCamera.id, {
        cameraId: testCamera.id,
        sourceType: CameraSourceType.WEBCAM,
        timestamp: new Date(),
        frameBuffer: Buffer.from('fake-frame'),
      });

      const resultsRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/results`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      const obs = resultsRes.body.results[0];
      expect(obs).toBeDefined();
      expect(obs.classification).toBe('QUALITY_INSUFFICIENT');
      expect(obs.classification).not.toBe('UNKNOWN');
      expect(obs.qualityUsable).toBe(false);
      expect(obs.qualityReason).toBe('TOO_BLURRY');
      expect(obs.resident).toBeNull();
    });

    it('proves unusable face does NOT increment unknown count and increments qualityInsufficients', async () => {
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 50, y: 50, width: 40, height: 40 },
            detectionConfidence: 0.88,
            embedding: null as any,
            quality: { usable: false, rejectionReason: 'FACE_TOO_SMALL' },
          },
        ],
      });

      await recognitionService.handleCameraFrame(testCamera.id, {
        cameraId: testCamera.id,
        sourceType: CameraSourceType.WEBCAM,
        timestamp: new Date(),
        frameBuffer: Buffer.from('fake-frame'),
      });

      const statusRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/status`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(statusRes.body.unknowns).toBe(0); // MUST NOT increment unknowns!
      expect(statusRes.body.qualityInsufficients).toBe(1); // MUST increment qualityInsufficients!
    });

    it('proves unusable face does NOT call TemplateMatcher', async () => {
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      const matcherSpy = vi.spyOn(TemplateMatcher.prototype, 'match');

      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 50, y: 50, width: 40, height: 40 },
            detectionConfidence: 0.85,
            embedding: null as any,
            quality: { usable: false, rejectionReason: 'LOW_DETECTION_CONFIDENCE' },
          },
        ],
      });

      await recognitionService.handleCameraFrame(testCamera.id, {
        cameraId: testCamera.id,
        sourceType: CameraSourceType.WEBCAM,
        timestamp: new Date(),
        frameBuffer: Buffer.from('fake-frame'),
      });

      expect(matcherSpy).not.toHaveBeenCalled();
    });

    it('proves usable unmatched face becomes UNKNOWN and increments unknown count', async () => {
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      // Usable face vector with zero similarity to R001
      const unknownVector = new Array(128).fill(0).map((_, i) => (i === 64 ? 1 : 0));

      vi.spyOn(mockWorkerClient, 'extractFaces').mockResolvedValue({
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 100, y: 100, width: 120, height: 120 },
            detectionConfidence: 0.96,
            embedding: unknownVector,
            quality: { usable: true },
          },
        ],
      });

      // Process 3 frames to satisfy temporal stabilization
      for (let i = 0; i < 3; i++) {
        await recognitionService.handleCameraFrame(testCamera.id, {
          cameraId: testCamera.id,
          sourceType: CameraSourceType.WEBCAM,
          timestamp: new Date(),
          frameBuffer: Buffer.from('fake-frame'),
        });
        await new Promise((r) => setTimeout(r, 110));
      }

      const statusRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/status`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(statusRes.body.unknowns).toBeGreaterThanOrEqual(1);

      const resultsRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/results`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      const obs = resultsRes.body.results[0];
      expect(obs.classification).toBe('UNKNOWN');
      expect(obs.resident).toBeNull();
      expect(obs.qualityUsable).toBe(true);
    });
  });

  describe('2. Authentication & Stream Token Hardening', () => {
    it('normal APIs reject ?token=<JWT> query parameter with 401', async () => {
      // Attempting to query /residents with ?token= query parameter instead of Authorization header
      const res = await request(app)
        .get(`/api/v1/residents?token=${wardenToken}`)
        .expect(401);

      expect(res.body.error).toBeDefined();
    });

    it('normal APIs accept standard Authorization: Bearer <JWT> header', async () => {
      const res = await request(app)
        .get('/api/v1/residents')
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('generates short-lived camera-scoped stream token via POST /stream-token', async () => {
      const res = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/stream-token`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(res.body.streamToken).toBeDefined();
      expect(res.body.expiresIn).toBe(60);
    });

    it('SSE events endpoint accepts valid stream token for the correct camera', async () => {
      // 1. Get stream token
      const tokenRes = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/stream-token`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      const { streamToken } = tokenRes.body;

      // 2. Connect to SSE events, verify 200 + text/event-stream, then close stream
      const http = await import('http');
      const server = http.createServer(app);

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const address = server.address();
          if (!address || typeof address === 'string') {
            server.close();
            return reject(new Error('Invalid server address'));
          }

          const req = http.get(
            `http://localhost:${address.port}/api/v1/cameras/${testCamera.id}/recognition/events?streamToken=${streamToken}`,
            (res) => {
              try {
                expect(res.statusCode).toBe(200);
                expect(res.headers['content-type']).toContain('text/event-stream');
                req.destroy();
                server.close(() => resolve());
              } catch (e) {
                req.destroy();
                server.close(() => reject(e));
              }
            }
          );

          req.on('error', () => {
            server.close(() => resolve());
          });
        });
      });
    });

    it('rejects expired stream token on SSE endpoint with 401', async () => {
      // Generate expired token (-1 second)
      const expiredToken = tokenService.generateStreamToken(
        {
          sub: wardenUser.id,
          cameraId: testCamera.id,
          organizationId: org.id,
          hostelId: hostel1.id,
          role: wardenUser.role,
        },
        -1
      ).streamToken;

      await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/recognition/events?streamToken=${expiredToken}`)
        .expect(401);
    });

    it('rejects stream token issued for Camera A when accessing Camera B', async () => {
      // Token issued for testCamera (Hostel 1)
      const tokenRes = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/stream-token`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const tokenForCamA = tokenRes.body.streamToken;

      // Attempt to access cameraB using tokenForCamA -> MUST be rejected with 401
      await request(app)
        .get(`/api/v1/cameras/${cameraB.id}/recognition/events?streamToken=${tokenForCamA}`)
        .expect(401);
    });

    it('blocks Warden from obtaining stream token or accessing SSE for cross-hostel camera', async () => {
      // wardenUser belongs to hostel1; cameraB belongs to hostel2
      await request(app)
        .post(`/api/v1/cameras/${cameraB.id}/recognition/stream-token`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(404);

      await request(app)
        .get(`/api/v1/cameras/${cameraB.id}/recognition/events?streamToken=invalid_token`)
        .expect(401);
    });

    it('strictly prevents stream token from authenticating normal REST APIs', async () => {
      const tokenRes = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/stream-token`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      const { streamToken } = tokenRes.body;

      // 1. /residents
      await request(app)
        .get('/api/v1/residents')
        .set('Authorization', `Bearer ${streamToken}`)
        .expect(401);

      // 2. /cameras
      await request(app)
        .get('/api/v1/cameras')
        .set('Authorization', `Bearer ${streamToken}`)
        .expect(401);

      // 3. /api/v1/auth/me
      await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${streamToken}`)
        .expect(401);

      // 4. /recognition/start
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/start`)
        .set('Authorization', `Bearer ${streamToken}`)
        .expect(401);

      // 5. /recognition/stop
      await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/recognition/stop`)
        .set('Authorization', `Bearer ${streamToken}`)
        .expect(401);
    });
  });
});
