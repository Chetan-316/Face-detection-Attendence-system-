import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { AuthService } from '../../modules/auth/auth.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors';

export function createStaffRouter(db: PrismaClient = defaultPrisma): Router {
  const router = Router();
  const authService = new AuthService(db);
  const { requireAuth, requirePermission } = createAuthMiddleware(db);

  router.use(requireAuth);
  router.use(requirePermission('USER_MANAGE'));

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.user!;

      if (actor.role !== StaffRole.ADMIN) {
        throw new ForbiddenError('Only Administrators can manage staff accounts');
      }

      const users = await db.user.findMany({
        where: {
          organizationId: actor.organizationId,
          ...(actor.hostelId ? { hostelId: actor.hostelId } : {}),
        },
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          hostelId: true,
          hostel: {
            select: { id: true, code: true, name: true },
          },
          createdAt: true,
        },
        orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      });

      res.status(200).json({ data: users });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.user!;

      if (actor.role !== StaffRole.ADMIN) {
        throw new ForbiddenError('Only Administrators can create staff accounts');
      }

      const { fullName, username, email, password, role, hostelId } = req.body || {};
      const normalizedRole = String(role || '').toUpperCase();

      if (normalizedRole !== StaffRole.WARDEN && normalizedRole !== StaffRole.GUARD) {
        throw new ValidationError('Staff role must be WARDEN or GUARD');
      }

      if (!fullName || String(fullName).trim().length < 2) {
        throw new ValidationError('Full name is required');
      }

      if (!hostelId) {
        throw new ValidationError('A hostel assignment is required for Wardens and Guards');
      }

      const hostel = await db.hostel.findUnique({ where: { id: hostelId } });
      if (!hostel || hostel.organizationId !== actor.organizationId || !hostel.isActive) {
        throw new NotFoundError('Hostel', hostelId);
      }

      if (actor.hostelId && actor.hostelId !== hostel.id) {
        throw new ForbiddenError('This Administrator can only create staff for their assigned hostel');
      }

      const created = await authService.createUser({
        organizationId: actor.organizationId,
        hostelId: hostel.id,
        username: String(username || '').trim(),
        email: email ? String(email).trim() : null,
        fullName: String(fullName).trim(),
        password: String(password || ''),
        role: normalizedRole as StaffRole,
        createdById: actor.id,
      });

      res.status(201).json({
        ...created,
        hostel: {
          id: hostel.id,
          code: hostel.code,
          name: hostel.name,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
