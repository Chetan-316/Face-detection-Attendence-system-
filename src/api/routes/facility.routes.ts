import { Router, Request, Response, NextFunction } from 'express';
import { LocationType, PrismaClient, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { OrganizationService } from '../../modules/organizations/organization.service';
import { AuditService } from '../../modules/audit/audit.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors';

export function createFacilityRouter(db: PrismaClient = defaultPrisma): Router {
  const router = Router();
  const organizationService = new OrganizationService(db);
  const auditService = new AuditService(db);
  const { requireAuth, requirePermission } = createAuthMiddleware(db);

  router.use(requireAuth);
  router.use(requirePermission('USER_MANAGE'));

  const requireAdmin = (req: Request) => {
    const actor = req.user!;
    if (actor.role !== StaffRole.ADMIN) {
      throw new ForbiddenError('Only Administrators can manage facilities');
    }
    return actor;
  };

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = requireAdmin(req);

      const facilities = await db.hostel.findMany({
        where: {
          organizationId: actor.organizationId,
          ...(actor.hostelId ? { id: actor.hostelId } : {}),
        },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          createdAt: true,
          _count: {
            select: {
              residents: true,
              users: true,
              cameras: true,
            },
          },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });

      res.status(200).json({
        data: facilities.map((facility) => ({
          id: facility.id,
          code: facility.code,
          name: facility.name,
          isActive: facility.isActive,
          createdAt: facility.createdAt,
          residentCount: facility._count.residents,
          staffCount: facility._count.users,
          cameraCount: facility._count.cameras,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = requireAdmin(req);

      if (actor.hostelId) {
        throw new ForbiddenError('A hostel-scoped Administrator cannot create additional facilities');
      }

      const name = String(req.body?.name || '').trim();
      const code = String(req.body?.code || '').trim().toUpperCase();

      if (name.length < 2) {
        throw new ValidationError('Facility name is required');
      }
      if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
        throw new ValidationError('Facility code must be 2-20 letters, numbers, hyphens, or underscores');
      }

      const facility = await organizationService.createHostel({
        organizationId: actor.organizationId,
        code,
        name,
        createdByUserId: actor.id,
      });

      res.status(201).json({
        id: facility.id,
        code: facility.code,
        name: facility.name,
        isActive: facility.isActive,
        residentCount: 0,
        staffCount: 0,
        cameraCount: 0,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/locations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = requireAdmin(req);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const facility = await db.hostel.findUnique({ where: { id } });
      if (!facility || facility.organizationId !== actor.organizationId) {
        throw new NotFoundError('Facility', id);
      }
      if (actor.hostelId && actor.hostelId !== facility.id) {
        throw new ForbiddenError('This Administrator can only manage their assigned facility');
      }

      const locations = await db.location.findMany({
        where: { hostelId: facility.id },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });

      res.status(200).json({ data: locations });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/locations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = requireAdmin(req);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const facility = await db.hostel.findUnique({ where: { id } });
      if (!facility || facility.organizationId !== actor.organizationId) {
        throw new NotFoundError('Facility', id);
      }
      if (actor.hostelId && actor.hostelId !== facility.id) {
        throw new ForbiddenError('This Administrator can only manage their assigned facility');
      }

      const name = String(req.body?.name || '').trim();
      const code = String(req.body?.code || '').trim().toUpperCase();
      const typeValue = String(req.body?.locationType || 'GATE').toUpperCase();

      if (name.length < 2) throw new ValidationError('Location name is required');
      if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
        throw new ValidationError('Location code must be 2-20 letters, numbers, hyphens, or underscores');
      }
      if (!Object.values(LocationType).includes(typeValue as LocationType)) {
        throw new ValidationError('Invalid location type');
      }

      const location = await organizationService.createLocation({
        hostelId: facility.id,
        code,
        name,
        locationType: typeValue as LocationType,
        createdByUserId: actor.id,
      });

      res.status(201).json(location);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/locations/:locationId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = requireAdmin(req);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const locationId = Array.isArray(req.params.locationId) ? req.params.locationId[0] : req.params.locationId;

      const facility = await db.hostel.findUnique({ where: { id } });
      if (!facility || facility.organizationId !== actor.organizationId) {
        throw new NotFoundError('Facility', id);
      }
      if (actor.hostelId && actor.hostelId !== facility.id) {
        throw new ForbiddenError('This Administrator can only manage their assigned facility');
      }

      const existing = await db.location.findUnique({ where: { id: locationId } });
      if (!existing || existing.hostelId !== facility.id) {
        throw new NotFoundError('Location', locationId);
      }

      const nextName = req.body?.name === undefined ? existing.name : String(req.body.name || '').trim();
      const nextCode = req.body?.code === undefined ? existing.code : String(req.body.code || '').trim().toUpperCase();
      const nextActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : existing.isActive;

      if (nextName.length < 2) throw new ValidationError('Location name is required');
      if (!/^[A-Z0-9_-]{2,20}$/.test(nextCode)) {
        throw new ValidationError('Location code must be 2-20 letters, numbers, hyphens, or underscores');
      }

      if (!nextActive) {
        const enabledCameraCount = await db.camera.count({
          where: { locationId: existing.id, isEnabled: true },
        });
        if (enabledCameraCount > 0) {
          throw new ValidationError('Reassign or disable cameras before deactivating this gate/location');
        }
      }

      const updated = await db.$transaction(async (tx) => {
        const location = await tx.location.update({
          where: { id: existing.id },
          data: { name: nextName, code: nextCode, isActive: nextActive },
        });

        await auditService.record(
          {
            organizationId: actor.organizationId,
            hostelId: facility.id,
            entityType: 'LOCATION',
            entityId: location.id,
            action: 'UPDATE',
            performedByUserId: actor.id,
            performedByRole: actor.role,
            oldValues: { name: existing.name, code: existing.code, isActive: existing.isActive },
            newValues: { name: location.name, code: location.code, isActive: location.isActive },
          },
          tx
        );

        return location;
      });

      res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = requireAdmin(req);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const existing = await db.hostel.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              residents: { where: { status: 'ACTIVE' } },
              users: { where: { status: 'ACTIVE' } },
              cameras: { where: { isEnabled: true } },
            },
          },
        },
      });

      if (!existing || existing.organizationId !== actor.organizationId) {
        throw new NotFoundError('Facility', id);
      }

      if (actor.hostelId && actor.hostelId !== existing.id) {
        throw new ForbiddenError('This Administrator can only manage their assigned facility');
      }

      const nextName =
        req.body?.name === undefined ? existing.name : String(req.body.name || '').trim();
      const nextCode =
        req.body?.code === undefined
          ? existing.code
          : String(req.body.code || '').trim().toUpperCase();
      const nextActive =
        typeof req.body?.isActive === 'boolean' ? req.body.isActive : existing.isActive;

      if (nextName.length < 2) {
        throw new ValidationError('Facility name is required');
      }
      if (!/^[A-Z0-9_-]{2,20}$/.test(nextCode)) {
        throw new ValidationError('Facility code must be 2-20 letters, numbers, hyphens, or underscores');
      }

      if (nextCode !== existing.code) {
        const duplicate = await db.hostel.findUnique({
          where: {
            organizationId_code: {
              organizationId: actor.organizationId,
              code: nextCode,
            },
          },
        });
        if (duplicate && duplicate.id !== existing.id) {
          throw new ConflictError(`Facility code '${nextCode}' already exists`);
        }
      }

      if (
        existing.isActive &&
        !nextActive &&
        (existing._count.residents > 0 ||
          existing._count.users > 0 ||
          existing._count.cameras > 0)
      ) {
        throw new ValidationError(
          'Move or deactivate active residents, staff, and cameras before deactivating this facility'
        );
      }

      const updated = await db.$transaction(async (tx) => {
        const facility = await tx.hostel.update({
          where: { id: existing.id },
          data: {
            name: nextName,
            code: nextCode,
            isActive: nextActive,
          },
        });

        await auditService.record(
          {
            organizationId: actor.organizationId,
            hostelId: facility.id,
            entityType: 'HOSTEL',
            entityId: facility.id,
            action: 'UPDATE',
            performedByUserId: actor.id,
            performedByRole: actor.role,
            oldValues: {
              name: existing.name,
              code: existing.code,
              isActive: existing.isActive,
            },
            newValues: {
              name: facility.name,
              code: facility.code,
              isActive: facility.isActive,
            },
          },
          tx
        );

        return facility;
      });

      res.status(200).json({
        id: updated.id,
        code: updated.code,
        name: updated.name,
        isActive: updated.isActive,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
