import { Router, Request, Response, NextFunction } from 'express';
import { StaffRole } from '@prisma/client';
import { ResidentService } from '../../modules/residents/resident.service';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import {
  createResidentSchema,
  updateResidentSchema,
  deactivateResidentSchema,
  reactivateResidentSchema,
  listResidentsQuerySchema,
} from '../../modules/residents/resident.schemas';
import { NotFoundError, ValidationError } from '../../common/errors';
import { prisma as defaultPrisma } from '../../database/client';
import { createFaceEnrollmentRouter } from './face-enrollment.routes';
import { EnrollmentService } from '../../modules/biometrics/enrollment.service';
import { PresenceService } from '../../modules/presence/presence.service';
import { CameraService } from '../../modules/cameras/camera.service';
import { ProfilePhotoService } from '../../modules/residents/profile-photo.service';

export function createResidentRouter(
  db = defaultPrisma,
  enrollmentService?: EnrollmentService,
  cameraService?: CameraService,
  profilePhotoService?: ProfilePhotoService
) {
  const router = Router();
  const residentService = new ResidentService(db);
  const presenceService = new PresenceService(db);
  const camService = cameraService || new CameraService(db);
  const photoService = profilePhotoService || new ProfilePhotoService(db);
  const { requireAuth, requirePermission } = createAuthMiddleware(db);

  // All resident routes require authentication
  router.use(requireAuth);

  /**
   * GET /api/v1/residents
   * Paginated, searchable, filterable list of residents scoped to actor's permitted hostel/organization
   */
  router.get(
    '/',
    validateRequest({ query: listResidentsQuerySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const query = req.query as any;

        let effectiveHostelId: string | undefined;

        if (user.role === StaffRole.WARDEN || user.role === StaffRole.GUARD) {
          // Wardens and guards are strictly locked to their assigned hostel
          effectiveHostelId = user.hostelId || undefined;
        } else if (user.role === StaffRole.ADMIN && user.hostelId) {
          // Admin locked to specific hostel
          effectiveHostelId = user.hostelId;
        } else if (user.role === StaffRole.ADMIN) {
          // Org-level Admin: can optionally filter by hostelId if it belongs to their organization
          if (query.hostelId) {
            const hostel = await db.hostel.findUnique({
              where: { id: query.hostelId },
            });
            if (!hostel || hostel.organizationId !== user.organizationId) {
              throw new NotFoundError('Hostel', query.hostelId);
            }
            effectiveHostelId = query.hostelId;
          }
        }

        const result = await residentService.listResidentsPaginated({
          organizationId: user.organizationId,
          hostelId: effectiveHostelId,
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          status: query.status,
          presence: query.presence,
          faceEnrollmentStatus: query.faceEnrollmentStatus,
          roomGroup: query.roomGroup,
        });

        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/residents
   * Create a new resident (Admin / Warden only). Guard is rejected.
   */
  router.post(
    '/',
    requirePermission('RESIDENT_MANAGE'),
    validateRequest({ body: createResidentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const body = req.body;

        // Determine effective hostelId server-side from actor context
        let targetHostelId: string;

        if (user.role === StaffRole.WARDEN) {
          if (!user.hostelId) {
            throw new ValidationError('Warden must have an assigned hostel to create residents');
          }
          targetHostelId = user.hostelId;
        } else if (user.role === StaffRole.ADMIN && user.hostelId) {
          targetHostelId = user.hostelId;
        } else {
          // Organization-level Admin must specify a valid hostelId in request body
          if (!body.hostelId) {
            throw new ValidationError('Hostel ID is required for organization-level admin');
          }
          targetHostelId = body.hostelId;
        }

        const resident = await residentService.createResident({
          organizationId: user.organizationId,
          hostelId: targetHostelId,
          residentCode: body.residentCode,
          fullName: body.fullName,
          roomGroup: body.roomGroup,
          contactPhone: body.contactPhone,
          contactEmail: body.contactEmail,
          initialPresence: body.initialPresence,
          performedByUserId: user.id,
          performedByRole: user.role,
        });

        // Safe resident detail lookup
        const safeResident = await residentService.getResidentScoped(resident.id, user);
        res.status(201).json(safeResident);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/v1/residents/summary
   * Scoped aggregate summary metrics for resident overview
   */
  router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const query = req.query as any;

      let effectiveHostelId: string | undefined;

      if (user.role === StaffRole.WARDEN || user.role === StaffRole.GUARD) {
        effectiveHostelId = user.hostelId || undefined;
      } else if (user.role === StaffRole.ADMIN && user.hostelId) {
        effectiveHostelId = user.hostelId;
      } else if (user.role === StaffRole.ADMIN) {
        if (query.hostelId) {
          const hostel = await db.hostel.findUnique({
            where: { id: query.hostelId },
          });
          if (!hostel || hostel.organizationId !== user.organizationId) {
            throw new NotFoundError('Hostel', query.hostelId);
          }
          effectiveHostelId = query.hostelId;
        }
      }

      const summary = await residentService.getSummary({
        organizationId: user.organizationId,
        hostelId: effectiveHostelId,
      });

      res.status(200).json(summary);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/residents/hostels
   * List accessible hostels for selection dropdown
   */
  router.get('/hostels', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const where: any = { organizationId: user.organizationId, isActive: true };
      if (user.role === StaffRole.WARDEN || user.role === StaffRole.GUARD) {
        if (user.hostelId) {
          where.id = user.hostelId;
        }
      }
      const hostels = await db.hostel.findMany({
        where,
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      });
      res.status(200).json({ data: hostels });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/residents/by-code/:residentCode
   * Lookup resident by unique resident code
   */
  router.get('/by-code/:residentCode', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const residentCode = Array.isArray(req.params.residentCode) ? req.params.residentCode[0] : req.params.residentCode;
      const resident = await residentService.getResidentByCodeScoped(
        residentCode,
        req.user!
      );
      res.status(200).json(resident);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/residents/:id
   * Fetch resident details by ID
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const resident = await residentService.getResidentScoped(id, req.user!);
      res.status(200).json(resident);
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/residents/:id
   * Update allowed fields of resident (whitelist only)
   */
  router.patch(
    '/:id',
    requirePermission('RESIDENT_MANAGE'),
    validateRequest({ body: updateResidentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const updated = await residentService.updateResident(
          id,
          req.body,
          req.user!
        );
        res.status(200).json(updated);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/residents/:id/deactivate
   * Deactivate resident with mandatory reason
   */
  router.post(
    '/:id/deactivate',
    requirePermission('RESIDENT_MANAGE'),
    validateRequest({ body: deactivateResidentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        await residentService.deactivateResident(
          id,
          req.body.reason,
          user.id,
          user.role
        );
        const safeResident = await residentService.getResidentScoped(id, user);
        res.status(200).json(safeResident);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/residents/:id/reactivate
   * Reactivate resident with mandatory reason
   */
  router.post(
    '/:id/reactivate',
    requirePermission('RESIDENT_MANAGE'),
    validateRequest({ body: reactivateResidentSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        await residentService.reactivateResident(
          id,
          req.body.reason,
          user.id,
          user.role
        );
        const safeResident = await residentService.getResidentScoped(id, user);
        res.status(200).json(safeResident);
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/v1/residents/:id/presence
   * Fetch current presence state for resident
   */
  router.get('/:id/presence', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      // Authorize scope first
      await residentService.getResidentScoped(id, user);
      const presence = await presenceService.getResidentPresence(id);
      res.status(200).json(presence);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/residents/:id/movements
   * Fetch movement history for specific resident
   */
  router.get('/:id/movements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      // Authorize scope first
      const resident = await residentService.getResidentScoped(id, user);

      const movements = await db.movementEvent.findMany({
        where: { residentId: resident.id },
        include: {
          camera: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
          location: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
        orderBy: { effectiveTimestamp: 'desc' },
        take: 50,
      });

      res.status(200).json({ data: movements });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/residents/:id/profile-photo
   * Upload or capture resident profile photo (visual identification only).
   */
  router.post(
    '/:id/profile-photo',
    requirePermission('RESIDENT_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        let imageBuffer: Buffer | null = null;

        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          imageBuffer = req.body;
        } else if (req.body && req.body.cameraId) {
          // Capture from camera hardware snapshot
          const snapshot = await camService.captureSnapshot(req.body.cameraId);
          if (!snapshot || !snapshot.frameBuffer) {
            throw new ValidationError('Failed to capture snapshot from camera hardware');
          }
          imageBuffer = snapshot.frameBuffer;
        } else if (req.body && req.body.imageBase64) {
          let b64 = req.body.imageBase64;
          if (typeof b64 === 'string') {
            if (b64.includes(',')) {
              b64 = b64.split(',', 2)[1];
            }
            imageBuffer = Buffer.from(b64, 'base64');
          }
        }

        if (!imageBuffer || imageBuffer.length === 0) {
          throw new ValidationError('Valid image data is required (cameraId, imageBase64, or binary image)');
        }

        const result = await photoService.saveProfilePhoto(id, imageBuffer, user);
        res.status(200).json({
          message: 'Profile photo updated successfully',
          data: result,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/v1/residents/:id/profile-photo
   * Serve resident profile photo
   */
  router.get('/:id/profile-photo', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const photoInfo = await photoService.getProfilePhoto(id, user);

      res.setHeader('Content-Type', photoInfo.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.status(200).end(photoInfo.buffer);
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/v1/residents/:id/profile-photo
   * Delete resident profile photo
   */
  router.delete(
    '/:id/profile-photo',
    requirePermission('RESIDENT_MANAGE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        const result = await photoService.deleteProfilePhoto(id, user);
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  // Mount face enrollment routes under /:id/face-enrollment
  router.use('/:id/face-enrollment', createFaceEnrollmentRouter(db, enrollmentService, camService));

  return router;
}

export const residentRouter = createResidentRouter();

