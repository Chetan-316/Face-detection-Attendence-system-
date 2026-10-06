import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole, CameraSourceType, CameraRole } from '@prisma/client';
import { z } from 'zod';
import { CameraService } from '../../modules/cameras/camera.service';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { tokenService } from '../auth/token.service';
import {
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../../common/errors';
import {
  assertUserCanOperateInOrganization,
} from '../../modules/auth/permissions';
import { toSafeCameraDto } from '../../modules/cameras/utils/camera-dto';
import { testCameraConnection } from '../../modules/cameras/utils/camera-connection-test';
import { config } from '../../config';

const createCameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required').max(100),
  hostelId: z.string().uuid('Valid hostel ID required').optional(),
  locationId: z.string().uuid('Valid location ID required').nullable().optional(),
  sourceType: z.nativeEnum(CameraSourceType),
  role: z.nativeEnum(CameraRole).optional(),
  isEnabled: z.boolean().optional(),
  configMetadata: z.record(z.string(), z.any()).optional(),
});

const updateCameraSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  locationId: z.string().uuid().nullable().optional(),
  role: z.nativeEnum(CameraRole).optional(),
  isEnabled: z.boolean().optional(),
  configMetadata: z.record(z.string(), z.any()).optional(),
});

const testConnectionSchema = z.object({
  sourceType: z.enum(['RTSP', 'WEBCAM', 'SMART_CAMERA']),
  rtspUrl: z.string().optional(),
  transport: z.enum(['tcp', 'udp']).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  deviceIndex: z.number().optional(),
  testInputOverride: z.string().optional(),
});

export function createCameraRouter(
  db: PrismaClient,
  cameraService: CameraService = new CameraService(db)
) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware(db);

  function extractId(param: string | string[]): string {
    return Array.isArray(param) ? param[0] : param;
  }

  /**
   * Helper to verify access to a camera based on user scope.
   */
  async function resolveAndAuthorizeCamera(req: Request, paramId: string | string[]) {
    const cameraId = extractId(paramId);
    const user = req.user!;
    const camera = await cameraService.getCamera(cameraId);

    assertUserCanOperateInOrganization(user, camera.organizationId);

    if (user.role === StaffRole.WARDEN || user.role === StaffRole.GUARD) {
      if (user.hostelId && camera.hostelId !== user.hostelId) {
        throw new NotFoundError('Camera', cameraId);
      }
    }

    return camera;
  }

  /**
   * Streaming authentication helper:
   * Accepts standard Authorization header OR query parameter '?token=...'
   * for standard <img> and <video> media tag streaming.
   */
  async function authenticateStreamRequest(req: Request, res: Response, next: NextFunction) {
    try {
      let token: string | undefined;

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (typeof req.query.token === 'string') {
        token = req.query.token.trim();
      }

      if (!token) {
        throw new AuthenticationError('Authentication token is required for camera stream');
      }

      const payload = tokenService.verifyToken(token);
      const user = await db.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || user.status !== 'ACTIVE') {
        throw new AuthenticationError('User is not authorized or inactive');
      }

      req.user = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        hostelId: user.hostelId,
        status: user.status,
      };

      next();
    } catch (err) {
      next(err);
    }
  }

  // 1. GET /api/v1/cameras - List cameras in scope
  router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const hostelIdQuery = req.query.hostelId as string | undefined;
      const roleQuery = req.query.role as CameraRole | undefined;

      let targetHostelId: string | undefined;

      if (user.role === StaffRole.GUARD || user.role === StaffRole.WARDEN) {
        if (!user.hostelId) {
          throw new PermissionDeniedError('Staff member has no assigned hostel', user.role);
        }
        targetHostelId = user.hostelId;
      } else if (user.role === StaffRole.ADMIN) {
        targetHostelId = hostelIdQuery || undefined;
      }

      const cameras = await cameraService.listCameras(
        targetHostelId,
        user.organizationId,
        roleQuery
      );

      // Enhance with live streaming status & sanitize credentials
      const camerasWithDiagnostics = await Promise.all(
        cameras.map(async (c) => {
          const diagnostics = await cameraService.getDiagnostics(c.id);
          return toSafeCameraDto(c, diagnostics);
        })
      );

      res.json({
        data: camerasWithDiagnostics,
        count: cameras.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // 1.1 POST /api/v1/cameras/test-connection - Test camera connection before registration (ADMIN only)
  router.post(
    '/test-connection',
    requireAuth,
    requireRole(StaffRole.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = testConnectionSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(parsed.error.issues[0].message);
        }
        if (parsed.data.testInputOverride && (process.env.NODE_ENV === 'production' || config.appEnv === 'production')) {
          throw new ValidationError('Synthetic camera testInputOverride is disabled in production environments');
        }
        const result = await testCameraConnection(parsed.data as any);
        res.json({ data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  // 2. POST /api/v1/cameras - Register a camera (ADMIN only)
  router.post(
    '/',
    requireAuth,
    requireRole(StaffRole.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = createCameraSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(parsed.error.issues[0].message);
        }
        if (parsed.data.configMetadata?.testInputOverride && (process.env.NODE_ENV === 'production' || config.appEnv === 'production')) {
          throw new ValidationError('Synthetic camera testInputOverride is disabled in production environments');
        }

        const user = req.user!;
        let hostelId = parsed.data.hostelId;

        if (user.role === StaffRole.WARDEN) {
          if (!user.hostelId) {
            throw new PermissionDeniedError('Warden must have assigned hostel', user.role);
          }
          hostelId = user.hostelId;
        } else if (!hostelId) {
          if (user.hostelId) {
            hostelId = user.hostelId;
          } else {
            throw new ValidationError('hostelId is required for camera creation');
          }
        }

        const targetHostel = await db.hostel.findUnique({ where: { id: hostelId } });
        if (!targetHostel || targetHostel.organizationId !== user.organizationId || !targetHostel.isActive) {
          throw new ValidationError('Selected facility is not active in this organization');
        }

        if (parsed.data.locationId) {
          const location = await db.location.findUnique({ where: { id: parsed.data.locationId } });
          if (!location || location.hostelId !== hostelId || !location.isActive) {
            throw new ValidationError('Selected gate/location is not active in this facility');
          }
        }

        const camera = await cameraService.createCamera({
          organizationId: user.organizationId,
          hostelId,
          locationId: parsed.data.locationId,
          name: parsed.data.name,
          sourceType: parsed.data.sourceType,
          role: parsed.data.role,
          isEnabled: parsed.data.isEnabled,
          configMetadata: parsed.data.configMetadata,
          createdByUserId: user.id,
        });

        res.status(201).json({
          message: 'Camera registered successfully',
          data: toSafeCameraDto(camera),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // 3. GET /api/v1/cameras/:id - Camera details & live diagnostics
  router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await resolveAndAuthorizeCamera(req, req.params.id);
      const diagnostics = await cameraService.getDiagnostics(camera.id);

      res.json({
        data: toSafeCameraDto(camera, diagnostics),
      });
    } catch (err) {
      next(err);
    }
  });

  // 4. PUT /api/v1/cameras/:id - Update camera configuration (ADMIN only)
  router.put(
    '/:id',
    requireAuth,
    requireRole(StaffRole.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const camera = await resolveAndAuthorizeCamera(req, req.params.id);
        const parsed = updateCameraSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(parsed.error.issues[0].message);
        }
        if (parsed.data.configMetadata?.testInputOverride && (process.env.NODE_ENV === 'production' || config.appEnv === 'production')) {
          throw new ValidationError('Synthetic camera testInputOverride is disabled in production environments');
        }

        if (parsed.data.locationId) {
          const location = await db.location.findUnique({ where: { id: parsed.data.locationId } });
          if (!location || location.hostelId !== camera.hostelId || !location.isActive) {
            throw new ValidationError('Selected gate/location is not active in this facility');
          }
        }

        const updated = await cameraService.updateCamera(camera.id, {
          name: parsed.data.name,
          locationId: parsed.data.locationId,
          role: parsed.data.role,
          isEnabled: parsed.data.isEnabled,
          configMetadata: parsed.data.configMetadata,
          updatedByUserId: req.user!.id,
        });

        const diagnostics = await cameraService.getDiagnostics(updated.id);

        res.json({
          message: 'Camera updated successfully',
          data: toSafeCameraDto(updated, diagnostics),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // 4.1 POST /api/v1/cameras/:id/test - Test connection to configured camera (ADMIN only)
  router.post(
    '/:id/test',
    requireAuth,
    requireRole(StaffRole.ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await resolveAndAuthorizeCamera(req, req.params.id);
      const result = await cameraService.testCameraConnection(camera.id);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // 5. POST /api/v1/cameras/:id/start - Start streaming (ADMIN or WARDEN)
  router.post(
    '/:id/start',
    requireAuth,
    requireRole(StaffRole.ADMIN, StaffRole.WARDEN),
    async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await resolveAndAuthorizeCamera(req, req.params.id);
      const diagnostics = await cameraService.startCamera(camera.id);

      res.json({
        message: 'Camera stream started successfully',
        data: diagnostics,
      });
    } catch (err) {
      next(err);
    }
  });

  // 6. POST /api/v1/cameras/:id/stop - Stop streaming (ADMIN or WARDEN)
  router.post(
    '/:id/stop',
    requireAuth,
    requireRole(StaffRole.ADMIN, StaffRole.WARDEN),
    async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await resolveAndAuthorizeCamera(req, req.params.id);
      const diagnostics = await cameraService.stopCamera(camera.id);

      res.json({
        message: 'Camera stream stopped successfully',
        data: diagnostics,
      });
    } catch (err) {
      next(err);
    }
  });

  // 7. GET /api/v1/cameras/:id/health - Health & streaming diagnostics
  router.get('/:id/health', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await resolveAndAuthorizeCamera(req, req.params.id);
      const diagnostics = await cameraService.getDiagnostics(camera.id);
      const adapter = await cameraService.getOrCreateAdapter(camera.id).catch(() => null);

      res.json({
        data: {
          cameraId: camera.id,
          name: camera.name,
          sourceType: camera.sourceType,
          role: camera.role,
          healthStatus: diagnostics.healthStatus,
          isStreaming: diagnostics.isActive,
          fps: diagnostics.fps,
          totalFramesCaptured: diagnostics.totalFramesCaptured,
          resolution: diagnostics.resolution,
          lastSeenAt: diagnostics.lastSeenAt,
          lastError: diagnostics.lastError,
          capabilities: adapter ? adapter.getCapabilities() : null,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // 8. GET /api/v1/cameras/:id/snapshot - Capture single still frame
  router.get('/:id/snapshot', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await resolveAndAuthorizeCamera(req, req.params.id);
      const frame = await cameraService.captureSnapshot(camera.id);

      if (!frame.frameBuffer) {
        throw new Error('Frame capture returned empty buffer');
      }

      // Return JSON if requested explicitly via format query or Accept header
      const requestedJson =
        req.query.format === 'json' ||
        (req.headers.accept && req.headers.accept.includes('application/json'));

      if (requestedJson) {
        res.json({
          data: {
            timestamp: frame.timestamp,
            cameraId: frame.cameraId,
            sourceType: frame.sourceType,
            format: frame.format || 'image/jpeg',
            width: frame.width,
            height: frame.height,
            dataBase64: frame.frameBuffer.toString('base64'),
          },
        });
        return;
      }

      // Default: Return binary JPEG image
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', frame.frameBuffer.length);
      res.setHeader('Cache-Control', 'no-cache');
      res.end(frame.frameBuffer);
    } catch (err) {
      next(err);
    }
  });

  // 9. GET /api/v1/cameras/:id/preview - Live MJPEG Preview Stream
  router.get(
    '/:id/preview',
    authenticateStreamRequest,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const camera = await resolveAndAuthorizeCamera(req, req.params.id);

        res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=--pravahax-frame');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Connection', 'close');
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }

        const writeFrame = (buf: Buffer) => {
          if (res.writableEnded || res.destroyed) return;
          try {
            res.write('--pravahax-frame\r\n');
            res.write('Content-Type: image/jpeg\r\n');
            res.write(`Content-Length: ${buf.length}\r\n\r\n`);
            res.write(buf);
            res.write('\r\n');
          } catch {
            // Client closed stream
          }
        };

        const adapter = await cameraService.getOrCreateAdapter(camera.id);
        if (!adapter.isActive()) {
          try {
            await cameraService.startCamera(camera.id);
          } catch {}
        }

        // If adapter has a latest frame, emit it immediately so preview renders without delay
        const latest = adapter.getLatestFrame();
        if (latest && latest.frameBuffer) {
          writeFrame(latest.frameBuffer);
        }

        const unsubscribe = await cameraService.subscribeToStream(camera.id, (frame) => {
          if (frame.frameBuffer) {
            writeFrame(frame.frameBuffer);
          }
        });

        // Clean cleanup on client disconnect
        req.on('close', () => {
          unsubscribe();
        });

        res.on('finish', () => {
          unsubscribe();
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
