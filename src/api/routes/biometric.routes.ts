import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { BiometricService } from '../../modules/biometrics/biometric.service';
import { ForbiddenError } from '../../common/errors';

export function createBiometricRouter(
  db: PrismaClient = defaultPrisma,
  biometricService?: BiometricService
) {
  const router = Router();
  const service = biometricService || new BiometricService(db);
  const { requireAuth } = createAuthMiddleware(db);

  router.use(requireAuth);

  /**
   * GET /api/v1/biometrics/health
   * Authenticated Admin/Warden health check of the biometric worker & models
   */
  router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to view biometric engine diagnostics');
      }

      const health = await service.getHealth();
      res.status(200).json({ data: health });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
