import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import {
  CameraSourceType,
  CameraRole,
  CameraHealthStatus,
  StaffRole,
  UserStatus,
  PresenceState,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { CameraService } from '../src/modules/cameras/camera.service';
import { CameraAdapterFactory } from '../src/modules/cameras/camera-adapter.factory';
import { RtspAdapter } from '../src/modules/cameras/adapters/rtsp.adapter';
import { RtspFrameSource } from '../src/modules/cameras/frame-sources/rtsp-frame-source';
import { redactRtspUrl, buildAuthenticatedRtspUrl, sanitizeCameraConfig } from '../src/modules/cameras/utils/url-redaction';
import { checkFfmpegDiagnostic } from '../src/modules/cameras/utils/ffmpeg-locator';
import { RecognitionService } from '../src/modules/recognition/recognition.service';
import { MovementDecisionService } from '../src/modules/movement-decision/movement-decision.service';
import { AttendanceDecisionService } from '../src/modules/attendance-decision/attendance-decision.service';
import { ResidentService } from '../src/modules/residents/resident.service';

describe('Step 10: Production RTSP Camera Streaming & Decoupled Hardware Pipeline', () => {
  let app: any;
  let cameraService: CameraService;
  let recognitionService: RecognitionService;

  let org: any;
  let hostel1: any;
  let adminUser: any;
  let wardenUser: any;
  let adminToken: string;
  let wardenToken: string;

  beforeAll(async () => {
    cameraService = new CameraService(testPrisma);
    recognitionService = new RecognitionService(testPrisma, cameraService);
    app = createApp(testPrisma, { cameraService, recognitionService });
  });

  beforeEach(async () => {
    await resetTestDatabase();

    org = await testPrisma.organization.create({
      data: { code: 'TEST_ORG_RTSP', name: 'Test Org RTSP', isActive: true },
    });

    hostel1 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H_RTSP_1', name: 'Hostel RTSP 1', isActive: true },
    });

    const pwHash = await bcrypt.hash('TestPass123!', 4);

    adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        username: 'admin_rtsp',
        fullName: 'Admin RTSP',
        passwordHash: pwHash,
        role: StaffRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    wardenUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        username: 'warden_rtsp',
        fullName: 'Warden RTSP',
        passwordHash: pwHash,
        role: StaffRole.WARDEN,
        status: UserStatus.ACTIVE,
      },
    });

    adminToken = tokenService.generateToken({
      sub: adminUser.id,
      organizationId: adminUser.organizationId,
      hostelId: null,
      role: adminUser.role,
    }).token;

    wardenToken = tokenService.generateToken({
      sub: wardenUser.id,
      organizationId: wardenUser.organizationId,
      hostelId: wardenUser.hostelId,
      role: wardenUser.role,
    }).token;
  });

  afterAll(async () => {
    await cameraService.shutdownAll();
    await testPrisma.$disconnect();
  });

  describe('A. Credential Privacy, Redaction & Audit Safety', () => {
    it('redactRtspUrl masks username and password from any format of RTSP URL', () => {
      const sensitive1 = 'rtsp://admin:SuperSecret@192.168.1.50:554/live';
      const safe1 = redactRtspUrl(sensitive1);
      expect(safe1).toBe('rtsp://***:***@192.168.1.50:554/live');
      expect(safe1).not.toContain('SuperSecret');
      expect(safe1).not.toContain('admin');

      const sensitive2 = 'rtsp://user:P%40ssw0rd!@cctv.local:8554/stream1';
      const safe2 = redactRtspUrl(sensitive2);
      expect(safe2).toBe('rtsp://***:***@cctv.local:8554/stream1');
      expect(safe2).not.toContain('P%40ssw0rd!');

      // User only without password
      const sensitive3 = 'rtsp://viewer@10.0.0.1/live';
      const safe3 = redactRtspUrl(sensitive3);
      expect(safe3).toBe('rtsp://***@10.0.0.1/live');

      // Embedded inside error log
      const logString = 'Error connecting to rtsp://admin:MyPass123@192.168.1.1: connection timed out';
      const safeLog = redactRtspUrl(logString);
      expect(safeLog).toBe('Error connecting to rtsp://***:***@192.168.1.1: connection timed out');
      expect(safeLog).not.toContain('MyPass123');
    });

    it('buildAuthenticatedRtspUrl safely injects username and password for internal FFmpeg', () => {
      const url = buildAuthenticatedRtspUrl('rtsp://192.168.1.50:554/live', 'admin', 'Secr@t!');
      expect(url).toBe('rtsp://admin:Secr%40t!@192.168.1.50:554/live');
    });

    it('sanitizeCameraConfig strips password and redacts rtspUrl while preserving safe metadata', () => {
      const inputConfig = {
        rtspUrl: 'rtsp://admin:SuperSecretPass@192.168.1.50:554/live/ch0',
        username: 'admin',
        password: 'SuperSecretPass',
        transport: 'tcp',
        fps: 15,
        width: 1280,
        height: 720,
      };

      const sanitized = sanitizeCameraConfig(inputConfig);
      expect(sanitized.password).toBeUndefined();
      expect(sanitized.credentialsConfigured).toBe(true);
      expect(sanitized.rtspUrl).toBe('rtsp://***:***@192.168.1.50:554/live/ch0');
      expect(sanitized.host).toBe('192.168.1.50');
      expect(sanitized.port).toBe(554);
      expect(sanitized.path).toBe('/live/ch0');
      expect(sanitized.transport).toBe('tcp');
      expect(sanitized.fps).toBe(15);
      expect(JSON.stringify(sanitized)).not.toContain('SuperSecretPass');
    });

    it('API Redaction: GET /cameras, GET /cameras/:id never leak RTSP credentials to browser', async () => {
      const registered = await request(app)
        .post('/api/v1/cameras')
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({
          name: 'Gate Turnstile RTSP',
          sourceType: 'RTSP',
          role: 'IN',
          configMetadata: {
            rtspUrl: 'rtsp://admin:TopSecretPass123@192.168.1.100:554/h264',
            username: 'admin',
            password: 'TopSecretPass123',
            transport: 'tcp',
          },
        })
        .expect(201);

      // Verify POST response
      expect(registered.body.data.configMetadata.password).toBeUndefined();
      expect(registered.body.data.configMetadata.credentialsConfigured).toBe(true);
      expect(registered.body.data.configMetadata.rtspUrl).toContain('***:***');
      expect(JSON.stringify(registered.body)).not.toContain('TopSecretPass123');

      const camId = registered.body.data.id;

      // Verify GET /api/v1/cameras
      const listRes = await request(app)
        .get('/api/v1/cameras')
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      const found = listRes.body.data.find((c: any) => c.id === camId);
      expect(found).toBeDefined();
      expect(found.configMetadata.password).toBeUndefined();
      expect(found.configMetadata.rtspUrl).not.toContain('TopSecretPass123');
      expect(JSON.stringify(listRes.body)).not.toContain('TopSecretPass123');

      // Verify GET /api/v1/cameras/:id
      const detailRes = await request(app)
        .get(`/api/v1/cameras/${camId}`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(detailRes.body.data.configMetadata.password).toBeUndefined();
      expect(JSON.stringify(detailRes.body)).not.toContain('TopSecretPass123');

      // Verify GET /api/v1/cameras/:id/health
      const healthRes = await request(app)
        .get(`/api/v1/cameras/${camId}/health`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(JSON.stringify(healthRes.body)).not.toContain('TopSecretPass123');

      // Verify Audit Log never stores credentials
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'CAMERA', entityId: camId },
      });
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit?.newValues)).not.toContain('TopSecretPass123');
    });

    it('PUT /api/v1/cameras/:id preserves existing saved password if left blank in update', async () => {
      const created = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Editable RTSP Cam',
        sourceType: CameraSourceType.RTSP,
        configMetadata: {
          rtspUrl: 'rtsp://admin:KeepMePass@192.168.1.10:554/ch0',
          username: 'admin',
          password: 'KeepMePass',
          transport: 'tcp',
        },
      });

      // Update camera name and role without passing password (e.g. from frontend edit form)
      const updateRes = await request(app)
        .put(`/api/v1/cameras/${created.id}`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({
          name: 'Editable RTSP Cam (Updated)',
          role: 'OUT',
          configMetadata: {
            transport: 'tcp',
            // password omitted
          },
        })
        .expect(200);

      expect(updateRes.body.data.name).toBe('Editable RTSP Cam (Updated)');
      expect(updateRes.body.data.role).toBe('OUT');
      expect(updateRes.body.data.configMetadata.password).toBeUndefined();

      // Database should retain the password internally for streaming
      const rawInDb = await testPrisma.camera.findUnique({ where: { id: created.id } });
      expect((rawInDb?.configMetadata as any)?.password).toBe('KeepMePass');
    });
  });

  describe('B. RTSP Connection Test Endpoint', () => {
    it('POST /api/v1/cameras/test-connection probes unsaved stream configuration', async () => {
      // Test synthetic lavfi source via testInputOverride to verify probe mechanics
      const res = await request(app)
        .post('/api/v1/cameras/test-connection')
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({
          sourceType: 'RTSP',
          testInputOverride: 'testsrc=size=640x480:rate=15',
        })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.reachable).toBe(true);
      expect(res.body.data.sourceType).toBe('RTSP');
      expect(res.body.data.resolution).toEqual({ width: 640, height: 480 });
      expect(res.body.data.fps).toBe(15);
      expect(res.body.data.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('POST /api/v1/cameras/:id/test tests connectivity of an existing saved camera', async () => {
      const camera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Saved RTSP Camera for Probe',
        sourceType: CameraSourceType.RTSP,
        configMetadata: {
          testInputOverride: 'testsrc=size=1280x720:rate=20',
          transport: 'tcp',
        },
      });

      const res = await request(app)
        .post(`/api/v1/cameras/${camera.id}/test`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(res.body.data.reachable).toBe(true);
      expect(res.body.data.resolution).toEqual({ width: 1280, height: 720 });
      expect(res.body.data.fps).toBe(20);
    });

    it('Connection test returns friendly error for unreachable host without crashing or leaking secrets', async () => {
      const res = await request(app)
        .post('/api/v1/cameras/test-connection')
        .set('Authorization', `Bearer ${wardenToken}`)
        .send({
          sourceType: 'RTSP',
          rtspUrl: 'rtsp://admin:SecretPass@192.0.2.1:554/nonexistent',
          transport: 'tcp',
        })
        .expect(200);

      expect(res.body.data.reachable).toBe(false);
      expect(res.body.data.message).toBeDefined();
      expect(JSON.stringify(res.body)).not.toContain('SecretPass');
    });
  });

  describe('C. Real FFmpeg RTSP Decode Pipeline & JPEG Extraction', () => {
    it('verifies that local FFmpeg and FFprobe binaries are operational', () => {
      const diag = checkFfmpegDiagnostic();
      expect(diag.available).toBe(true);
      expect(diag.ffmpegVersion).toBeDefined();
      expect(diag.ffprobeVersion).toBeDefined();
      expect(diag.ffmpegPath).toBeTruthy();
    });

    it('CameraAdapterFactory instantiates RtspAdapter for CameraSourceType.RTSP', () => {
      const adapter = CameraAdapterFactory.create(CameraSourceType.RTSP, 'cam-rtsp-factory-1');
      expect(adapter).toBeInstanceOf(RtspAdapter);
      expect(adapter.sourceType).toBe(CameraSourceType.RTSP);
    });

    it('RtspAdapter starts, decodes real JPEG frames, populates latestFrame and snapshots', async () => {
      const adapter = new RtspAdapter('cam-rtsp-real-1');
      await adapter.initialize({
        cameraId: 'cam-rtsp-real-1',
        rtspUrl: 'rtsp://synthetic',
        testInputOverride: 'testsrc=size=640x480:rate=10',
        fps: 10,
        width: 640,
        height: 480,
        connectTimeoutMs: 6000,
      });

      expect(adapter.isActive()).toBe(false);
      expect(await adapter.getHealth()).toBe(CameraHealthStatus.OFFLINE);

      // Start pipeline
      await adapter.start();
      expect(adapter.isActive()).toBe(true);
      expect(await adapter.getHealth()).toBe(CameraHealthStatus.ONLINE);

      // Collect frames
      const frames: any[] = [];
      const unsubscribe = adapter.onFrame((frame) => {
        frames.push(frame);
      });

      // Await frame stream
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(frames.length).toBeGreaterThan(0);

      const firstFrame = frames[0];
      expect(firstFrame.cameraId).toBe('cam-rtsp-real-1');
      expect(firstFrame.sourceType).toBe(CameraSourceType.RTSP);
      expect(firstFrame.format).toBe('image/jpeg');
      expect(firstFrame.frameBuffer).toBeInstanceOf(Buffer);
      expect(firstFrame.frameBuffer.length).toBeGreaterThan(200);
      expect(firstFrame.width).toBe(640);
      expect(firstFrame.height).toBe(480);
      expect(firstFrame.sequence).toBeGreaterThan(0);

      // Verify latestFrame property
      const latest = adapter.getLatestFrame();
      expect(latest).toBeDefined();
      expect(latest?.sequence).toBeGreaterThanOrEqual(firstFrame.sequence);

      // Capture snapshot from running stream (shares latest frame without spawning second process)
      const snapshot = await adapter.captureSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot.frameBuffer).toBeInstanceOf(Buffer);
      expect(snapshot.format).toBe('image/jpeg');

      // Verify diagnostics
      const diag = adapter.getDiagnostics();
      expect(diag.isActive).toBe(true);
      expect(diag.healthStatus).toBe(CameraHealthStatus.ONLINE);
      expect(diag.totalFramesCaptured).toBeGreaterThan(0);
      expect(diag.lastSeenAt).toBeInstanceOf(Date);

      unsubscribe();
      await adapter.stop();
      expect(adapter.isActive()).toBe(false);
      expect(await adapter.getHealth()).toBe(CameraHealthStatus.OFFLINE);

      await adapter.disconnect();
    });

    it('manual stop disables reconnection and leaves camera offline', async () => {
      const adapter = new RtspAdapter('cam-manual-stop');
      await adapter.initialize({
        cameraId: 'cam-manual-stop',
        rtspUrl: 'rtsp://synthetic',
        testInputOverride: 'testsrc=size=320x240:rate=10',
        reconnectEnabled: true,
        reconnectDelayMs: 200,
      });

      await adapter.start();
      expect(adapter.isActive()).toBe(true);

      // Operator triggers manual stop
      await adapter.stop();
      expect(adapter.isActive()).toBe(false);

      // Wait longer than reconnect interval
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(adapter.isActive()).toBe(false);

      await adapter.disconnect();
    });

    it('multiple listeners (Preview, Recognition, Diagnostics) share a single RTSP stream', async () => {
      const adapter = new RtspAdapter('cam-shared-stream');
      await adapter.initialize({
        cameraId: 'cam-shared-stream',
        rtspUrl: 'rtsp://synthetic',
        testInputOverride: 'testsrc=size=320x240:rate=10',
      });

      await adapter.start();

      let previewCount = 0;
      let recognitionCount = 0;
      let diagnosticsCount = 0;

      const unsub1 = adapter.onFrame(() => previewCount++);
      const unsub2 = adapter.onFrame(() => recognitionCount++);
      const unsub3 = adapter.onFrame(() => diagnosticsCount++);

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(previewCount).toBeGreaterThan(0);
      expect(recognitionCount).toBeGreaterThan(0);
      expect(diagnosticsCount).toBeGreaterThan(0);

      // Removing preview listener must not break recognition listener
      unsub1();
      const prevRecog = recognitionCount;
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(recognitionCount).toBeGreaterThan(prevRecog);

      unsub2();
      unsub3();
      await adapter.disconnect();
    });

    it('initialization or start without RTSP URL throws descriptive validation error', async () => {
      const adapter = new RtspAdapter('cam-no-url');
      await expect(adapter.initialize({ cameraId: 'cam-no-url' } as any)).rejects.toThrow(
        /RTSP URL is required/i
      );
    });

    it('diagnostics reflect accurate operational telemetry', async () => {
      const adapter = new RtspAdapter('cam-diag-test');
      await adapter.initialize({
        cameraId: 'cam-diag-test',
        rtspUrl: 'rtsp://synthetic',
        testInputOverride: 'testsrc=size=640x480:rate=10',
        width: 640,
        height: 480,
      });

      await adapter.start();
      await new Promise((resolve) => setTimeout(resolve, 350));

      const diag = adapter.getDiagnostics();
      expect(diag.sourceType).toBe(CameraSourceType.RTSP);
      expect(diag.isActive).toBe(true);
      expect(diag.healthStatus).toBe(CameraHealthStatus.ONLINE);
      expect(diag.totalFramesCaptured).toBeGreaterThan(0);
      expect(diag.resolution).toEqual({ width: 640, height: 480 });
      expect(diag.lastSeenAt).toBeInstanceOf(Date);
      expect(diag.lastError).toBeNull();

      await adapter.disconnect();
    });

    it('unexpected FFmpeg process termination marks camera DEGRADED and schedules reconnect', async () => {
      const frameSource = new RtspFrameSource();
      await frameSource.initialize({
        cameraId: 'cam-disconnect-test',
        rtspUrl: 'rtsp://synthetic',
        testInputOverride: 'testsrc=size=320x240:rate=10',
        reconnectEnabled: true,
        reconnectDelayMs: 500,
      });

      await frameSource.start();
      expect(frameSource.getHealth()).toBe(CameraHealthStatus.ONLINE);

      // Simulate unexpected process death (kill subprocess from outside without calling stop())
      const proc = (frameSource as any).ffmpegProcess;
      expect(proc).toBeDefined();
      proc.kill('SIGKILL');

      // Await exit handler
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(frameSource.getHealth()).toBe(CameraHealthStatus.DEGRADED);
      expect(frameSource.getLastError()).toBeDefined();

      await frameSource.destroy();
    });

    it('frame parser safely resets accumulation buffer if threshold exceeded to prevent unbounded memory growth', async () => {
      const frameSource = new RtspFrameSource();
      await frameSource.initialize({
        cameraId: 'cam-mem-test',
        rtspUrl: 'rtsp://synthetic',
        testInputOverride: 'testsrc=size=320x240:rate=10',
      });

      // Inject an oversized buffer without JPEG markers to test threshold safety
      const oversized = Buffer.alloc(11 * 1024 * 1024, 0x00);
      (frameSource as any).handleStdoutChunk(oversized);

      expect(frameSource.getHealth()).toBe(CameraHealthStatus.DEGRADED);
      expect(frameSource.getLastError()).toContain('threshold');
      expect((frameSource as any).buffer.length).toBe(0);

      await frameSource.destroy();
    });
  });

  describe('D. Live MJPEG Preview with RTSP Camera', () => {
    it('GET /api/v1/cameras/:id/preview delivers multipart MJPEG frames from RTSP camera', async () => {
      const camera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'RTSP Preview Cam',
        sourceType: CameraSourceType.RTSP,
        role: CameraRole.GENERAL,
        configMetadata: {
          testInputOverride: 'testsrc=size=320x240:rate=10',
          transport: 'tcp',
        },
      });

      const http = await import('http');
      const server = http.createServer(app);

      await new Promise<void>((resolve, reject) => {
        server.listen(0, () => {
          const address = server.address();
          if (!address || typeof address === 'string') {
            server.close();
            return reject(new Error('Invalid test server address'));
          }

          const req = http.get(
            `http://localhost:${address.port}/api/v1/cameras/${camera.id}/preview?token=${wardenToken}`,
            (res) => {
              try {
                expect(res.statusCode).toBe(200);
                expect(res.headers['content-type']).toContain('multipart/x-mixed-replace');
                expect(res.headers['content-type']).toContain('boundary=--pravahax-frame');

                res.on('data', (chunk) => {
                  if (chunk.toString().includes('--pravahax-frame')) {
                    req.destroy();
                    server.close(() => resolve());
                  }
                });
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

      await cameraService.releaseCamera(camera.id);
    });
  });

  describe('E. Downstream Recognition, Movement & Attendance Integration', () => {
    it('RTSP camera stream feeds RecognitionService subscriber seamlessly', async () => {
      const camera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'RTSP Recognition Gate',
        sourceType: CameraSourceType.RTSP,
        role: CameraRole.IN,
        configMetadata: {
          testInputOverride: 'testsrc=size=320x240:rate=10',
          transport: 'tcp',
        },
      });

      let framesReceivedByDownstream = 0;
      const unsubscribe = await cameraService.subscribeToStream(camera.id, (frame) => {
        expect(frame.cameraId).toBe(camera.id);
        expect(frame.sourceType).toBe(CameraSourceType.RTSP);
        expect(frame.format).toBe('image/jpeg');
        framesReceivedByDownstream++;
      });

      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(framesReceivedByDownstream).toBeGreaterThan(0);

      unsubscribe();
      await cameraService.releaseCamera(camera.id);
    });

    it('Movement Decision Engine handles RTSP camera role IN without modification', async () => {
      const residentService = new ResidentService(testPrisma);
      const resident = await residentService.createResident({
        organizationId: org.id,
        hostelId: hostel1.id,
        residentCode: 'RES_RTSP_IN',
        fullName: 'Resident RTSP In',
        roomGroup: 'Room 101',
        initialPresence: PresenceState.OUT,
      });

      await testPrisma.resident.update({
        where: { id: resident.id },
        data: { faceEnrollmentStatus: 'ENROLLED' },
      });

      const rtspCamera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Gate 1 Ingress RTSP',
        sourceType: CameraSourceType.RTSP,
        role: CameraRole.IN,
        configMetadata: {
          movementAutomationEnabled: true,
          testInputOverride: 'testsrc=size=320x240:rate=10',
        },
      });

      const movementService = new MovementDecisionService(testPrisma, undefined, {
        globalAutomationEnabled: true,
      });
      const decision = await movementService.evaluateObservation({
        id: 'obs-rtsp-in-1',
        cameraId: rtspCamera.id,
        classification: 'MATCH',
        residentId: resident.id,
        resident: {
          id: resident.id,
          residentCode: resident.residentCode,
          fullName: resident.fullName,
          hostelId: resident.hostelId,
          organizationId: resident.organizationId,
        },
        similarityScore: 0.95,
        timestamp: new Date().toISOString(),
      } as any);

      expect(decision.status).toBe('MOVEMENT_CREATED');
      expect(decision.direction).toBe('IN');

      const presence = await testPrisma.residentPresence.findUnique({
        where: { residentId: resident.id },
      });
      expect(presence?.currentState).toBe(PresenceState.IN);
    });

    it('Attendance Decision Engine handles RTSP camera role ATTENDANCE without creating movements', async () => {
      const residentService = new ResidentService(testPrisma);
      const resident = await residentService.createResident({
        organizationId: org.id,
        hostelId: hostel1.id,
        residentCode: 'RES_RTSP_ATT',
        fullName: 'Resident RTSP Attendance',
        roomGroup: 'Room 102',
        initialPresence: PresenceState.IN,
      });

      const session = await testPrisma.attendanceSession.create({
        data: {
          organizationId: org.id,
          hostelId: hostel1.id,
          attendanceDate: new Date(),
          sessionType: 'NIGHT' as any,
          title: 'RTSP Night Roll Call',
          status: 'ACTIVE' as any,
          startTime: new Date(Date.now() - 10 * 60 * 1000),
          endTime: new Date(Date.now() + 50 * 60 * 1000),
          createdByUserId: wardenUser.id,
          startedByUserId: wardenUser.id,
        },
      });

      const rtspCamera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Assembly Hall RTSP Cam',
        sourceType: CameraSourceType.RTSP,
        role: CameraRole.ATTENDANCE,
        configMetadata: {
          testInputOverride: 'testsrc=size=320x240:rate=10',
        },
      });

      const attendanceService = new AttendanceDecisionService(testPrisma);
      const result = await attendanceService.evaluateObservation({
        id: 'obs-rtsp-att-1',
        cameraId: rtspCamera.id,
        classification: 'MATCH',
        residentId: resident.id,
        resident: {
          id: resident.id,
          residentCode: resident.residentCode,
          fullName: resident.fullName,
          hostelId: resident.hostelId,
          organizationId: resident.organizationId,
        },
        similarityScore: 0.92,
        isStable: true,
        timestamp: new Date().toISOString(),
      } as any);

      expect(result.status).toBe('ATTENDANCE_MARKED');
      expect(result.attendanceStatus).toBe('PRESENT');

      // Verify no movement event created for ATTENDANCE camera
      const movement = await testPrisma.movementEvent.findFirst({
        where: { residentId: resident.id },
      });
      expect(movement).toBeNull();
    });
  });
});

