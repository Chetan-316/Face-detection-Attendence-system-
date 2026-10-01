import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { EnrollmentService } from '../../modules/biometrics/enrollment.service';
import {
  startEnrollmentSchema,
  captureFrameSchema,
  revokeEnrollmentSchema,
  invalidateEnrollmentSchema,
} from '../../modules/biometrics/biometric.schemas';
import { ForbiddenError } from '../../common/errors';

export function createFaceEnrollmentRouter(
  db: PrismaClient = defaultPrisma,
  enrollmentService?: EnrollmentService
) {
  const router = Router({ mergeParams: true });
  const service = enrollmentService || new EnrollmentService(db);
  const { requireAuth } = createAuthMiddleware(db);

  router.use(requireAuth);

  // Guard guardrail: guards are not permitted to manage biometrics
  const enforceStaffRole = (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role === StaffRole.GUARD) {
      return next(new ForbiddenError('Guards are not authorized to perform face enrollment or revocation'));
    }
    next();
  };

  /**
   * POST /api/v1/residents/:id/face-enrollment/start
   * Start a face enrollment session
   */
  router.post(
    '/start',
    enforceStaffRole,
    validateRequest({ body: startEnrollmentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const residentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const result = await service.startEnrollment(residentId, req.body?.cameraId, req.user!);
        res.status(201).json({ data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/v1/residents/:id/face-enrollment/status
   * Get active enrollment session status & progress
   */
  router.get(
    '/status',
    enforceStaffRole,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const residentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const result = await service.getEnrollmentStatus(residentId, req.user!);
        res.status(200).json({ data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/residents/:id/face-enrollment/capture
   * Capture or submit a single frame for biometric quality analysis & sample collection
   */
  router.post(
    '/capture',
    enforceStaffRole,
    validateRequest({ body: captureFrameSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const residentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const result = await service.captureFrame(residentId, req.user!, req.body?.targetPose);
        res.status(200).json({ data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/residents/:id/face-enrollment/complete
   * Finalize enrollment: validate sample consistency, average & normalize embeddings, commit atomically
   */
  router.post(
    '/complete',
    enforceStaffRole,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const residentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const result = await service.completeEnrollment(residentId, req.user!);
        res.status(200).json({
          data: {
            message: 'Face profile enrolled successfully',
            residentId: result.residentId,
            enrollmentStatus: result.enrollmentStatus,
            modelName: result.modelName,
            modelVersion: result.modelVersion,
            samplesCount: result.samplesCount,
            consistencyScore: result.consistencyScore,
            enrolledAt: result.enrolledAt,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/residents/:id/face-enrollment/cancel
   * Cancel active enrollment session without modifying resident profile
   */
  router.post(
    '/cancel',
    enforceStaffRole,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const residentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const result = await service.cancelEnrollment(residentId, req.user!);
        res.status(200).json({ data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/residents/:id/face-enrollment/revoke
   * Revoke face profile: erase template for privacy, update Resident status and log audit trail
   */
  router.post(
    '/revoke',
    enforceStaffRole,
    validateRequest({ body: revokeEnrollmentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const residentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const result = await service.revokeEnrollment(residentId, req.body.reason, req.user!);
        res.status(200).json({
          data: {
            message: 'Face enrollment revoked successfully',
            ...result,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/residents/:id/face-enrollment/invalidate
   * Set status to NEEDS_REENROLLMENT
   */
  router.post(
    '/invalidate',
    enforceStaffRole,
    validateRequest({ body: invalidateEnrollmentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const residentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const result = await service.markNeedsReenrollment(residentId, req.body.reason, req.user!);
        res.status(200).json({
          data: {
            message: 'Resident marked for re-enrollment',
            ...result,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
