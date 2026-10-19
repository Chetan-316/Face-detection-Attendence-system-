import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { StaffRole, UserStatus } from '@prisma/client';
import { createAuthMiddleware, SESSION_REVALIDATE_INTERVAL_MS, type AuthenticatedUser } from '../src/api/middleware/auth.middleware';
import { createRecognitionRouter } from '../src/api/routes/recognition.routes';
import { createStreamTokenRouter } from '../src/api/routes/stream-token.routes';
import { tokenService } from '../src/api/auth/token.service';
import { RecognitionService } from '../src/modules/recognition/recognition.service';
import { CameraService } from '../src/modules/cameras/camera.service';

const ORG = 'org-1';
const HOSTEL = 'hostel-1';
const CAMERA = 'camera-1';

type FakeUser = AuthenticatedUser;

function makeWarden(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'user-warden',
    username: 'warden',
    fullName: 'Warden One',
    email: null,
    role: StaffRole.WARDEN,
    organizationId: ORG,
    hostelId: HOSTEL,
    status: UserStatus.ACTIVE,
    tokenVersion: 0,
    ...overrides,
  };
}

function createFakeDb(initial: FakeUser[]) {
  const users = new Map(initial.map((u) => [u.id, { ...u }]));
  const db = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
    },
  } as any;
  return { users, db };
}

function createFakeRecognitionService() {
  const listeners = new Set<(obs: unknown) => void>();
  const service = {
    verifyActorScope: vi.fn(async (cameraId: string) => ({
      id: cameraId,
      organizationId: ORG,
      hostelId: HOSTEL,
      isEnabled: true,
      role: 'IN',
    })),
    getStatus: vi.fn(async () => ({ state: 'RUNNING' })),
    startRecognition: vi.fn(async () => ({ state: 'RUNNING' })),
    subscribeObservations: vi.fn((_cameraId: string, cb: (obs: unknown) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
  };
  return { service: service as unknown as RecognitionService, listeners };
}

function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  res.status(err.statusCode ?? 500).json({ error: err.message });
}

function createRecognitionApp(db: any, service: RecognitionService) {
  const app = express();
  app.use('/api/v1/cameras', createRecognitionRouter(db, service));
  app.use(errorHandler);
  return app;
}

function createPreviewApp(db: any) {
  const { requireCameraPreviewAuth } = createAuthMiddleware(db);
  const app = express();
  app.get('/api/v1/cameras/:id/preview', requireCameraPreviewAuth, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

function sessionToken(user: FakeUser, tokenVersion = user.tokenVersion) {
  return tokenService.generateToken({
    sub: user.id,
    role: user.role,
    organizationId: user.organizationId,
    hostelId: user.hostelId,
    tokenVersion,
  }).token;
}

function recognitionStreamToken(user: FakeUser, tokenVersion = user.tokenVersion) {
  return tokenService.generateStreamToken(
    {
      sub: user.id,
      cameraId: CAMERA,
      organizationId: user.organizationId,
      hostelId: user.hostelId,
      role: user.role,
      tokenVersion,
    },
    60
  ).streamToken;
}

function cameraStreamToken(user: FakeUser, tokenVersion = user.tokenVersion) {
  return tokenService.generateCameraStreamToken({ sub: user.id, cameraId: CAMERA, tokenVersion }, 60).streamToken;
}

async function openSse(app: express.Express, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers }, resolve);
    req.on('error', reject);
  });
  return {
    res,
    close: () => {
      res.destroy();
      server.close();
    },
  };
}

describe('stream and preview auth honours tokenVersion revocation', () => {
  it('accepts a recognition stream token while the session is current (control)', async () => {
    const warden = makeWarden();
    const { db } = createFakeDb([warden]);
    const { service } = createFakeRecognitionService();
    const app = createRecognitionApp(db, service);

    const stream = await openSse(app, `/api/v1/cameras/${CAMERA}/recognition/events?streamToken=${recognitionStreamToken(warden)}`);
    expect(stream.res.statusCode).toBe(200);
    stream.close();
  });

  it('rejects a recognition stream token after the token version is bumped', async () => {
    const warden = makeWarden();
    const { db, users } = createFakeDb([warden]);
    const { service } = createFakeRecognitionService();
    const app = createRecognitionApp(db, service);
    const issued = recognitionStreamToken(warden);

    users.get(warden.id)!.tokenVersion = 1;

    await request(app)
      .get(`/api/v1/cameras/${CAMERA}/recognition/events`)
      .query({ streamToken: issued })
      .expect(401);
  });

  it('rejects a Bearer session token on SSE after the token version is bumped', async () => {
    const warden = makeWarden();
    const { db, users } = createFakeDb([warden]);
    const { service } = createFakeRecognitionService();
    const app = createRecognitionApp(db, service);
    const issued = sessionToken(warden);

    users.get(warden.id)!.tokenVersion = 1;

    await request(app)
      .get(`/api/v1/cameras/${CAMERA}/recognition/events`)
      .set('Authorization', `Bearer ${issued}`)
      .expect(401);
  });

  it('rejects a recognition stream token for a suspended user', async () => {
    const warden = makeWarden();
    const { db, users } = createFakeDb([warden]);
    const { service } = createFakeRecognitionService();
    const app = createRecognitionApp(db, service);
    const issued = recognitionStreamToken(warden);

    users.get(warden.id)!.status = UserStatus.SUSPENDED;

    await request(app)
      .get(`/api/v1/cameras/${CAMERA}/recognition/events`)
      .query({ streamToken: issued })
      .expect(401);
  });

  it('rejects a camera preview stream token after the token version is bumped', async () => {
    const warden = makeWarden();
    const { db, users } = createFakeDb([warden]);
    const app = createPreviewApp(db);
    const issued = cameraStreamToken(warden);

    await request(app).get(`/api/v1/cameras/${CAMERA}/preview`).query({ streamToken: issued }).expect(200);

    users.get(warden.id)!.tokenVersion = 1;

    await request(app).get(`/api/v1/cameras/${CAMERA}/preview`).query({ streamToken: issued }).expect(401);
  });

  it('rejects a Bearer session token on camera preview after the token version is bumped', async () => {
    const warden = makeWarden();
    const { db, users } = createFakeDb([warden]);
    const app = createPreviewApp(db);
    const issued = sessionToken(warden);

    users.get(warden.id)!.tokenVersion = 1;

    await request(app)
      .get(`/api/v1/cameras/${CAMERA}/preview`)
      .set('Authorization', `Bearer ${issued}`)
      .expect(401);
  });

  it('stamps the current token version into recognition stream tokens', async () => {
    const warden = makeWarden({ tokenVersion: 3 });
    const { db } = createFakeDb([warden]);
    const { service } = createFakeRecognitionService();
    const app = createRecognitionApp(db, service);
    const bearer = sessionToken(warden);

    const res = await request(app)
      .post(`/api/v1/cameras/${CAMERA}/recognition/stream-token`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);

    expect(tokenService.verifyStreamToken(res.body.streamToken, CAMERA).tokenVersion).toBe(3);
  });

  it('stamps the current token version into camera preview stream tokens', async () => {
    const warden = makeWarden({ tokenVersion: 2 });
    const { db } = createFakeDb([warden]);
    const cameraService = {
      getCamera: async () => ({ id: CAMERA, organizationId: ORG, hostelId: HOSTEL }),
    } as unknown as CameraService;
    const app = express();
    app.use('/api/v1/cameras', createStreamTokenRouter(db, cameraService));
    app.use(errorHandler);

    const res = await request(app)
      .post(`/api/v1/cameras/${CAMERA}/stream-token`)
      .set('Authorization', `Bearer ${sessionToken(warden)}`)
      .expect(200);

    expect(tokenService.verifyCameraStreamToken(res.body.streamToken, CAMERA).tokenVersion).toBe(2);
  });

  it('ends an open SSE stream when the session is revoked mid-stream', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const warden = makeWarden();
      const { db, users } = createFakeDb([warden]);
      const { service } = createFakeRecognitionService();
      const app = createRecognitionApp(db, service);

      const stream = await openSse(app, `/api/v1/cameras/${CAMERA}/recognition/events`, {
        Authorization: `Bearer ${sessionToken(warden)}`,
      });
      expect(stream.res.statusCode).toBe(200);

      let body = '';
      let ended = false;
      stream.res.on('data', (chunk) => {
        body += chunk.toString();
      });
      const closed = new Promise<void>((resolve) => {
        stream.res.on('end', () => {
          ended = true;
          resolve();
        });
        stream.res.on('close', () => resolve());
      });

      await vi.advanceTimersByTimeAsync(SESSION_REVALIDATE_INTERVAL_MS);
      expect(ended).toBe(false);

      users.get(warden.id)!.tokenVersion = 1;
      await vi.advanceTimersByTimeAsync(SESSION_REVALIDATE_INTERVAL_MS);
      await closed;

      expect(body).toContain('event: revoked');
      stream.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops revalidating once the watch is stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const warden = makeWarden();
      const { db, users } = createFakeDb([warden]);
      const { watchSessionRevocation } = createAuthMiddleware(db);
      const onRevoked = vi.fn();

      const stop = watchSessionRevocation(makeWarden(), onRevoked);
      stop();

      users.get(warden.id)!.tokenVersion = 1;
      await vi.advanceTimersByTimeAsync(SESSION_REVALIDATE_INTERVAL_MS * 2);

      expect(onRevoked).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
