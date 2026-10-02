import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { tokenService } from '../auth/token.service';
import { RecognitionService, defaultRecognitionService } from '../../modules/recognition/recognition.service';
import { AuthenticationError, ForbiddenError } from '../../common/errors';

export function createRecognitionRouter(
  db: PrismaClient = defaultPrisma,
  recognitionService: RecognitionService = defaultRecognitionService
): Router {
  const router = Router({ mergeParams: true });
  const { requireAuth, requireStreamAuth } = createAuthMiddleware(db);

  /**
   * Helper to extract authenticated actor from req.user
   */
  const getActor = (req: Request) => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }
    return {
      id: req.user.id,
      role: req.user.role,
      organizationId: req.user.organizationId,
      hostelId: req.user.hostelId,
    };
  };

  /**
   * POST /api/v1/cameras/:cameraId/recognition/start
   * Start continuous recognition session on a camera.
   * Allowed: ADMIN, WARDEN. (GUARD is forbidden)
   */
  router.post('/:cameraId/recognition/start', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const cameraId = req.params.cameraId as string;
      const status = await recognitionService.startRecognition(cameraId, actor);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/cameras/:cameraId/recognition/stop
   * Stop continuous recognition session on a camera.
   * Allowed: ADMIN, WARDEN. (GUARD is forbidden)
   */
  router.post('/:cameraId/recognition/stop', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const cameraId = req.params.cameraId as string;
      const status = await recognitionService.stopRecognition(cameraId, actor);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/cameras/:cameraId/recognition/status
   * Get recognition runtime diagnostics and session status.
   * Allowed: ADMIN, WARDEN, GUARD.
   */
  router.get('/:cameraId/recognition/status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const cameraId = req.params.cameraId as string;
      const status = await recognitionService.getStatus(cameraId, actor);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/cameras/:cameraId/recognition/results
   * Get bounded recent recognition observations (never contains vectors).
   * Allowed: ADMIN, WARDEN, GUARD.
   */
  router.get('/:cameraId/recognition/results', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const cameraId = req.params.cameraId as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const results = await recognitionService.getRecentObservations(cameraId, actor, limit);
      res.status(200).json({ results });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/cameras/:cameraId/recognition/stream-token
   * Issue a short-lived (60s), camera-scoped stream token for SSE connections.
   * Allowed: ADMIN, WARDEN, GUARD.
   */
  router.post('/:cameraId/recognition/stream-token', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const cameraId = req.params.cameraId as string;

      // Verify scope first (VIEW permission)
      const camera = await recognitionService.verifyActorScope(cameraId, actor, 'VIEW');

      // Auto-start continuous recognition for active gate / attendance cameras if stopped
      if (camera.isEnabled && (camera.role === 'IN' || camera.role === 'OUT' || camera.role === 'ATTENDANCE')) {
        try {
          const status = await recognitionService.getStatus(cameraId, actor);
          if (status.state !== 'RUNNING') {
            await recognitionService.startRecognition(cameraId, {
              ...actor,
              role: StaffRole.ADMIN,
            });
          }
        } catch (e: any) {
          // Non-blocking fallback
        }
      }

      // Generate short-lived camera-scoped token (cannot be used for general REST APIs)
      const tokenData = tokenService.generateStreamToken(
        {
          sub: actor.id,
          cameraId: camera.id,
          organizationId: camera.organizationId,
          hostelId: camera.hostelId,
          role: actor.role,
        },
        60
      );

      res.status(200).json(tokenData);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/cameras/:cameraId/recognition/events
   * Server-Sent Events (SSE) live stream of recognition observations.
   * Allowed: ADMIN, WARDEN, GUARD via dedicated ?streamToken=<token> (or Bearer header).
   */
  router.get('/:cameraId/recognition/events', requireStreamAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const cameraId = req.params.cameraId as string;

      // Verify scope first
      await recognitionService.verifyActorScope(cameraId, actor, 'VIEW');

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      // Send initial connected event
      res.write(`event: connected\ndata: ${JSON.stringify({ cameraId, time: new Date().toISOString() })}\n\n`);

      // Subscribe to recognition observations
      const unsubscribe = recognitionService.subscribeObservations(cameraId, (obs) => {
        // Strict privacy check: ensure no vectors in JSON payload
        const safeData = JSON.stringify(obs);
        res.write(`event: observation\ndata: ${safeData}\n\n`);
      });

      // Heartbeat ping every 15s to keep connection alive
      const pingInterval = setInterval(() => {
        res.write(': ping\n\n');
      }, 15000);

      // Clean up when client disconnects
      req.on('close', () => {
        clearInterval(pingInterval);
        unsubscribe();
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
