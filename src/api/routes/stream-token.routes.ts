import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { isWithinHostelScope } from '../middleware/scope';
import { tokenService } from '../auth/token.service';
import { NotFoundError } from '../../common/errors';
import { assertUserCanOperateInOrganization } from '../../modules/auth/permissions';
import { CameraService } from '../../modules/cameras/camera.service';

export function createStreamTokenRouter(
  db: PrismaClient = defaultPrisma,
  cameraService: CameraService = new CameraService(db)
): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(db);

  // POST /api/v1/cameras/:cameraId/stream-token - Short-lived token for the camera preview <img> URL
  router.post('/:cameraId/stream-token', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const cameraId = req.params.cameraId as string;
      const camera = await cameraService.getCamera(cameraId);

      assertUserCanOperateInOrganization(user, camera.organizationId);

      if (!isWithinHostelScope(user, camera.hostelId)) {
        throw new NotFoundError('Camera', cameraId);
      }

      const tokenData = tokenService.generateCameraStreamToken(
        { sub: user.id, cameraId: camera.id, tokenVersion: user.tokenVersion },
        60
      );
      res.status(200).json(tokenData);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
