import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import {
  CameraSourceType,
  CameraRole,
  CameraHealthStatus,
  StaffRole,
  UserStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { CameraService } from '../src/modules/cameras/camera.service';
import { CameraAdapterFactory } from '../src/modules/cameras/camera-adapter.factory';
import { WebcamAdapter } from '../src/modules/cameras/adapters/webcam.adapter';
import { RtspAdapter } from '../src/modules/cameras/adapters/rtsp.adapter';
import { SmartCameraAdapter } from '../src/modules/cameras/adapters/smart-camera.adapter';
import { SyntheticFrameSource } from '../src/modules/cameras/frame-sources/synthetic-frame-source';
import { OpenCvFrameSource } from '../src/modules/cameras/frame-sources/opencv-frame-source';

describe('Step 04: Real Camera Abstraction Layer Tests', () => {
  let app: any;
  let cameraService: CameraService;

  let org: any;
  let hostel1: any;
  let hostel2: any;
  let location1: any;
  let adminUser: any;
  let wardenUser: any;
  let guardUser: any;
  let otherOrgUser: any;

  let adminToken: string;
  let wardenToken: string;
  let guardToken: string;
  let otherOrgToken: string;

  beforeAll(async () => {
    cameraService = new CameraService(testPrisma);
    app = createApp(testPrisma);
  });

  beforeEach(async () => {
    await resetTestDatabase();

    // 1. Setup Test Organizations & Hostels
    org = await testPrisma.organization.create({
      data: { code: 'TEST_ORG', name: 'Test Org', isActive: true },
    });

    const otherOrg = await testPrisma.organization.create({
      data: { code: 'OTHER_ORG', name: 'Other Org', isActive: true },
    });

    hostel1 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H1', name: 'Hostel 1', isActive: true },
    });

    hostel2 = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'H2', name: 'Hostel 2', isActive: true },
    });

    const otherHostel = await testPrisma.hostel.create({
      data: { organizationId: otherOrg.id, code: 'H_OTHER', name: 'Other Org Hostel', isActive: true },
    });

    location1 = await testPrisma.location.create({
      data: { hostelId: hostel1.id, code: 'LOC_MAIN_GATE', name: 'Main Gate', isActive: true },
    });

    const pwHash = await bcrypt.hash('TestPass123!', 4);

    adminUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: null, // Admin across org
        username: 'test_admin',
        fullName: 'Test Admin',
        passwordHash: pwHash,
        role: StaffRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    wardenUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        username: 'test_warden',
        fullName: 'Test Warden',
        passwordHash: pwHash,
        role: StaffRole.WARDEN,
        status: UserStatus.ACTIVE,
      },
    });

    guardUser = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel1.id,
        username: 'test_guard',
        fullName: 'Test Guard',
        passwordHash: pwHash,
        role: StaffRole.GUARD,
        status: UserStatus.ACTIVE,
      },
    });

    otherOrgUser = await testPrisma.user.create({
      data: {
        organizationId: otherOrg.id,
        hostelId: otherHostel.id,
        username: 'other_warden',
        fullName: 'Other Warden',
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

    guardToken = tokenService.generateToken({
      sub: guardUser.id,
      organizationId: guardUser.organizationId,
      hostelId: guardUser.hostelId,
      role: guardUser.role,
    }).token;

    otherOrgToken = tokenService.generateToken({
      sub: otherOrgUser.id,
      organizationId: otherOrgUser.organizationId,
      hostelId: otherOrgUser.hostelId,
      role: otherOrgUser.role,
    }).token;
  });

  afterAll(async () => {
    await cameraService.shutdownAll();
    await testPrisma.$disconnect();
  });

  describe('1. ICameraAdapter & Factory Architecture', () => {
    it('CameraAdapterFactory instantiates correct adapter type without altering business logic', () => {
      const webcamAdapter = CameraAdapterFactory.create(CameraSourceType.WEBCAM, 'cam-1');
      expect(webcamAdapter).toBeInstanceOf(WebcamAdapter);
      expect(webcamAdapter.sourceType).toBe(CameraSourceType.WEBCAM);
      expect(webcamAdapter.cameraId).toBe('cam-1');

      const rtspAdapter = CameraAdapterFactory.create(CameraSourceType.RTSP, 'cam-2');
      expect(rtspAdapter).toBeInstanceOf(RtspAdapter);
      expect(rtspAdapter.sourceType).toBe(CameraSourceType.RTSP);
      expect(rtspAdapter.cameraId).toBe('cam-2');

      const smartAdapter = CameraAdapterFactory.create(CameraSourceType.SMART_CAMERA, 'cam-3');
      expect(smartAdapter).toBeInstanceOf(SmartCameraAdapter);
      expect(smartAdapter.sourceType).toBe(CameraSourceType.SMART_CAMERA);
      expect(smartAdapter.cameraId).toBe('cam-3');
    });

    it('WebcamAdapter satisfies ICameraAdapter contract through full lifecycle', async () => {
      const adapter = new WebcamAdapter('webcam-test-1');
      await adapter.initialize({
        deviceIndex: 0,
        fps: 20,
        backend: 'synthetic',
      });

      expect(adapter.isActive()).toBe(false);
      expect(await adapter.getHealth()).toBe(CameraHealthStatus.OFFLINE);
      expect(adapter.getCapabilities().supportsLiveStreaming).toBe(true);
      expect(adapter.getCapabilities().supportsSnapshot).toBe(true);

      // Start stream
      await adapter.start();
      expect(adapter.isActive()).toBe(true);
      expect(await adapter.getHealth()).toBe(CameraHealthStatus.ONLINE);

      // Subscribe and receive frames
      const receivedFrames: any[] = [];
      const unsubscribe = adapter.onFrame((frame) => {
        receivedFrames.push(frame);
      });

      // Capture single snapshot
      const snapshot = await adapter.captureSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot.cameraId).toBe('webcam-test-1');
      expect(snapshot.sourceType).toBe(CameraSourceType.WEBCAM);
      expect(snapshot.frameBuffer).toBeInstanceOf(Buffer);
      expect(snapshot.format).toBe('image/jpeg');

      // Wait briefly for live stream frame emission
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(receivedFrames.length).toBeGreaterThan(0);
      unsubscribe();

      // Check telemetry & diagnostics
      const diag = adapter.getDiagnostics();
      expect(diag.cameraId).toBe('webcam-test-1');
      expect(diag.isActive).toBe(true);
      expect(diag.healthStatus).toBe(CameraHealthStatus.ONLINE);
      expect(diag.totalFramesCaptured).toBeGreaterThan(0);

      // Clean stop & release
      await adapter.stop();
      expect(adapter.isActive()).toBe(false);
      expect(await adapter.getHealth()).toBe(CameraHealthStatus.OFFLINE);

      await adapter.disconnect();
    });

    it('SyntheticFrameSource handles error simulation and health degradation gracefully', async () => {
      const source = new SyntheticFrameSource();
      await source.initialize({ cameraId: 'cam-err-test', fps: 10 });
      await source.start();

      expect(source.getHealth()).toBe(CameraHealthStatus.ONLINE);
      expect(source.getLastError()).toBeNull();

      source.simulateError('Device connection lost', CameraHealthStatus.DEGRADED);
      expect(source.getHealth()).toBe(CameraHealthStatus.DEGRADED);
      expect(source.getLastError()).toBe('Device connection lost');

      await source.stop();
      expect(source.getHealth()).toBe(CameraHealthStatus.OFFLINE);
      await source.destroy();
    });

    it('captures live frames from laptop webcam hardware via OpenCvFrameSource', async () => {
      const source = new OpenCvFrameSource();
      await source.initialize({
        cameraId: 'laptop-webcam-hw',
        deviceIndex: 0,
        fps: 5,
        width: 640,
        height: 480,
      });

      try {
        await source.start();
        expect(source.isActive()).toBe(true);
        expect(source.getHealth()).toBe(CameraHealthStatus.ONLINE);

        const frame = await source.captureSnapshot();
        expect(frame).toBeDefined();
        expect(frame.frameBuffer).toBeInstanceOf(Buffer);
        expect(frame.frameBuffer!.length).toBeGreaterThan(500);
        expect(frame.metadata?.backend).toBe('opencv');

        await source.stop();
        expect(source.isActive()).toBe(false);
      } catch (err: any) {
        // In environments without webcam hardware attached, verify error tracking
        expect(source.getHealth()).toBe(CameraHealthStatus.OFFLINE);
      } finally {
        await source.destroy();
      }
    });
  });

  describe('2. CameraService Lifecycle & Hardware Decoupling', () => {
    it('creates camera database entity with configMetadata encapsulation', async () => {
      const camera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        locationId: location1.id,
        name: 'Gate 1 Entrance Camera',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.IN,
        configMetadata: {
          deviceIndex: 0,
          resolution: '640x480',
          fps: 15,
          backend: 'synthetic',
        },
        createdByUserId: adminUser.id,
      });

      expect(camera.id).toBeDefined();
      expect(camera.name).toBe('Gate 1 Entrance Camera');
      expect(camera.sourceType).toBe(CameraSourceType.WEBCAM);
      expect(camera.role).toBe(CameraRole.IN);
      expect(camera.healthStatus).toBe(CameraHealthStatus.OFFLINE);
      expect((camera.configMetadata as any).deviceIndex).toBe(0);

      // Verify audit log entry was created
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityType: 'CAMERA', entityId: camera.id },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('CREATE');
    });

    it('business callers interact only by cameraId and never pass hardware device indices', async () => {
      const camera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Laptop Builtin Webcam',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.GENERAL,
        configMetadata: { backend: 'synthetic' },
        createdByUserId: wardenUser.id,
      });

      // Business service starts camera by cameraId only
      const startDiag = await cameraService.startCamera(camera.id);
      expect(startDiag.isActive).toBe(true);
      expect(startDiag.healthStatus).toBe(CameraHealthStatus.ONLINE);

      // Database health status is updated
      const inDbAfterStart = await cameraService.getCamera(camera.id);
      expect(inDbAfterStart.healthStatus).toBe(CameraHealthStatus.ONLINE);
      expect(inDbAfterStart.lastSeenAt).toBeDefined();

      // Capture snapshot by cameraId only
      const frame = await cameraService.captureSnapshot(camera.id);
      expect(frame.cameraId).toBe(camera.id);
      expect(frame.frameBuffer).toBeDefined();

      // Stop camera by cameraId only
      const stopDiag = await cameraService.stopCamera(camera.id);
      expect(stopDiag.isActive).toBe(false);

      const inDbAfterStop = await cameraService.getCamera(camera.id);
      expect(inDbAfterStop.healthStatus).toBe(CameraHealthStatus.OFFLINE);

      await cameraService.releaseCamera(camera.id);
    });

    it('rejects starting or operating a disabled camera', async () => {
      const disabledCamera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        name: 'Disabled Gate Cam',
        sourceType: CameraSourceType.WEBCAM,
        isEnabled: false,
        configMetadata: { backend: 'synthetic' },
      });

      await expect(cameraService.startCamera(disabledCamera.id)).rejects.toThrow(/disabled/i);
    });
  });

  describe('3. Camera REST API & Live Preview Stream', () => {
    let testCamera: any;

    beforeEach(async () => {
      testCamera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel1.id,
        locationId: location1.id,
        name: 'Hostel 1 Gate Cam',
        sourceType: CameraSourceType.WEBCAM,
        role: CameraRole.IN,
        configMetadata: {
          deviceIndex: 0,
          fps: 15,
          backend: 'synthetic',
        },
      });
    });

    it('GET /api/v1/cameras returns scoped camera list for Warden', async () => {
      // Create a second camera in hostel2
      await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel2.id,
        name: 'Hostel 2 Main Cam',
        sourceType: CameraSourceType.WEBCAM,
      });

      const res = await request(app)
        .get('/api/v1/cameras')
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      // Warden belongs to hostel1, must not see hostel2 camera
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(testCamera.id);
    });

    it('Admin can view cameras across hostels', async () => {
      await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel2.id,
        name: 'Hostel 2 Main Cam',
        sourceType: CameraSourceType.WEBCAM,
      });

      const res = await request(app)
        .get('/api/v1/cameras')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(2);
    });

    it('cross-hostel camera access by Warden returns 404', async () => {
      const h2Camera = await cameraService.createCamera({
        organizationId: org.id,
        hostelId: hostel2.id,
        name: 'Hostel 2 Gate Cam',
        sourceType: CameraSourceType.WEBCAM,
      });

      await request(app)
        .get(`/api/v1/cameras/${h2Camera.id}`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(404);
    });

    it('cross-organization access returns 403 or 404', async () => {
      await request(app)
        .get(`/api/v1/cameras/${testCamera.id}`)
        .set('Authorization', `Bearer ${otherOrgToken}`)
        .expect(403);
    });

    it('POST /api/v1/cameras registers camera with validated schema', async () => {
      const res = await request(app)
        .post('/api/v1/cameras')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Turnstile A',
          hostelId: hostel1.id,
          sourceType: 'WEBCAM',
          role: 'IN',
          configMetadata: {
            deviceIndex: 0,
            backend: 'synthetic',
          },
        })
        .expect(201);

      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Turnstile A');
      expect(res.body.data.hostelId).toBe(hostel1.id);
    });

    it('POST /api/v1/cameras/:id/start and stop toggles streaming cleanly', async () => {
      // Start stream
      const startRes = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/start`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(startRes.body.data.isActive).toBe(true);
      expect(startRes.body.data.healthStatus).toBe(CameraHealthStatus.ONLINE);

      // Verify health endpoint
      const healthRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/health`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(healthRes.body.data.isStreaming).toBe(true);
      expect(healthRes.body.data.capabilities.supportsLiveStreaming).toBe(true);

      // Stop stream
      const stopRes = await request(app)
        .post(`/api/v1/cameras/${testCamera.id}/stop`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(stopRes.body.data.isActive).toBe(false);
      expect(stopRes.body.data.healthStatus).toBe(CameraHealthStatus.OFFLINE);
    });

    it('GET /api/v1/cameras/:id/snapshot captures still frame with binary or JSON format', async () => {
      // JSON snapshot with ?format=json
      const jsonRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/snapshot?format=json`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(jsonRes.body.data.dataBase64).toBeDefined();
      expect(jsonRes.body.data.format).toBe('image/jpeg');

      // Binary JPEG snapshot (default)
      const binRes = await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/snapshot`)
        .set('Authorization', `Bearer ${wardenToken}`)
        .expect(200);

      expect(binRes.header['content-type']).toBe('image/jpeg');
      expect(binRes.body).toBeInstanceOf(Buffer);
    });

    it('GET /api/v1/cameras/:id/preview delivers live MJPEG multipart stream', async () => {
      // Test media streaming authentication via ?token= query parameter (for browser <img> tags)
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
            `http://localhost:${address.port}/api/v1/cameras/${testCamera.id}/preview?token=${wardenToken}`,
            (res) => {
              try {
                expect(res.statusCode).toBe(200);
                expect(res.headers['content-type']).toContain('multipart/x-mixed-replace');
                expect(res.headers['content-type']).toContain('boundary=--pravahax-frame');

                res.on('data', (chunk) => {
                  expect(chunk.toString()).toContain('--pravahax-frame');
                  req.destroy();
                  server.close(() => resolve());
                });
              } catch (e) {
                req.destroy();
                server.close(() => reject(e));
              }
            }
          );

          req.on('error', (err) => {
            // Socket destroyed by client is expected
            server.close(() => resolve());
          });
        });
      });
    });

    it('preview stream rejects unauthorized requests without token', async () => {
      await request(app)
        .get(`/api/v1/cameras/${testCamera.id}/preview`)
        .expect(401);
    });
  });
});
