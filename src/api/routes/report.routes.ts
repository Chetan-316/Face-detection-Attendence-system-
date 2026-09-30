import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { ReportService } from '../../modules/reports/report.service';
import {
  AuthenticationError,
  ForbiddenError,
  ValidationError,
} from '../../common/errors';

export function createReportRouter(
  db: PrismaClient = defaultPrisma,
  reportService?: ReportService
): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(db);
  const service = reportService || new ReportService(db);

  router.use(requireAuth);

  const getActor = (req: Request) => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }
    return req.user;
  };

  /**
   * GET /api/v1/reports/attendance
   * Paginated list of attendance sessions with summary metrics
   */
  router.get('/attendance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const query = req.query as any;

      const page = query.page ? parseInt(query.page, 10) : 1;
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;

      const result = await service.getAttendanceSessionsReport(
        {
          hostelId: query.hostelId,
          sessionId: query.sessionId,
          status: query.status,
          sessionType: query.sessionType,
          date: query.date,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          page,
          pageSize,
        },
        actor
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/attendance/sessions/:sessionId
   * Full session roster with operational filters
   */
  router.get('/attendance/sessions/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const sessionId = Array.isArray(req.params.sessionId)
        ? req.params.sessionId[0]
        : req.params.sessionId;

      const { status, search } = req.query;

      const report = await service.getSessionRosterReport(sessionId, actor, {
        statusFilter: typeof status === 'string' ? status : undefined,
        search: typeof search === 'string' ? search : undefined,
      });

      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/attendance/trend
   * Historical attendance rate trend by logical attendance date
   */
  router.get('/attendance/trend', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to view attendance trends');
      }

      const query = req.query as any;
      const days = query.days ? parseInt(query.days, 10) : undefined;

      const trend = await service.getAttendanceTrend(
        {
          hostelId: query.hostelId,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          days,
        },
        actor
      );

      res.status(200).json({ data: trend });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/residents/:residentId/attendance
   * Individual resident attendance summary and chronological history
   */
  router.get('/residents/:residentId/attendance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to view resident attendance reports');
      }

      const residentId = Array.isArray(req.params.residentId)
        ? req.params.residentId[0]
        : req.params.residentId;

      const report = await service.getResidentAttendanceSummary(residentId, actor);
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/movements
   * Paginated movement history with filters
   */
  router.get('/movements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const query = req.query as any;

      const page = query.page ? parseInt(query.page, 10) : 1;
      const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;

      const result = await service.getMovementHistory(
        {
          hostelId: query.hostelId,
          residentId: query.residentId,
          direction: query.direction,
          cameraId: query.cameraId,
          source: query.source,
          search: query.search,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          page,
          pageSize,
        },
        actor
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/residents/:residentId/movements
   * Chronological movement timeline for a specific resident
   */
  router.get('/residents/:residentId/movements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const residentId = Array.isArray(req.params.residentId)
        ? req.params.residentId[0]
        : req.params.residentId;

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const movements = await service.getResidentMovementHistory(residentId, actor, limit);
      res.status(200).json({ data: movements });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/presence
   * Real-time hostel presence counts (Inside vs Outside) from ResidentPresence
   */
  router.get('/presence', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const hostelId = typeof req.query.hostelId === 'string' ? req.query.hostelId : undefined;

      const summary = await service.getCurrentPresenceSummary(hostelId, actor);
      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/presence/outside
   * Operational roster of residents currently outside the hostel
   */
  router.get('/presence/outside', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const hostelId = typeof req.query.hostelId === 'string' ? req.query.hostelId : undefined;

      const outsideList = await service.getCurrentlyOutsideList(hostelId, actor);
      res.status(200).json({ data: outsideList, total: outsideList.length });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/residents/:residentId/summary
   * Consolidated operational summary for a resident (attendance + movement + presence)
   */
  router.get('/residents/:residentId/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to view resident operational summaries');
      }

      const residentId = Array.isArray(req.params.residentId)
        ? req.params.residentId[0]
        : req.params.residentId;

      const summary = await service.getResidentSummary(residentId, actor);
      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/export/attendance
   * Export attendance CSV report
   */
  router.get('/export/attendance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to export attendance CSV reports');
      }

      const query = req.query as any;
      const csv = await service.exportAttendanceCsv(
        {
          hostelId: query.hostelId,
          sessionId: query.sessionId,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
        },
        actor
      );

      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${timestamp}.csv"`);
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/reports/export/movements
   * Export movement CSV report
   */
  router.get('/export/movements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      if (actor.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to export movement CSV reports');
      }

      const query = req.query as any;
      const csv = await service.exportMovementCsv(
        {
          hostelId: query.hostelId,
          residentId: query.residentId,
          direction: query.direction,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
        },
        actor
      );

      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="movement-report-${timestamp}.csv"`);
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
