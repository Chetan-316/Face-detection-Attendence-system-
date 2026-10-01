import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient, StaffRole, CameraSourceType, CameraRole, ResidentStatus, FaceEnrollmentStatus } from '@prisma/client';
import { createApp } from '../src/api/app';
import { LifecycleManager } from '../src/common/lifecycle';
import { CameraService } from '../src/modules/cameras/camera.service';
import { RecognitionService } from '../src/modules/recognition/recognition.service';
import { TemplateCache } from '../src/modules/recognition/template-cache';
import { MovementDecisionService } from '../src/modules/movement-decision/movement-decision.service';
import { MovementRecognitionBridge } from '../src/modules/movement-decision/movement-bridge';
import { AttendanceDecisionService } from '../src/modules/attendance-decision/attendance-decision.service';
import { AttendanceRecognitionBridge } from '../src/modules/attendance-decision/attendance-bridge';
import { PythonWorkerClient } from '../src/modules/biometrics/python-worker-client';
import { tokenService } from '../src/api/auth/token.service';
import { config } from '../src/config';

describe('Step 11: Production Hardening, Recovery & System Acceptance Tests', () => {
  let db: PrismaClient;
  let testOrg: any;
  let testHostel: any;
  let adminUser: any;
  let adminToken: string;
  let wardenUser: any;
  let wardenToken: string;

  beforeAll(async () => {
    db = new PrismaClient({
      datasources: { db: { url: config.testDatabaseUrl } },
    });
    await db.$connect();

    // Setup base organization and hostel fixtures
    testOrg = await db.organization.create({
      data: {
        code: `ORG_STEP11_${Date.now()}`,
        name: 'Step 11 Hardening Test Organization',
      },
    });

    testHostel = await db.hostel.create({
      data: {
        organizationId: testOrg.id,
        code: `HST_${Date.now()}`,
        name: 'Step 11 Test Hostel',
      },
    });

    adminUser = await db.user.create({
      data: {
        organizationId: testOrg.id,
        username: `admin_step11_${Date.now()}`,
        passwordHash: 'dummy_hash',
        fullName: 'Step 11 Admin',
        role: StaffRole.ADMIN,
      },
    });
    adminToken = tokenService.generateToken({
      sub: adminUser.id,
      organizationId: testOrg.id,
      hostelId: null,
      role: adminUser.role,
    }).token;

    wardenUser = await db.user.create({
      data: {
        organizationId: testOrg.id,
        hostelId: testHostel.id,
        username: `warden_step11_${Date.now()}`,
        passwordHash: 'dummy_hash',
        fullName: 'Step 11 Warden',
        role: StaffRole.WARDEN,
      },
    });
    wardenToken = tokenService.generateToken({
      sub: wardenUser.id,
      organizationId: testOrg.id,
      hostelId: testHostel.id,
      role: wardenUser.role,
    }).token;
  });


  afterAll(async () => {
    try {
      await db.faceProfile.deleteMany({ where: { resident: { organizationId: testOrg.id } } });
      await db.attendanceRecord.deleteMany({ where: { resident: { organizationId: testOrg.id } } });
      await db.attendanceSession.deleteMany({ where: { organizationId: testOrg.id } });
      await db.residentPresence.deleteMany({ where: { hostelId: testHostel.id } });
      await db.movementEvent.deleteMany({ where: { hostelId: testHostel.id } });
      await db.camera.deleteMany({ where: { organizationId: testOrg.id } });
      await db.resident.deleteMany({ where: { organizationId: testOrg.id } });
      await db.auditLog.deleteMany({ where: { organizationId: testOrg.id } });
      await db.user.deleteMany({ where: { organizationId: testOrg.id } });
      await db.hostel.deleteMany({ where: { organizationId: testOrg.id } });
      await db.organization.deleteMany({ where: { id: testOrg.id } });
    } catch {}
    await db.$disconnect();
  });

  // --------------------------------------------------------------------------
  // 1. STARTUP RELIABILITY & DATABASE UNAVAILABILITY (Req 4, 5)
  // --------------------------------------------------------------------------
  describe('Startup Reliability & Database Failure Handling', () => {
    it('fails clearly and does not enter a half-running state when database is unreachable at startup', async () => {
      const mockBrokenDb = {
        $connect: vi.fn().mockRejectedValue(new Error('Connection refused: 5432')),
        $queryRaw: vi.fn(),
        $disconnect: vi.fn(),
      } as unknown as PrismaClient;

      const lifecycle = new LifecycleManager(mockBrokenDb);

      await expect(lifecycle.verifyDatabaseStartup()).rejects.toThrow(
        /Fatal: PostgreSQL database is unreachable at startup/i
      );
    });

    it('succeeds startup verification when database is reachable', async () => {
      const lifecycle = new LifecycleManager(db);
      await expect(lifecycle.verifyDatabaseStartup()).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 2. READINESS & HEALTH ENDPOINTS (Req 6, 7)
  // --------------------------------------------------------------------------
  describe('Readiness & Health Endpoints', () => {
    it('GET /ready returns 200 with status READY when database is reachable', async () => {
      const app = createApp(db);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY');
      expect(res.body.database).toBe('CONNECTED');
      expect(res.body.timestamp).toBeDefined();
    });

    it('GET /ready returns 503 with status NOT_READY when database is disconnected', async () => {
      const mockBrokenDb = {
        $queryRaw: vi.fn().mockRejectedValue(new Error('Connection lost')),
      } as unknown as PrismaClient;

      const app = createApp(mockBrokenDb);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('NOT_READY');
      expect(res.body.database).toBe('DISCONNECTED');
    });

    it('GET /ready does NOT require cameras to be online (readiness is decoupled from operational cameras)', async () => {
      // Ensure all cameras are OFFLINE
      const offlineCam = await db.camera.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          name: 'Offline Readiness Cam',
          sourceType: CameraSourceType.WEBCAM,
          role: CameraRole.GENERAL,
          healthStatus: 'OFFLINE',
        },
      });

      const app = createApp(db);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY');

      await db.camera.delete({ where: { id: offlineCam.id } });
    });

    it('GET /health is fast cheap liveness and returns 200 without accessing PostgreSQL (Req 1, 7)', async () => {
      const mockQueryRaw = vi.fn().mockRejectedValue(new Error('PostgreSQL database unreachable'));
      const mockFailingDb = {
        $queryRaw: mockQueryRaw,
      } as unknown as PrismaClient;

      const app = createApp(mockFailingDb);
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
      expect(res.body.service).toBe('PRAVAHAx');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.stage).toBeUndefined();
      expect(res.body.database).toBeUndefined();
      // Assert database query was NOT performed (Req 7)
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('GET /ready returns 503 NOT_READY with sanitized non-leaking payload when DB fails (Req 2, 8)', async () => {
      const sensitiveDbError = 'Connection refused at postgresql://postgres:SuperSecretPassword123@10.0.0.1:5433/pravahax_db';
      const mockFailingDb = {
        $queryRaw: vi.fn().mockRejectedValue(new Error(sensitiveDbError)),
      } as unknown as PrismaClient;

      const app = createApp(mockFailingDb);
      const res = await request(app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        status: 'NOT_READY',
        database: 'DISCONNECTED',
      });
      // Assert raw DB error string is NOT exposed in response (Req 8)
      expect(JSON.stringify(res.body)).not.toContain('SuperSecretPassword123');
      expect(JSON.stringify(res.body)).not.toContain('Connection refused');
      expect(res.body.error).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 3. GRACEFUL SHUTDOWN & IDEMPOTENCY (Req 8, 9)
  // --------------------------------------------------------------------------
  describe('Graceful Shutdown & Idempotency', () => {
    it('shuts down cleanly and idempotently when called multiple times (shutdown() -> shutdown())', async () => {
      const mockCameraService = {
        shutdownAll: vi.fn().mockResolvedValue(undefined),
      } as unknown as CameraService;

      const mockWorkerClient = {
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as PythonWorkerClient;

      const mockServer = {
        close: vi.fn((cb?: (err?: Error) => void) => {
          if (cb) cb();
          return mockServer;
        }),
      } as any;

      const mockDb = {
        $disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as PrismaClient;

      const lifecycle = new LifecycleManager(mockDb, {
        cameraService: mockCameraService,
        workerClient: mockWorkerClient,
      });
      lifecycle.setServer(mockServer);

      // First shutdown invocation
      await lifecycle.shutdown('SIGTERM');
      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(mockCameraService.shutdownAll).toHaveBeenCalledTimes(1);
      expect(mockWorkerClient.stop).toHaveBeenCalledTimes(1);
      expect(mockDb.$disconnect).toHaveBeenCalledTimes(1);

      // Second shutdown invocation (idempotent duplicate call)
      await lifecycle.shutdown('SIGINT');
      // Must NOT call cleanup second time
      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(mockCameraService.shutdownAll).toHaveBeenCalledTimes(1);
      expect(mockWorkerClient.stop).toHaveBeenCalledTimes(1);
      expect(mockDb.$disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 4. PRODUCTION SAFETY GUARDS (Req 75, 76, 77)
  // --------------------------------------------------------------------------
  describe('Production Environment Safety Guards', () => {
    it('rejects startup in production if default dev JWT_SECRET is configured', () => {
      const origEnv = process.env.NODE_ENV;
      const origJwt = config.jwtSecret;

      try {
        process.env.NODE_ENV = 'production';
        config.jwtSecret = 'dev_secret_pravahax_attendance_movement_2026_key';

        const lifecycle = new LifecycleManager(db);
        expect(() => lifecycle.validateEnvironment()).toThrow(
          /JWT_SECRET must be configured with a secure random key/i
        );
      } finally {
        process.env.NODE_ENV = origEnv;
        config.jwtSecret = origJwt;
      }
    });

    it('rejects startup in production if BIOMETRIC_MOCK=true', () => {
      const origEnv = process.env.NODE_ENV;
      const origMock = process.env.BIOMETRIC_MOCK;
      const origCors = process.env.CORS_ORIGIN;
      const origJwt = config.jwtSecret;

      try {
        process.env.NODE_ENV = 'production';
        process.env.BIOMETRIC_MOCK = 'true';
        process.env.CORS_ORIGIN = 'https://attendance.example.com';
        config.jwtSecret = 'a_very_long_secure_custom_production_key_1234567890';

        const lifecycle = new LifecycleManager(db);
        expect(() => lifecycle.validateEnvironment()).toThrow(
          /BIOMETRIC_MOCK cannot be enabled in production environment/i
        );
      } finally {
        process.env.NODE_ENV = origEnv;
        process.env.BIOMETRIC_MOCK = origMock;
        if (origCors !== undefined) process.env.CORS_ORIGIN = origCors;
        config.jwtSecret = origJwt;
      }
    });

    it('rejects startup in production if CORS_ORIGIN is missing (Req 4, 6)', () => {
      const origEnv = process.env.NODE_ENV;
      const origCors = process.env.CORS_ORIGIN;
      const origJwt = config.jwtSecret;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.CORS_ORIGIN;
        config.jwtSecret = 'a_very_long_secure_custom_production_key_1234567890';

        const lifecycle = new LifecycleManager(db);
        expect(() => lifecycle.validateEnvironment()).toThrow(
          /CORS_ORIGIN must contain explicit trusted frontend origin\(s\)/i
        );
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origCors !== undefined) process.env.CORS_ORIGIN = origCors;
        config.jwtSecret = origJwt;
      }
    });

    it('rejects startup in production if CORS_ORIGIN is wildcard "*" (Req 4, 6)', () => {
      const origEnv = process.env.NODE_ENV;
      const origCors = process.env.CORS_ORIGIN;
      const origJwt = config.jwtSecret;

      try {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGIN = '*';
        config.jwtSecret = 'a_very_long_secure_custom_production_key_1234567890';

        const lifecycle = new LifecycleManager(db);
        expect(() => lifecycle.validateEnvironment()).toThrow(
          /CORS_ORIGIN must contain explicit trusted frontend origin\(s\)/i
        );
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origCors !== undefined) process.env.CORS_ORIGIN = origCors;
        config.jwtSecret = origJwt;
      }
    });

    it('allows startup in production with explicit single origin (Req 6)', () => {
      const origEnv = process.env.NODE_ENV;
      const origCors = process.env.CORS_ORIGIN;
      const origJwt = config.jwtSecret;

      try {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGIN = 'https://attendance.example.com';
        config.jwtSecret = 'a_very_long_secure_custom_production_key_1234567890';

        const lifecycle = new LifecycleManager(db);
        expect(() => lifecycle.validateEnvironment()).not.toThrow();
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origCors !== undefined) process.env.CORS_ORIGIN = origCors;
        config.jwtSecret = origJwt;
      }
    });

    it('allows startup in production with multiple explicit origins (Req 6)', () => {
      const origEnv = process.env.NODE_ENV;
      const origCors = process.env.CORS_ORIGIN;
      const origJwt = config.jwtSecret;

      try {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGIN = 'https://admin.example.com,https://warden.example.com';
        config.jwtSecret = 'a_very_long_secure_custom_production_key_1234567890';

        const lifecycle = new LifecycleManager(db);
        expect(() => lifecycle.validateEnvironment()).not.toThrow();
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origCors !== undefined) process.env.CORS_ORIGIN = origCors;
        config.jwtSecret = origJwt;
      }
    });

    it('rejects testInputOverride in POST /cameras/test-connection when in production', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const app = createApp(db);

        const res = await request(app)
          .post('/api/v1/cameras/test-connection')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            sourceType: 'RTSP',
            testInputOverride: 'testsrc=size=640x480:rate=15',
          });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/Synthetic camera testInputOverride is disabled in production/i);
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('rejects testInputOverride in POST /cameras camera creation when in production', async () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const app = createApp(db);

        const res = await request(app)
          .post('/api/v1/cameras')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Malicious Synthetic Cam',
            sourceType: 'RTSP',
            role: 'IN',
            configMetadata: {
              testInputOverride: 'testsrc=size=640x480:rate=15',
            },
          });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/Synthetic camera testInputOverride is disabled in production/i);
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. CAMERA ROLE CHANGE & CAMERA DISABLE DETERMINISM (Req 18, 19)
  // --------------------------------------------------------------------------
  describe('Camera Role Change & Camera Disable Runtime Determinism', () => {
    let testCamera: any;
    let cameraService: CameraService;
    let recognitionService: RecognitionService;

    beforeAll(async () => {
      testCamera = await db.camera.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          name: 'Dynamic Role Test Cam',
          sourceType: CameraSourceType.WEBCAM,
          role: CameraRole.IN,
          isEnabled: true,
          configMetadata: { deviceIndex: 0 },
        },
      });

      cameraService = new CameraService(db);
      recognitionService = new RecognitionService(db, cameraService);
      cameraService.onCameraChange((cam, prevRole) => {
        recognitionService.handleCameraChange(cam, prevRole);
      });
    });

    afterAll(async () => {
      try {
        await db.camera.delete({ where: { id: testCamera.id } });
      } catch {}
    });

    it('updates camera role from IN to ATTENDANCE and re-routes bridge listeners deterministically', async () => {
      const mockMovementBridge = {
        attachSession: vi.fn(),
        detachSession: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as any;

      const mockAttendanceBridge = {
        attachSession: vi.fn(),
        detachSession: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as any;

      recognitionService.setMovementBridge(mockMovementBridge);
      recognitionService.setAttendanceBridge(mockAttendanceBridge);

      // Simulate active session in recognitionService
      (recognitionService as any).activeSessions.set(testCamera.id, {
        sessionId: 'sess-dynamic-1',
        cameraId: testCamera.id,
        state: 'RUNNING',
        recentObservations: [],
        eventEmitter: {
          emit: vi.fn(),
          on: vi.fn(),
          off: vi.fn(),
          removeAllListeners: vi.fn(),
        },
      });

      // Update camera role to ATTENDANCE via cameraService
      await cameraService.updateCamera(testCamera.id, {
        role: CameraRole.ATTENDANCE,
      });

      // Verification: old movementBridge must be detached, new attendanceBridge must be attached
      expect(mockMovementBridge.detachSession).toHaveBeenCalledWith(testCamera.id, expect.anything());
      expect(mockAttendanceBridge.attachSession).toHaveBeenCalledWith(
        testCamera.id,
        CameraRole.ATTENDANCE,
        expect.anything()
      );
    });

    it('disabling camera immediately stops recognition session and cleans up resources', async () => {
      const mockUnsubscribe = vi.fn();
      const mockEventEmitter = {
        emit: vi.fn(),
        removeAllListeners: vi.fn(),
      };

      (recognitionService as any).activeSessions.set(testCamera.id, {
        sessionId: 'sess-disable-test',
        cameraId: testCamera.id,
        state: 'RUNNING',
        unsubscribeStream: mockUnsubscribe,
        eventEmitter: mockEventEmitter,
        stabilizer: { clear: vi.fn() },
      });

      // Disable camera
      await cameraService.updateCamera(testCamera.id, {
        isEnabled: false,
      });

      // Active session should be completely deleted and stream unsubscribed
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('stopped');
      expect((recognitionService as any).activeSessions.get(testCamera.id)).toBeUndefined();

      // Subsequent attempt to start recognition on disabled camera must throw ValidationError
      await expect(
        recognitionService.startRecognition(testCamera.id, {
          id: wardenUser.id,
          role: StaffRole.WARDEN,
          organizationId: testOrg.id,
          hostelId: testHostel.id,
        })
      ).rejects.toThrow(/is disabled/i);
    });
  });

  // --------------------------------------------------------------------------
  // 6. RESIDENT DEACTIVATION DURING RECOGNITION (Req 20)
  // --------------------------------------------------------------------------
  describe('Resident Deactivation Defense-in-Depth', () => {
    let inactiveResident: any;
    let gateCamera: any;

    beforeAll(async () => {
      inactiveResident = await db.resident.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          residentCode: `INACT_${Date.now()}`,
          fullName: 'Deactivated Resident',
          roomGroup: 'Room 99',
          status: ResidentStatus.INACTIVE,
          faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
        },
      });

      gateCamera = await db.camera.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          name: 'Gate Cam for Inactive Test',
          sourceType: CameraSourceType.WEBCAM,
          role: CameraRole.IN,
          isEnabled: true,
        },
      });
    });

    afterAll(async () => {
      try {
        await db.resident.delete({ where: { id: inactiveResident.id } });
        await db.camera.delete({ where: { id: gateCamera.id } });
      } catch {}
    });

    it('MovementDecisionService rejects deactivated resident with RESIDENT_INACTIVE and creates ZERO movement events', async () => {
      const decisionService = new MovementDecisionService(db);
      decisionService.setGlobalAutomation(true);

      const decision = await decisionService.evaluateObservation({
        id: `obs_inact_${Date.now()}`,
        faceId: 'trk-inact',
        cameraId: gateCamera.id,
        classification: 'MATCH',
        resident: {
          id: inactiveResident.id,
          residentCode: inactiveResident.residentCode,
          fullName: inactiveResident.fullName,
        },
        similarity: 0.92,
        secondBestSimilarity: 0.2,
        detectedAt: new Date().toISOString(),
        bbox: [10, 10, 100, 100],
        qualityUsable: true,
      } as any);

      expect(decision.status).toBe('RESIDENT_INACTIVE');
      expect(decision.movementEventId).toBeUndefined();

      // Verify ZERO movement events in DB
      const dbEvents = await db.movementEvent.findMany({
        where: { residentId: inactiveResident.id },
      });
      expect(dbEvents.length).toBe(0);
    });

    it('AttendanceDecisionService rejects deactivated resident with RESIDENT_INACTIVE and creates ZERO attendance records', async () => {
      const decisionService = new AttendanceDecisionService(db);

      const attCamera = await db.camera.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          name: 'Attendance Cam for Inactive Test',
          sourceType: CameraSourceType.WEBCAM,
          role: CameraRole.ATTENDANCE,
          isEnabled: true,
        },
      });

      // Create active attendance session
      const session = await db.attendanceSession.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          cameraId: attCamera.id,
          title: 'Night Check Inactive Test',
          sessionType: 'NIGHT',
          status: 'ACTIVE',
          attendanceDate: new Date(),
          startTime: new Date(Date.now() - 60000),
          endTime: new Date(Date.now() + 60000),
          createdByUserId: adminUser.id,
        },
      });

      const decision = await decisionService.evaluateObservation({
        id: `obs_att_inact_${Date.now()}`,
        faceId: 'trk-att-inact',
        cameraId: attCamera.id,
        classification: 'MATCH',
        resident: {
          id: inactiveResident.id,
          residentCode: inactiveResident.residentCode,
          fullName: inactiveResident.fullName,
        },
        similarity: 0.95,
        secondBestSimilarity: 0.1,
        detectedAt: new Date().toISOString(),
        bbox: [10, 10, 100, 100],
        qualityUsable: true,
      } as any);

      expect(decision.status).toBe('RESIDENT_INACTIVE');

      // Verify ZERO attendance records
      const records = await db.attendanceRecord.findMany({
        where: { residentId: inactiveResident.id },
      });
      expect(records.length).toBe(0);

      await db.attendanceSession.delete({ where: { id: session.id } });
      await db.camera.delete({ where: { id: attCamera.id } });
    });
  });

  // --------------------------------------------------------------------------
  // 7. TEMPLATE CACHE & VERSION COMPATIBILITY FILTERING (Req 22, 23)
  // --------------------------------------------------------------------------
  describe('Template Cache Hardening & Version Compatibility', () => {
    let enrolledResident: any;

    beforeAll(async () => {
      enrolledResident = await db.resident.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          residentCode: `TPL_${Date.now()}`,
          fullName: 'Template Compatibility Resident',
          roomGroup: 'Room 101',
          status: ResidentStatus.ACTIVE,
          faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
        },
      });
    });

    afterAll(async () => {
      try {
        await db.faceProfile.deleteMany({ where: { residentId: enrolledResident.id } });
        await db.resident.delete({ where: { id: enrolledResident.id } });
      } catch {}
    });

    it('rejects profiles with incompatible embeddingDimension !== 128', async () => {
      const cache = new TemplateCache(db, 1);

      // Create profile with dimension 512
      const badDimProfile = await db.faceProfile.create({
        data: {
          residentId: enrolledResident.id,
          enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
          modelName: 'SFace',
          modelVersion: '2021dec',
          templateReference: 'fptpl_bad_dim',
          metadata: {
            template: new Array(128).fill(0.1),
            embeddingDimension: 512, // Incompatible dimension!
            templateVersion: '1.0.0',
          },
        },
      });

      const templates = await cache.getTemplatesForHostel(testHostel.id, testOrg.id);
      expect(templates.find((t) => t.residentId === enrolledResident.id)).toBeUndefined();

      await db.faceProfile.delete({ where: { id: badDimProfile.id } });
    });

    it('rejects profiles with incompatible templateVersion !== 1.0.0', async () => {
      const cache = new TemplateCache(db, 1);

      // Create profile with unsupported templateVersion
      const badVerProfile = await db.faceProfile.create({
        data: {
          residentId: enrolledResident.id,
          enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
          modelName: 'SFace',
          modelVersion: '2021dec',
          templateReference: 'fptpl_bad_ver',
          metadata: {
            template: new Array(128).fill(0.1),
            embeddingDimension: 128,
            templateVersion: '2.0.0-unsupported',
          },
        },
      });

      const templates = await cache.getTemplatesForHostel(testHostel.id, testOrg.id);
      expect(templates.find((t) => t.residentId === enrolledResident.id)).toBeUndefined();

      await db.faceProfile.delete({ where: { id: badVerProfile.id } });
    });

    it('loads valid SFace 2021dec template with 128 dimensions and 1.0.0 templateVersion', async () => {
      const cache = new TemplateCache(db, 1);

      const validProfile = await db.faceProfile.create({
        data: {
          residentId: enrolledResident.id,
          enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
          modelName: 'SFace',
          modelVersion: '2021dec',
          templateReference: 'fptpl_valid',
          metadata: {
            template: new Array(128).fill(0.1),
            embeddingDimension: 128,
            templateVersion: '1.0.0',
          },
        },
      });

      const templates = await cache.getTemplatesForHostel(testHostel.id, testOrg.id);
      const match = templates.find((t) => t.residentId === enrolledResident.id);
      expect(match).toBeDefined();
      expect(match?.residentCode).toBe(enrolledResident.residentCode);
      expect(match?.template.length).toBe(128);

      await db.faceProfile.delete({ where: { id: validProfile.id } });
    });
  });

  // --------------------------------------------------------------------------
  // 8. DATA PRIVACY & REDACTION (Req 37, 38)
  // --------------------------------------------------------------------------
  describe('Face Data & Log Privacy', () => {
    it('ensures GET /api/v1/cameras/:id NEVER exposes password or raw credentials', async () => {
      const cam = await db.camera.create({
        data: {
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          name: 'Secret Cam',
          sourceType: CameraSourceType.RTSP,
          role: CameraRole.GENERAL,
          configMetadata: {
            rtspUrl: 'rtsp://operator:TopSecretPassword123@192.168.1.100:554/feed',
            username: 'operator',
            password: 'TopSecretPassword123',
          },
        },
      });

      const app = createApp(db);
      const res = await request(app)
        .get(`/api/v1/cameras/${cam.id}`)
        .set('Authorization', `Bearer ${wardenToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.configMetadata.password).toBeUndefined();
      expect(res.body.data.configMetadata.username).toBe('***');
      expect(res.body.data.configMetadata.rtspUrl).toContain('***:***@');
      expect(res.body.data.configMetadata.credentialsConfigured).toBe(true);

      const rawJson = JSON.stringify(res.body);
      expect(rawJson).not.toContain('TopSecretPassword123');

      await db.camera.delete({ where: { id: cam.id } });
    });
  });
});
