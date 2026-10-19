import { describe, it, expect, vi } from 'vitest';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { StaffRole, UserStatus } from '@prisma/client';
import { createRecognitionRouter } from '../src/api/routes/recognition.routes';
import { tokenService } from '../src/api/auth/token.service';
import { RecognitionService } from '../src/modules/recognition/recognition.service';
import { BiometricWorkerUnavailableError } from '../src/modules/biometrics/biometric.errors';
import type { PythonWorkerClient } from '../src/modules/biometrics/python-worker-client';

const ORG = 'org-1';
const HOSTEL = 'hostel-1';
const CAMERA = 'camera-1';

const warden = {
  id: 'user-warden',
  username: 'warden',
  fullName: 'Warden One',
  email: null,
  role: StaffRole.WARDEN,
  organizationId: ORG,
  hostelId: HOSTEL,
  status: UserStatus.ACTIVE,
  tokenVersion: 0,
};

const camera = {
  id: CAMERA,
  name: 'Main Gate IN',
  organizationId: ORG,
  hostelId: HOSTEL,
  isEnabled: true,
  role: 'IN',
  sourceType: 'RTSP',
  configMetadata: {},
  deletedAt: null,
};

function workerClient(status: 'UP' | 'DOWN', mock = false) {
  return {
    health: vi.fn(async () => ({ status, mock, workerReady: status === 'UP' })),
  } as unknown as PythonWorkerClient & { health: ReturnType<typeof vi.fn> };
}

function createService(health: 'UP' | 'DOWN') {
  const db = {
    user: { findUnique: async () => warden },
    camera: { findFirst: async () => camera },
  } as any;
  const worker = workerClient(health);
  const service = new RecognitionService(
    db,
    {} as any,
    { getCachedCount: () => 3 } as any,
    worker,
    { maxFps: 10, historyLimit: 50 }
  );
  return { db, worker, service };
}

const actor = { id: warden.id, role: warden.role, organizationId: ORG, hostelId: HOSTEL };

function createApp(service: RecognitionService) {
  const db = {
    user: { findUnique: async () => warden },
    camera: { findFirst: async () => camera },
  } as any;
  const app = express();
  app.use('/api/v1/cameras', createRecognitionRouter(db, service));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message, code: err.code } });
  });
  return app;
}

function bearer() {
  return tokenService.generateToken({
    sub: warden.id,
    role: warden.role,
    organizationId: warden.organizationId,
    hostelId: warden.hostelId,
    tokenVersion: warden.tokenVersion,
  }).token;
}

describe('recognition status and start when the biometric worker is down', () => {
  it('getStatus fails explicitly instead of reporting an idle session', async () => {
    const { service } = createService('DOWN');

    await expect(service.getStatus(CAMERA, actor)).rejects.toBeInstanceOf(BiometricWorkerUnavailableError);
  });

  it('getStatus reports an explicit STOPPED state when the worker is up and no session exists', async () => {
    const { service } = createService('UP');

    const status = await service.getStatus(CAMERA, actor);

    expect(status.state).toBe('STOPPED');
    expect(status.sessionId).toBe('none');
  });

  it('getStatus treats the mock worker as available', async () => {
    const db = { camera: { findFirst: async () => camera } } as any;
    const service = new RecognitionService(
      db,
      {} as any,
      { getCachedCount: () => 0 } as any,
      workerClient('DOWN', true),
      { maxFps: 10, historyLimit: 50 }
    );

    const status = await service.getStatus(CAMERA, actor);

    expect(status.state).toBe('STOPPED');
  });

  it('startRecognition rejects with the worker-unavailable error before touching a session', async () => {
    const { service, worker } = createService('DOWN');

    await expect(service.startRecognition(CAMERA, actor)).rejects.toBeInstanceOf(BiometricWorkerUnavailableError);
    expect(worker.health).toHaveBeenCalled();
  });

  it('GET /status returns 503 with an explicit code when the worker is down', async () => {
    const { service } = createService('DOWN');

    const res = await request(createApp(service))
      .get(`/api/v1/cameras/${CAMERA}/recognition/status`)
      .set('Authorization', `Bearer ${bearer()}`)
      .expect(503);

    expect(res.body.error.code).toBe('BIOMETRIC_WORKER_UNAVAILABLE');
    expect(res.body.state).toBeUndefined();
  });

  it('GET /status returns 200 with state STOPPED when the worker is up and the session is stopped', async () => {
    const { service } = createService('UP');

    const res = await request(createApp(service))
      .get(`/api/v1/cameras/${CAMERA}/recognition/status`)
      .set('Authorization', `Bearer ${bearer()}`)
      .expect(200);

    expect(res.body.state).toBe('STOPPED');
  });
});
