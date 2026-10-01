import { Router, Request, Response, NextFunction } from 'express';
import {
  PrismaClient,
  StaffRole,
  AttendanceSessionType,
  AttendanceSessionStatus,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { AttendanceService } from '../../modules/attendance/attendance.service';
import { AttendanceDecisionService } from '../../modules/attendance-decision/attendance-decision.service';
import {
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors';

export function createAttendanceRouter(
  db: PrismaClient = defaultPrisma,
  attendanceService?: AttendanceService,
  attendanceDecisionService?: AttendanceDecisionService
): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(db);
  const service = attendanceService || new AttendanceService(db);
  const decisionService = attendanceDecisionService || new AttendanceDecisionService(db);

  router.use(requireAuth);

  const getActor = (req: Request) => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }
    return req.user;
  };

  /**
   * GET /api/v1/attendance/sessions
   * List attendance sessions filtered by hostel, status, date, sessionType
   */
  router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const { hostelId, status, sessionType, date } = req.query;

      const sessions = await service.listSessions({
        hostelId: typeof hostelId === 'string' ? hostelId : undefined,
        organizationId: actor.organizationId,
        status: typeof status === 'string' ? (status as AttendanceSessionStatus) : undefined,
        sessionType: typeof sessionType === 'string' ? (sessionType as AttendanceSessionType) : undefined,
        date: typeof date === 'string' ? date : undefined,
        user: actor,
      });

      res.status(200).json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/attendance/active
   * Look up active attendance session for a hostel
   */
  router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const targetHostelId = (req.query.hostelId as string) || actor.hostelId;

      if (!targetHostelId) {
        throw new ValidationError('hostelId is required');
      }

      // Non-admins can only query their own hostel
      if (actor.role !== StaffRole.ADMIN && actor.hostelId && actor.hostelId !== targetHostelId) {
        throw new NotFoundError('Hostel', targetHostelId);
      }

      const cameraId = typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined;
      const activeSession = await decisionService.findActiveSessionForCamera(
        targetHostelId,
        actor.organizationId,
        cameraId
      );

      if (!activeSession) {
        res.status(200).json({ activeSession: null });
        return;
      }

      const rosterData = await service.getAttendanceRoster(activeSession.id);
      res.status(200).json({
        activeSession: rosterData.session,
        stats: rosterData.stats,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/attendance/sessions
   * Create a new attendance session (Admin/Warden only; Guard receives 403)
   */
  router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to create attendance sessions');
      }

      const {
        hostelId,
        title,
        sessionType,
        attendanceDate,
        startTime,
        endTime,
        cameraId,
        locationId,
      } = req.body;

      const targetHostelId = hostelId || actor.hostelId;
      if (!targetHostelId) {
        throw new ValidationError('hostelId is required');
      }

      const session = await service.createSession({
        organizationId: actor.organizationId,
        hostelId: targetHostelId,
        locationId: locationId || null,
        cameraId: cameraId || null,
        sessionType: sessionType || AttendanceSessionType.NIGHT,
        title: title || 'Night Attendance',
        attendanceDate: attendanceDate ? new Date(attendanceDate) : undefined,
        startTime: startTime ? new Date(startTime) : undefined,
        endTime: endTime ? new Date(endTime) : null,
        createdByUserId: actor.id,
        createdByRole: actor.role,
      });

      res.status(201).json({ session });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/attendance/sessions/:id
   * Get attendance session details + summary statistics
   */
  router.get('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const sessionId = req.params.id as string;
      const data = await service.getAttendanceRoster(sessionId);

      // Verify scope
      if (
        data.session.organizationId !== actor.organizationId ||
        (actor.role !== StaffRole.ADMIN && actor.hostelId && data.session.hostelId !== actor.hostelId)
      ) {
        throw new NotFoundError('AttendanceSession', sessionId);
      }

      res.status(200).json({
        session: data.session,
        stats: data.stats,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/attendance/sessions/:id/records
   * Get attendance roster with all expected residents and their status
   */
  router.get('/sessions/:id/records', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const sessionId = req.params.id as string;
      const data = await service.getAttendanceRoster(sessionId);

      // Verify scope
      if (
        data.session.organizationId !== actor.organizationId ||
        (actor.role !== StaffRole.ADMIN && actor.hostelId && data.session.hostelId !== actor.hostelId)
      ) {
        throw new NotFoundError('AttendanceSession', sessionId);
      }

      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/attendance/sessions/:id/records
   * Mark attendance for an individual resident in an active session (Face recognition or manual)
   * Prevents duplicates idempotently.
   */
  router.post('/sessions/:id/records', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards cannot mark attendance records');
      }

      const sessionId = req.params.id as string;
      const { residentId, markMethod } = req.body;

      if (!residentId) {
        throw new ValidationError('residentId is required');
      }

      // Check if already marked (duplicate prevention)
      const existing = await db.attendanceRecord.findUnique({
        where: {
          attendanceSessionId_residentId: {
            attendanceSessionId: sessionId,
            residentId,
          },
        },
      });

      if (existing) {
        res.status(200).json({ record: existing, alreadyMarked: true });
        return;
      }

      const record = await service.markAttendance({
        sessionId,
        residentId,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: (markMethod as AttendanceMarkMethod) || AttendanceMarkMethod.FACE_RECOGNITION,
        markedByUserId: actor.id,
        markedByRole: actor.role,
      });

      res.status(201).json({ record, alreadyMarked: false });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/attendance/sessions/:id/start
   * Start an attendance session (Admin/Warden only)
   */
  router.post('/sessions/:id/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to start attendance sessions');
      }

      const sessionId = req.params.id as string;
      const session = await service.startSession(sessionId, actor.id, actor.role);

      res.status(200).json({ session });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/attendance/sessions/:id/close
   * Close an attendance session and auto-generate ABSENT records for unmarked residents.
   * Admin/Warden only. Idempotent.
   */
  router.post('/sessions/:id/close', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to close attendance sessions');
      }

      const sessionId = req.params.id as string;
      const session = await service.closeSession(sessionId, actor.id, actor.role);

      const rosterData = await service.getAttendanceRoster(sessionId);
      res.status(200).json({
        session,
        stats: rosterData.stats,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/v1/attendance/sessions/:sessionId/records/:residentId
   * Manual correction with mandatory reason.
   * Admin/Warden only; Guard rejected with 403.
   * Completely audited.
   */
  router.patch(
    '/sessions/:sessionId/records/:residentId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actor = getActor(req);
        if (actor.role === StaffRole.GUARD) {
          throw new ForbiddenError('Guards cannot manually correct attendance records');
        }

        const { sessionId, residentId } = req.params;
        const { status, reason } = req.body;

        if (!status || (status !== 'PRESENT' && status !== 'ABSENT')) {
          throw new ValidationError("Status must be either 'PRESENT' or 'ABSENT'");
        }

        if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
          throw new ValidationError('Correction reason is mandatory');
        }

        const record = await service.correctAttendanceRecord({
          sessionId: sessionId as string,
          residentId: residentId as string,
          status: status as AttendanceRecordStatus,
          reason: reason.trim(),
          performedByUserId: actor.id,
          performedByRole: actor.role,
        });

        res.status(200).json({ record });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
