import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole, MovementType, MovementSource } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { MovementDecisionService } from '../../modules/movement-decision/movement-decision.service';
import { PresenceService } from '../../modules/presence/presence.service';
import { MovementService } from '../../modules/movements/movement.service';
import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors';

export function createMovementRouter(
  db: PrismaClient = defaultPrisma,
  movementDecisionService?: MovementDecisionService,
  presenceService?: PresenceService,
  movementService?: MovementService
): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(db);
  const decisionService = movementDecisionService || new MovementDecisionService(db);
  const presService = presenceService || new PresenceService(db);
  const movService = movementService || new MovementService(db);

  router.use(requireAuth);

  const getActor = (req: Request) => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }
    return req.user;
  };

  /**
   * GET /api/v1/movements/automation-status
   * Current movement automation configuration & runtime state
   */
  router.get('/automation-status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        globalAutomationEnabled: decisionService.isGlobalAutomationEnabled(),
        minTransitionIntervalMs: decisionService.getMinTransitionIntervalMs(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/v1/movements/automation-status
   * Toggle global movement automation (ADMIN only).
   * Warden and Guard receive 403 Forbidden.
   */
  router.patch('/automation-status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      // Global automation switch is restricted to ADMIN only.
      // WARDEN and GUARD are forbidden from modifying global movement automation.
      if (actor.role !== StaffRole.ADMIN) {
        throw new ForbiddenError(
          actor.role === StaffRole.GUARD
            ? 'Guards cannot modify movement automation settings'
            : 'Wardens cannot modify global movement automation settings; contact an Administrator'
        );
      }

      const { enabled, minTransitionIntervalMs } = req.body;
      if (typeof enabled === 'boolean') {
        decisionService.setGlobalAutomation(enabled);
      }
      if (typeof minTransitionIntervalMs === 'number' && minTransitionIntervalMs >= 0) {
        decisionService.setMinTransitionIntervalMs(minTransitionIntervalMs);
      }

      res.status(200).json({
        globalAutomationEnabled: decisionService.isGlobalAutomationEnabled(),
        minTransitionIntervalMs: decisionService.getMinTransitionIntervalMs(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/movements/confirm
   * Supervised movement confirmation by operator (Warden, Guard, Admin).
   * Supports direction override with mandatory audit reason.
   */
  router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const { residentId, cameraId, movementType, direction, overrideReason } = req.body;

      if (!residentId) {
        throw new ValidationError('residentId is required');
      }
      if (!cameraId) {
        throw new ValidationError('cameraId is required');
      }

      // Check resident
      const resident = await db.resident.findUnique({
        where: { id: residentId },
        include: { presence: true },
      });
      if (!resident || resident.organizationId !== actor.organizationId) {
        throw new NotFoundError('Resident', residentId);
      }

      let finalType = ((movementType || direction || '') as string).toUpperCase();
      if (!finalType) {
        // Automatically determine direction from current locked presence state: IN -> OUT, OUT -> IN
        finalType = resident.presence?.currentState === 'IN' ? 'OUT' : 'IN';
      }
      if (finalType !== 'IN' && finalType !== 'OUT') {
        throw new ValidationError("movementType must be either 'IN' or 'OUT'");
      }

      // Scoping: Warden and Guard must match resident hostel
      if (
        (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) &&
        actor.hostelId &&
        resident.hostelId !== actor.hostelId
      ) {
        throw new ForbiddenError('Cannot confirm movement for resident of another hostel');
      }

      // Check camera
      const camera = await db.camera.findUnique({ where: { id: cameraId } });
      if (!camera || camera.organizationId !== actor.organizationId) {
        throw new NotFoundError('Camera', cameraId);
      }

      // Check if camera role suggests a direction (Only Warden/Admin requires override reason if conflicting)
      const isGuard = actor.role === StaffRole.GUARD;
      const suggestedDir = camera.role === 'IN' ? 'IN' : camera.role === 'OUT' ? 'OUT' : null;
      const isOverridden = !isGuard && suggestedDir && suggestedDir !== finalType;

      if (isOverridden && (!overrideReason || overrideReason.trim().length === 0)) {
        throw new ValidationError('An override reason is required when confirming movement against camera direction');
      }

      const notes = isOverridden
        ? `Supervised confirmation: Direction overridden (Camera role: ${camera.role}) - ${overrideReason.trim()}`
        : isGuard
        ? `Gate movement recorded by Guard (${actor.username})`
        : 'Supervised movement confirmed by operator';

      const movementEvent = await movService.recordNormalMovement({
        residentId: resident.id,
        movementType: finalType as MovementType,
        hostelId: resident.hostelId,
        cameraId: camera.id,
        locationId: camera.locationId,
        source: MovementSource.GUARD_CONFIRMATION,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        notes,
      });

      res.status(201).json({
        success: true,
        data: movementEvent,
        message: `Movement confirmed: ${resident.fullName} marked ${finalType}`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/movements/presence-counts
   * Scoped counts of residents currently IN vs OUT of hostel
   */
  router.get('/presence-counts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      let targetHostelId: string | undefined;

      if (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) {
        if (!actor.hostelId) {
          throw new ValidationError('Staff member has no assigned hostel');
        }
        targetHostelId = actor.hostelId;
      } else if (actor.role === StaffRole.ADMIN) {
        targetHostelId = (req.query.hostelId as string) || actor.hostelId || undefined;
      }

      if (!targetHostelId) {
        throw new ValidationError('Hostel ID is required to fetch presence counts');
      }

      // Verify hostel belongs to actor organization
      const hostel = await db.hostel.findUnique({ where: { id: targetHostelId } });
      if (!hostel || hostel.organizationId !== actor.organizationId) {
        throw new NotFoundError('Hostel', targetHostelId);
      }

      const counts = await presService.getHostelPresenceCounts(targetHostelId);
      res.status(200).json(counts);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/movements
   * Scoped, paginated history of gate movement events
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const query = req.query as any;

      let effectiveHostelId: string | undefined;

      if (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) {
        if (!actor.hostelId) {
          throw new ValidationError('Staff member has no assigned hostel');
        }
        effectiveHostelId = actor.hostelId;
      } else if (actor.role === StaffRole.ADMIN) {
        if (query.hostelId) {
          const hostel = await db.hostel.findUnique({ where: { id: query.hostelId } });
          if (!hostel || hostel.organizationId !== actor.organizationId) {
            throw new NotFoundError('Hostel', query.hostelId);
          }
          effectiveHostelId = query.hostelId;
        } else if (actor.hostelId) {
          effectiveHostelId = actor.hostelId;
        }
      }

      const page = Math.max(1, parseInt(query.page || '1', 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20', 10)));
      const skip = (page - 1) * pageSize;

      const where: any = {
        hostel: {
          organizationId: actor.organizationId,
          ...(effectiveHostelId ? { id: effectiveHostelId } : {}),
        },
      };

      if (query.residentId) {
        where.residentId = query.residentId;
      }

      if (query.direction) {
        const dir = query.direction.toUpperCase();
        if (dir === 'IN' || dir === 'OUT') {
          where.movementType = dir as MovementType;
        }
      }

      if (query.cameraId) {
        where.cameraId = query.cameraId;
      }

      if (query.source) {
        where.source = query.source as MovementSource;
      }

      if (query.dateFrom || query.dateTo) {
        where.effectiveTimestamp = {};
        if (query.dateFrom) where.effectiveTimestamp.gte = new Date(query.dateFrom);
        if (query.dateTo) where.effectiveTimestamp.lte = new Date(query.dateTo);
      }

      const [total, events] = await Promise.all([
        db.movementEvent.count({ where }),
        db.movementEvent.findMany({
          where,
          include: {
            resident: {
              select: {
                id: true,
                residentCode: true,
                fullName: true,
                roomGroup: true,
                status: true,
              },
            },
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
          skip,
          take: pageSize,
        }),
      ]);

      res.status(200).json({
        data: events,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
