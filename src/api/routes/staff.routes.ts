import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { AuthService } from '../../modules/auth/auth.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors';
import { AuditService } from '../../modules/audit/audit.service';

export function createStaffRouter(db: PrismaClient = defaultPrisma): Router {
  const router = Router();
  const authService = new AuthService(db);
  const auditService = new AuditService(db);
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
          role: { in: [StaffRole.WARDEN, StaffRole.GUARD] },
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

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.user!;
      if (actor.role !== StaffRole.ADMIN) {
        throw new ForbiddenError('Only Administrators can update staff accounts');
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const existing = await db.user.findUnique({ where: { id } });

      if (
        !existing ||
        existing.organizationId !== actor.organizationId ||
        existing.role === StaffRole.ADMIN
      ) {
        throw new NotFoundError('Staff account', id);
      }
      const nextRole = req.body?.role
        ? String(req.body.role).toUpperCase()
        : existing.role;
      if (nextRole !== StaffRole.WARDEN && nextRole !== StaffRole.GUARD) {
        throw new ValidationError('Staff role must be WARDEN or GUARD');
      }

      const nextFullName =
        req.body?.fullName === undefined ? existing.fullName : String(req.body.fullName || '').trim();
      if (nextFullName.length < 2) {
        throw new ValidationError('Full name is required');
      }

      const nextEmail =
        req.body?.email === undefined
          ? existing.email
          : String(req.body.email || '').trim() || null;

      if (nextEmail && nextEmail !== existing.email) {
        const duplicateEmail = await db.user.findFirst({
          where: { email: nextEmail, NOT: { id: existing.id } },
        });
        if (duplicateEmail) {
          throw new ConflictError('Another account already uses this email address');
        }
      }

      const nextHostelId =
        req.body?.hostelId === undefined ? existing.hostelId : String(req.body.hostelId || '');
      if (!nextHostelId) {
        throw new ValidationError('A hostel assignment is required for Wardens and Guards');
      }

      const hostel = await db.hostel.findUnique({ where: { id: nextHostelId } });
      if (!hostel || hostel.organizationId !== actor.organizationId || !hostel.isActive) {
        throw new NotFoundError('Hostel', nextHostelId);
      }
      const nextStatus = req.body?.status
        ? String(req.body.status).toUpperCase()
        : existing.status;
      if (!Object.values(UserStatus).includes(nextStatus as UserStatus)) {
        throw new ValidationError('Invalid staff account status');
      }

      const updated = await db.$transaction(async (tx) => {
        const staff = await tx.user.update({
          where: { id: existing.id },
          data: {
            fullName: nextFullName,
            email: nextEmail,
            role: nextRole as StaffRole,
            hostelId: hostel.id,
            status: nextStatus as UserStatus,
          },
          select: {
            id: true,
            username: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            hostelId: true,
            createdAt: true,
          },
        });

        await auditService.record(
          {
            organizationId: actor.organizationId,
            hostelId: hostel.id,
            entityType: 'USER',
            entityId: existing.id,
            action: 'UPDATE',
            performedByUserId: actor.id,
            performedByRole: actor.role,
            oldValues: {
              fullName: existing.fullName,
              email: existing.email,
              role: existing.role,
              hostelId: existing.hostelId,
              status: existing.status,
            },
            newValues: {
              fullName: staff.fullName,
              email: staff.email,
              role: staff.role,
              hostelId: staff.hostelId,
              status: staff.status,
            },
          },
          tx
        );

        return staff;
      });

      res.status(200).json({
        ...updated,
        hostel: { id: hostel.id, code: hostel.code, name: hostel.name },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/reset-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.user!;
      if (actor.role !== StaffRole.ADMIN) {
        throw new ForbiddenError('Only Administrators can reset staff passwords');
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const existing = await db.user.findUnique({ where: { id } });
      if (
        !existing ||
        existing.organizationId !== actor.organizationId ||
        existing.role === StaffRole.ADMIN
      ) {
        throw new NotFoundError('Staff account', id);
      }
      const password = String(req.body?.password || '');
      if (password.length < 8) {
        throw new ValidationError('Temporary password must be at least 8 characters');
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash },
        });

        await auditService.record(
          {
            organizationId: actor.organizationId,
            hostelId: existing.hostelId,
            entityType: 'USER',
            entityId: existing.id,
            action: 'UPDATE',
            performedByUserId: actor.id,
            performedByRole: actor.role,
            reason: 'Administrator reset staff password',
            newValues: { passwordReset: true },
          },
          tx
        );
      });

      res.status(200).json({ success: true, message: 'Temporary password updated successfully' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
