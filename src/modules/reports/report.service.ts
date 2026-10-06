import {
  PrismaClient,
  StaffRole,
  AttendanceSessionStatus,
  AttendanceRecordStatus,
  MovementType,
  ResidentStatus,
  PresenceState,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { StaffActor } from '../auth/permissions';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors';
import { formatInAppTimezone } from '../../common/utils/timezone';
import {
  AttendanceReportQuery,
  AttendanceSessionReportItem,
  SessionRosterReport,
  AttendanceTrendQuery,
  AttendanceTrendPoint,
  ResidentAttendanceSummaryReport,
  MovementReportQuery,
  MovementReportItem,
  PaginatedResult,
  AttendanceReportSummary,
  PaginatedAttendanceResult,
  PresenceSummaryReport,
  CurrentlyOutsideReportItem,
  ResidentSummaryReport,
} from './report.types';
import { buildCsv } from './csv-export';

export class ReportService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Validates and resolves the target hostel ID according to actor role and permissions.
   * Enforces strict cross-hostel (404) and cross-organization isolation.
   */
  public async resolveHostelScope(actor: StaffActor, requestedHostelId?: string): Promise<string> {
    if (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) {
      if (!actor.hostelId) {
        throw new ValidationError('Staff user has no assigned hostel');
      }
      if (requestedHostelId && requestedHostelId !== actor.hostelId) {
        // Return non-leaking 404 if warden or guard attempts to query another hostel
        throw new NotFoundError('Hostel', requestedHostelId);
      }
      return actor.hostelId;
    }

    // Role is ADMIN
    if (requestedHostelId) {
      const hostel = await this.db.hostel.findUnique({
        where: { id: requestedHostelId },
      });
      if (!hostel || hostel.organizationId !== actor.organizationId) {
        throw new NotFoundError('Hostel', requestedHostelId);
      }
      return requestedHostelId;
    }

    if (actor.hostelId) {
      return actor.hostelId;
    }

    // If admin has no hostel assigned and didn't specify one, find first active hostel in organization
    const defaultHostel = await this.db.hostel.findFirst({
      where: { organizationId: actor.organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!defaultHostel) {
      throw new ValidationError('No active hostel found in organization');
    }
    return defaultHostel.id;
  }

  /**
   * Retrieves paginated attendance sessions with aggregated real database metrics.
   * Adheres to logical attendanceDate grouping and distinguishes ACTIVE vs CLOSED session statistics.
   */
  public async getAttendanceSessionsReport(
    query: AttendanceReportQuery,
    actor: StaffActor
  ): Promise<PaginatedAttendanceResult> {
    const hostelId = await this.resolveHostelScope(actor, query.hostelId);

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const where: any = {
      organizationId: actor.organizationId,
      hostelId,
    };

    if (query.sessionId) {
      where.id = query.sessionId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.sessionType) {
      where.sessionType = query.sessionType;
    }

    if (query.date) {
      const targetDate = new Date(query.date);
      const startOfDay = new Date(targetDate);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setUTCHours(23, 59, 59, 999);
      where.attendanceDate = { gte: startOfDay, lte: endOfDay };
    } else if (query.dateFrom || query.dateTo) {
      where.attendanceDate = {};
      if (query.dateFrom) where.attendanceDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.attendanceDate.lte = new Date(query.dateTo);
    }

    const [total, sessions, closedSessions] = await Promise.all([
      this.db.attendanceSession.count({ where }),
      this.db.attendanceSession.findMany({
        where,
        include: {
          hostel: { select: { id: true, name: true } },
        },
        orderBy: [{ attendanceDate: 'desc' }, { startTime: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.db.attendanceSession.findMany({
        where: {
          ...where,
          status: AttendanceSessionStatus.CLOSED,
        },
        select: { id: true },
      }),
    ]);

    // Authoritative Server-side Summary covering the ENTIRE filtered dataset (closed sessions weighted rate)
    const closedSessionIds = closedSessions.map((s) => s.id);
    let summaryPresent = 0;
    let summaryAbsent = 0;
    let summaryExpected = 0;

    if (closedSessionIds.length > 0) {
      const closedRecordCounts = await this.db.attendanceRecord.groupBy({
        by: ['status'],
        where: {
          attendanceSessionId: { in: closedSessionIds },
        },
        _count: { id: true },
      });

      for (const item of closedRecordCounts) {
        summaryExpected += item._count.id;
        if (
          item.status === AttendanceRecordStatus.PRESENT ||
          item.status === AttendanceRecordStatus.CORRECTED_PRESENT
        ) {
          summaryPresent += item._count.id;
        } else if (item.status === AttendanceRecordStatus.ABSENT) {
          summaryAbsent += item._count.id;
        }
      }
    }

    const summaryAttendanceRate =
      summaryExpected > 0 ? Math.round((summaryPresent / summaryExpected) * 100) : 0;

    const summary: AttendanceReportSummary = {
      sessions: total,
      closedSessions: closedSessionIds.length,
      present: summaryPresent,
      absent: summaryAbsent,
      expected: summaryExpected,
      attendanceRate: summaryAttendanceRate,
    };

    if (sessions.length === 0) {
      return {
        data: [],
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        summary,
      };
    }

    const sessionIds = sessions.map((s) => s.id);

    // Batch query counts grouped by attendanceSessionId and status to avoid N+1
    const recordCounts = await this.db.attendanceRecord.groupBy({
      by: ['attendanceSessionId', 'status'],
      where: {
        attendanceSessionId: { in: sessionIds },
      },
      _count: { id: true },
    });

    const countsMap = new Map<string, { present: number; absent: number; totalRecords: number }>();
    for (const item of recordCounts) {
      const existing = countsMap.get(item.attendanceSessionId) || { present: 0, absent: 0, totalRecords: 0 };
      existing.totalRecords += item._count.id;
      if (
        item.status === AttendanceRecordStatus.PRESENT ||
        item.status === AttendanceRecordStatus.CORRECTED_PRESENT
      ) {
        existing.present += item._count.id;
      } else if (item.status === AttendanceRecordStatus.ABSENT) {
        existing.absent += item._count.id;
      }
      countsMap.set(item.attendanceSessionId, existing);
    }

    // Count current active eligible residents in this hostel for active sessions
    const activeResidentCount = await this.db.resident.count({
      where: {
        hostelId,
        organizationId: actor.organizationId,
        status: ResidentStatus.ACTIVE,
      },
    });

    const data: AttendanceSessionReportItem[] = sessions.map((session) => {
      const counts = countsMap.get(session.id) || { present: 0, absent: 0, totalRecords: 0 };
      const isFinalized = session.status === AttendanceSessionStatus.CLOSED;

      let expectedResidents: number;
      let absentCount: number;
      let remainingCount: number;

      if (isFinalized) {
        // For a closed session, the records created represent the finalized session roster
        expectedResidents = counts.totalRecords;
        absentCount = counts.absent;
        remainingCount = 0;
      } else {
        // For active / draft sessions, expected is current active eligible residents
        expectedResidents = Math.max(activeResidentCount, counts.totalRecords);
        absentCount = counts.absent;
        remainingCount = Math.max(0, expectedResidents - counts.present);
      }

      const attendanceRate =
        expectedResidents > 0 ? Math.round((counts.present / expectedResidents) * 100) : 0;

      return {
        id: session.id,
        hostelId: session.hostelId,
        hostelName: session.hostel.name,
        sessionType: session.sessionType,
        title: session.title,
        attendanceDate: session.attendanceDate.toISOString(),
        status: session.status,
        startTime: session.startTime.toISOString(),
        endTime: session.endTime?.toISOString() || null,
        expectedResidents,
        presentCount: counts.present,
        absentCount,
        remainingCount,
        attendanceRate,
        isFinalized,
      };
    });

    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      summary,
    };
  }

  /**
   * Retrieves full attendance roster for a specific session with operational filters.
   * Includes historical records even if resident was later deactivated.
   */
  public async getSessionRosterReport(
    sessionId: string,
    actor: StaffActor,
    options?: { statusFilter?: string; search?: string }
  ): Promise<SessionRosterReport> {
    const session = await this.db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        hostel: { select: { id: true, name: true, organizationId: true } },
      },
    });

    if (!session || session.organizationId !== actor.organizationId) {
      throw new NotFoundError('AttendanceSession', sessionId);
    }

    if (
      (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) &&
      actor.hostelId !== session.hostelId
    ) {
      throw new NotFoundError('AttendanceSession', sessionId);
    }

    // 1. Fetch all attendance records for this session with resident relation
    const records = await this.db.attendanceRecord.findMany({
      where: { attendanceSessionId: sessionId },
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
        correctedBy: {
          select: {
            id: true,
            fullName: true,
            role: true,
          },
        },
      },
      orderBy: [{ resident: { roomGroup: 'asc' } }, { resident: { residentCode: 'asc' } }],
    });

    // 2. If session is ACTIVE, also include active residents in hostel who haven't marked attendance yet
    const recordedResidentIds = new Set(records.map((r) => r.residentId));

    let unrecordedResidents: any[] = [];
    if (session.status === AttendanceSessionStatus.ACTIVE) {
      unrecordedResidents = await this.db.resident.findMany({
        where: {
          hostelId: session.hostelId,
          organizationId: session.organizationId,
          status: ResidentStatus.ACTIVE,
          id: { notIn: Array.from(recordedResidentIds) },
        },
        select: {
          id: true,
          residentCode: true,
          fullName: true,
          roomGroup: true,
          status: true,
        },
        orderBy: [{ roomGroup: 'asc' }, { residentCode: 'asc' }],
      });
    }

    let presentCount = 0;
    let absentCount = 0;

    const rosterItems: any[] = [];

    for (const record of records) {
      const isPresent =
        record.status === AttendanceRecordStatus.PRESENT ||
        record.status === AttendanceRecordStatus.CORRECTED_PRESENT;
      if (isPresent) presentCount++;
      if (record.status === AttendanceRecordStatus.ABSENT) absentCount++;

      const isCorrected =
        record.markMethod === 'WARDEN_OVERRIDE' ||
        Boolean(record.correctionReason) ||
        record.status === AttendanceRecordStatus.CORRECTED_PRESENT;

      rosterItems.push({
        recordId: record.id,
        residentId: record.resident.id,
        residentCode: record.resident.residentCode,
        fullName: record.resident.fullName,
        roomGroup: record.resident.roomGroup,
        status: record.status,
        markedAt: record.markedAt ? record.markedAt.toISOString() : null,
        markMethod: record.markMethod,
        isCorrected,
        correctionReason: record.correctionReason || null,
        correctedBy: record.correctedBy
          ? {
              id: record.correctedBy.id,
              fullName: record.correctedBy.fullName,
              role: record.correctedBy.role,
            }
          : null,
      });
    }

    for (const res of unrecordedResidents) {
      rosterItems.push({
        recordId: null,
        residentId: res.id,
        residentCode: res.residentCode,
        fullName: res.fullName,
        roomGroup: res.roomGroup,
        status: 'NOT_RECORDED',
        markedAt: null,
        markMethod: null,
        isCorrected: false,
        correctionReason: null,
        correctedBy: null,
      });
    }

    const expectedResidents = rosterItems.length;
    const remainingCount = Math.max(0, expectedResidents - presentCount);
    const attendanceRate =
      expectedResidents > 0 ? Math.round((presentCount / expectedResidents) * 100) : 0;

    // Apply optional in-memory filters for searching and status
    let filteredRoster = rosterItems;
    if (options?.statusFilter && options.statusFilter !== 'ALL') {
      const sf = options.statusFilter.toUpperCase();
      if (sf === 'PRESENT') {
        filteredRoster = filteredRoster.filter(
          (r) =>
            r.status === AttendanceRecordStatus.PRESENT ||
            r.status === AttendanceRecordStatus.CORRECTED_PRESENT
        );
      } else if (sf === 'ABSENT') {
        filteredRoster = filteredRoster.filter((r) => r.status === AttendanceRecordStatus.ABSENT);
      } else {
        filteredRoster = filteredRoster.filter((r) => r.status === sf);
      }
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase().trim();
      filteredRoster = filteredRoster.filter(
        (r) =>
          r.fullName.toLowerCase().includes(searchLower) ||
          r.residentCode.toLowerCase().includes(searchLower) ||
          r.roomGroup.toLowerCase().includes(searchLower)
      );
    }

    const sessionReport: AttendanceSessionReportItem = {
      id: session.id,
      hostelId: session.hostelId,
      hostelName: session.hostel.name,
      sessionType: session.sessionType,
      title: session.title,
      attendanceDate: session.attendanceDate.toISOString(),
      status: session.status,
      startTime: session.startTime.toISOString(),
      endTime: session.endTime?.toISOString() || null,
      expectedResidents,
      presentCount,
      absentCount,
      remainingCount,
      attendanceRate,
      isFinalized: session.status === AttendanceSessionStatus.CLOSED,
    };

    return {
      session: sessionReport,
      roster: filteredRoster,
      stats: {
        expectedResidents,
        presentCount,
        absentCount,
        remainingCount,
        attendanceRate,
      },
    };
  }

  /**
   * Calculates attendance trend data points grouped by logical attendanceDate.
   */
  public async getAttendanceTrend(
    query: AttendanceTrendQuery,
    actor: StaffActor
  ): Promise<AttendanceTrendPoint[]> {
    if (actor.role === StaffRole.GUARD) {
      throw new ForbiddenError('Guards are not authorized to access historical attendance trends');
    }

    const hostelId = await this.resolveHostelScope(actor, query.hostelId);

    const where: any = {
      organizationId: actor.organizationId,
      hostelId,
    };

    if (query.dateFrom || query.dateTo) {
      where.attendanceDate = {};
      if (query.dateFrom) where.attendanceDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.attendanceDate.lte = new Date(query.dateTo);
    } else {
      // Default to last 30 days
      const pastDays = query.days || 30;
      const sinceDate = new Date();
      sinceDate.setUTCDate(sinceDate.getUTCDate() - pastDays);
      sinceDate.setUTCHours(0, 0, 0, 0);
      where.attendanceDate = { gte: sinceDate };
    }

    const sessions = await this.db.attendanceSession.findMany({
      where,
      orderBy: { attendanceDate: 'asc' },
      select: {
        id: true,
        title: true,
        attendanceDate: true,
        status: true,
      },
    });

    if (sessions.length === 0) {
      return [];
    }

    const sessionIds = sessions.map((s) => s.id);

    // Batch group by session and status
    const recordCounts = await this.db.attendanceRecord.groupBy({
      by: ['attendanceSessionId', 'status'],
      where: { attendanceSessionId: { in: sessionIds } },
      _count: { id: true },
    });

    const sessionStatsMap = new Map<string, { present: number; total: number }>();
    for (const item of recordCounts) {
      const current = sessionStatsMap.get(item.attendanceSessionId) || { present: 0, total: 0 };
      current.total += item._count.id;
      if (
        item.status === AttendanceRecordStatus.PRESENT ||
        item.status === AttendanceRecordStatus.CORRECTED_PRESENT
      ) {
        current.present += item._count.id;
      }
      sessionStatsMap.set(item.attendanceSessionId, current);
    }

    // Active resident count for non-closed sessions if any
    const activeResidentCount = await this.db.resident.count({
      where: {
        hostelId,
        organizationId: actor.organizationId,
        status: ResidentStatus.ACTIVE,
      },
    });

    // Group sessions by logical date string (YYYY-MM-DD)
    const dateMap = new Map<
      string,
      {
        present: number;
        expected: number;
        sessionCount: number;
        titles: string[];
        status: AttendanceSessionStatus;
      }
    >();

    for (const s of sessions) {
      const dateStr = s.attendanceDate.toISOString().split('T')[0];
      const stats = sessionStatsMap.get(s.id) || { present: 0, total: 0 };

      const expected =
        s.status === AttendanceSessionStatus.CLOSED
          ? stats.total
          : Math.max(activeResidentCount, stats.total);

      const existing = dateMap.get(dateStr) || {
        present: 0,
        expected: 0,
        sessionCount: 0,
        titles: [],
        status: s.status,
      };

      existing.present += stats.present;
      existing.expected += expected;
      existing.sessionCount += 1;
      existing.titles.push(s.title);
      existing.status = s.status;

      dateMap.set(dateStr, existing);
    }

    const points: AttendanceTrendPoint[] = [];
    for (const [dateStr, aggregate] of dateMap.entries()) {
      const attendanceRate =
        aggregate.expected > 0 ? Math.round((aggregate.present / aggregate.expected) * 100) : 0;

      points.push({
        date: dateStr,
        attendanceRate,
        presentCount: aggregate.present,
        expectedCount: aggregate.expected,
        sessionCount: aggregate.sessionCount,
        status: aggregate.status,
        sessionTitles: aggregate.titles,
      });
    }

    return points;
  }

  /**
   * Retrieves individual resident attendance history and overall percentage.
   */
  public async getResidentAttendanceSummary(
    residentId: string,
    actor: StaffActor
  ): Promise<ResidentAttendanceSummaryReport> {
    if (actor.role === StaffRole.GUARD) {
      throw new ForbiddenError('Guards are not authorized to access individual resident attendance reports');
    }

    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
      include: {
        hostel: { select: { id: true, name: true, organizationId: true } },
      },
    });

    if (!resident || resident.organizationId !== actor.organizationId) {
      throw new NotFoundError('Resident', residentId);
    }

    if (actor.role === StaffRole.WARDEN && actor.hostelId !== resident.hostelId) {
      throw new NotFoundError('Resident', residentId);
    }

    const records = await this.db.attendanceRecord.findMany({
      where: { residentId: resident.id },
      include: {
        session: {
          select: {
            id: true,
            title: true,
            attendanceDate: true,
            status: true,
          },
        },
      },
      orderBy: { session: { attendanceDate: 'desc' } },
    });

    let presentSessions = 0;
    let absentSessions = 0;

    const formattedRecords = records.map((r) => {
      const isPresent =
        r.status === AttendanceRecordStatus.PRESENT ||
        r.status === AttendanceRecordStatus.CORRECTED_PRESENT;

      if (isPresent) presentSessions++;
      if (r.status === AttendanceRecordStatus.ABSENT) absentSessions++;

      const isCorrected =
        r.markMethod === 'WARDEN_OVERRIDE' ||
        Boolean(r.correctionReason) ||
        r.status === AttendanceRecordStatus.CORRECTED_PRESENT;

      return {
        sessionId: r.session.id,
        sessionTitle: r.session.title,
        sessionDate: r.session.attendanceDate.toISOString(),
        sessionStatus: r.session.status,
        status: r.status,
        markedAt: r.markedAt ? r.markedAt.toISOString() : r.createdAt.toISOString(),
        markMethod: r.markMethod,
        isCorrected,
        correctionReason: r.correctionReason || null,
      };
    });

    const totalSessions = records.length;
    const attendanceRate =
      totalSessions > 0 ? Math.round((presentSessions / totalSessions) * 100) : 0;

    return {
      residentId: resident.id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      roomGroup: resident.roomGroup,
      status: resident.status,
      hostelId: resident.hostelId,
      hostelName: resident.hostel.name,
      totalSessions,
      presentSessions,
      absentSessions,
      attendanceRate,
      records: formattedRecords,
    };
  }

  /**
   * Retrieves paginated movement history.
   * Strips out similarity scores and biometric templates for strict privacy.
   */
  public async getMovementHistory(
    query: MovementReportQuery,
    actor: StaffActor
  ): Promise<PaginatedResult<MovementReportItem>> {
    let effectiveHostelId: string | undefined;

    if (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) {
      if (!actor.hostelId) {
        throw new ValidationError('Staff user has no assigned hostel');
      }
      if (query.hostelId && query.hostelId !== actor.hostelId) {
        throw new NotFoundError('Hostel', query.hostelId);
      }
      effectiveHostelId = actor.hostelId;
    } else if (actor.role === StaffRole.ADMIN) {
      if (query.hostelId) {
        const hostel = await this.db.hostel.findUnique({ where: { id: query.hostelId } });
        if (!hostel || hostel.organizationId !== actor.organizationId) {
          throw new NotFoundError('Hostel', query.hostelId);
        }
        effectiveHostelId = query.hostelId;
      }
    }

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
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
      where.movementType = query.direction;
    }

    if (query.cameraId) {
      where.cameraId = query.cameraId;
    }

    if (query.source) {
      where.source = query.source;
    }

    if (query.dateFrom || query.dateTo) {
      where.effectiveTimestamp = {};
      if (query.dateFrom) where.effectiveTimestamp.gte = new Date(query.dateFrom);
      if (query.dateTo) where.effectiveTimestamp.lte = new Date(query.dateTo);
    }

    if (query.search) {
      const search = query.search.trim();
      where.resident = {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { residentCode: { contains: search, mode: 'insensitive' } },
          { roomGroup: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [total, events] = await Promise.all([
      this.db.movementEvent.count({ where }),
      this.db.movementEvent.findMany({
        where,
        include: {
          resident: {
            select: {
              id: true,
              residentCode: true,
              fullName: true,
              roomGroup: true,
            },
          },
          camera: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
        },
        orderBy: { effectiveTimestamp: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    const data: MovementReportItem[] = events.map((ev) => ({
      id: ev.id,
      timestamp: ev.effectiveTimestamp.toISOString(),
      residentId: ev.resident.id,
      residentCode: ev.resident.residentCode,
      fullName: ev.resident.fullName,
      roomGroup: ev.resident.roomGroup,
      direction: ev.movementType,
      gateName: ev.camera?.name || ev.location?.name || 'Gate',
      source: ev.source,
      isCorrection: ev.isCorrection,
      notes: ev.notes,
    }));

    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Retrieves individual resident movement history timeline.
   */
  public async getResidentMovementHistory(
    residentId: string,
    actor: StaffActor,
    limit = 50
  ): Promise<MovementReportItem[]> {
    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
      include: {
        hostel: { select: { id: true, organizationId: true } },
      },
    });

    if (!resident || resident.organizationId !== actor.organizationId) {
      throw new NotFoundError('Resident', residentId);
    }

    if (actor.role === StaffRole.WARDEN && actor.hostelId !== resident.hostelId) {
      throw new NotFoundError('Resident', residentId);
    }

    const events = await this.db.movementEvent.findMany({
      where: { residentId: resident.id },
      include: {
        camera: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: { effectiveTimestamp: 'desc' },
      take: Math.min(200, limit),
    });

    return events.map((ev) => ({
      id: ev.id,
      timestamp: ev.effectiveTimestamp.toISOString(),
      residentId: resident.id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      roomGroup: resident.roomGroup,
      direction: ev.movementType,
      gateName: ev.camera?.name || ev.location?.name || 'Gate',
      source: ev.source,
      isCorrection: ev.isCorrection,
      notes: ev.notes,
    }));
  }

  /**
   * Authoritative presence summary derived directly from ResidentPresence.
   */
  public async getCurrentPresenceSummary(
    requestedHostelId: string | undefined,
    actor: StaffActor
  ): Promise<PresenceSummaryReport> {
    if (actor.role === StaffRole.ADMIN && !requestedHostelId) {
      const presenceCounts = await this.db.residentPresence.groupBy({
        by: ['currentState'],
        where: {
          hostel: { organizationId: actor.organizationId },
        },
        _count: { residentId: true },
      });

      let insideCount = 0;
      let outsideCount = 0;
      for (const item of presenceCounts) {
        if (item.currentState === PresenceState.IN) insideCount = item._count.residentId;
        if (item.currentState === PresenceState.OUT) outsideCount = item._count.residentId;
      }

      const totalResidents = insideCount + outsideCount;
      return {
        hostelId: 'ALL',
        hostelName: 'All Hostels',
        totalResidents,
        insideCount,
        outsideCount,
        insideRate: totalResidents > 0 ? Math.round((insideCount / totalResidents) * 100) : 0,
        outsideRate: totalResidents > 0 ? Math.round((outsideCount / totalResidents) * 100) : 0,
      };
    }

    const hostelId = await this.resolveHostelScope(actor, requestedHostelId);

    const hostel = await this.db.hostel.findUnique({
      where: { id: hostelId },
      select: { id: true, name: true },
    });
    if (!hostel) {
      throw new NotFoundError('Hostel', hostelId);
    }

    const presenceCounts = await this.db.residentPresence.groupBy({
      by: ['currentState'],
      where: { hostelId },
      _count: { residentId: true },
    });

    let insideCount = 0;
    let outsideCount = 0;

    for (const item of presenceCounts) {
      if (item.currentState === PresenceState.IN) {
        insideCount = item._count.residentId;
      } else if (item.currentState === PresenceState.OUT) {
        outsideCount = item._count.residentId;
      }
    }

    const totalResidents = insideCount + outsideCount;
    const insideRate = totalResidents > 0 ? Math.round((insideCount / totalResidents) * 100) : 0;
    const outsideRate = totalResidents > 0 ? Math.round((outsideCount / totalResidents) * 100) : 0;

    return {
      hostelId: hostel.id,
      hostelName: hostel.name,
      totalResidents,
      insideCount,
      outsideCount,
      insideRate,
      outsideRate,
    };
  }

  /**
   * Retrieves operational list of residents currently OUT of hostel from ResidentPresence.
   */
  public async getCurrentlyOutsideList(
    requestedHostelId: string | undefined,
    actor: StaffActor
  ): Promise<CurrentlyOutsideReportItem[]> {
    let hostelId: string | undefined;

    if (actor.role === StaffRole.ADMIN && !requestedHostelId) {
      hostelId = undefined;
    } else {
      hostelId = await this.resolveHostelScope(actor, requestedHostelId);
    }

    const presences = await this.db.residentPresence.findMany({
      where: {
        ...(hostelId ? { hostelId } : { hostel: { organizationId: actor.organizationId } }),
        currentState: PresenceState.OUT,
      },
      include: {
        resident: {
          select: {
            id: true,
            residentCode: true,
            fullName: true,
            roomGroup: true,
          },
        },
        lastMovementEvent: {
          include: {
            camera: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { lastMovementTime: 'desc' },
    });

    return presences.map((p) => ({
      residentId: p.resident.id,
      residentCode: p.resident.residentCode,
      fullName: p.resident.fullName,
      roomGroup: p.resident.roomGroup,
      lastMovementTime: p.lastMovementTime ? p.lastMovementTime.toISOString() : null,
      gateName:
        p.lastMovementEvent?.camera?.name ||
        p.lastMovementEvent?.location?.name ||
        'Main Gate',
      direction: MovementType.OUT,
    }));
  }

  /**
   * Retrieves comprehensive resident operational summary for resident detail reporting.
   */
  public async getResidentSummary(
    residentId: string,
    actor: StaffActor
  ): Promise<ResidentSummaryReport> {
    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
      include: {
        hostel: { select: { id: true, name: true, organizationId: true } },
        presence: {
          include: {
            lastMovementEvent: {
              include: {
                camera: { select: { id: true, name: true } },
                location: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!resident || resident.organizationId !== actor.organizationId) {
      throw new NotFoundError('Resident', residentId);
    }

    if (actor.role === StaffRole.WARDEN && actor.hostelId !== resident.hostelId) {
      throw new NotFoundError('Resident', residentId);
    }

    // Attendance stats
    const attendanceRecords = await this.db.attendanceRecord.findMany({
      where: { residentId: resident.id },
      include: {
        session: {
          select: {
            id: true,
            title: true,
            attendanceDate: true,
            status: true,
          },
        },
      },
      orderBy: { session: { attendanceDate: 'desc' } },
    });

    let presentSessions = 0;
    let absentSessions = 0;

    const formattedAttendance = attendanceRecords.map((r) => {
      const isPresent =
        r.status === AttendanceRecordStatus.PRESENT ||
        r.status === AttendanceRecordStatus.CORRECTED_PRESENT;
      if (isPresent) presentSessions++;
      if (r.status === AttendanceRecordStatus.ABSENT) absentSessions++;

      return {
        sessionId: r.session.id,
        sessionTitle: r.session.title,
        sessionDate: r.session.attendanceDate.toISOString(),
        sessionStatus: r.session.status,
        status: r.status,
        markedAt: r.markedAt ? r.markedAt.toISOString() : r.createdAt.toISOString(),
        markMethod: r.markMethod,
        isCorrected:
          r.markMethod === 'WARDEN_OVERRIDE' ||
          Boolean(r.correctionReason) ||
          r.status === AttendanceRecordStatus.CORRECTED_PRESENT,
        correctionReason: r.correctionReason || null,
      };
    });

    const totalAttendanceSessions = attendanceRecords.length;
    const attendanceRate =
      totalAttendanceSessions > 0
        ? Math.round((presentSessions / totalAttendanceSessions) * 100)
        : 0;

    // Movement events (recent 10)
    const recentMovements = await this.getResidentMovementHistory(resident.id, actor, 10);

    return {
      id: resident.id,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      roomGroup: resident.roomGroup,
      contactPhone: resident.contactPhone,
      contactEmail: resident.contactEmail,
      status: resident.status,
      hostelId: resident.hostelId,
      hostelName: resident.hostel.name,
      currentPresence: resident.presence?.currentState || PresenceState.IN,
      lastMovementTime: resident.presence?.lastMovementTime
        ? resident.presence.lastMovementTime.toISOString()
        : null,
      lastMovementGate:
        resident.presence?.lastMovementEvent?.camera?.name ||
        resident.presence?.lastMovementEvent?.location?.name ||
        null,
      lastMovementDirection: resident.presence?.lastMovementType || null,
      totalAttendanceSessions,
      presentSessions,
      absentSessions,
      attendanceRate,
      recentAttendance: formattedAttendance.slice(0, 10),
      recentMovements,
    };
  }

  /**
   * Generates sanitized CSV export for attendance sessions/rosters.
   * Protects against formula injection and respects timezones.
   */
  public async exportAttendanceCsv(
    query: AttendanceReportQuery,
    actor: StaffActor
  ): Promise<string> {
    if (actor.role === StaffRole.GUARD) {
      throw new ForbiddenError('Guards are not authorized to export attendance CSV reports');
    }

    const hostelId = await this.resolveHostelScope(actor, query.hostelId);

    const where: any = {
      organizationId: actor.organizationId,
      hostelId,
    };

    if (query.sessionId) {
      where.id = query.sessionId;
    }

    if (query.dateFrom || query.dateTo) {
      where.attendanceDate = {};
      if (query.dateFrom) where.attendanceDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.attendanceDate.lte = new Date(query.dateTo);
    }

    const sessions = await this.db.attendanceSession.findMany({
      where,
      include: {
        records: {
          include: {
            resident: {
              select: {
                residentCode: true,
                fullName: true,
                roomGroup: true,
              },
            },
          },
        },
      },
      orderBy: [{ attendanceDate: 'desc' }, { startTime: 'desc' }],
    });

    const headers = [
      'Date',
      'Session',
      'Resident Code',
      'Resident Name',
      'Room',
      'Status',
      'Marked At',
      'Method',
      'Correction',
    ];

    const rows: (unknown[])[] = [];

    for (const session of sessions) {
      const sessionDateFormatted = formatInAppTimezone(session.attendanceDate, 'yyyy-MM-dd');

      for (const record of session.records) {
        const markedAtFormatted = record.markedAt
          ? formatInAppTimezone(record.markedAt, 'yyyy-MM-dd HH:mm:ss')
          : '';

        const isCorrection =
          record.markMethod === 'WARDEN_OVERRIDE' ||
          Boolean(record.correctionReason) ||
          record.status === AttendanceRecordStatus.CORRECTED_PRESENT;

        rows.push([
          sessionDateFormatted,
          session.title,
          record.resident.residentCode,
          record.resident.fullName,
          record.resident.roomGroup,
          record.status,
          markedAtFormatted,
          record.markMethod,
          isCorrection ? `Corrected: ${record.correctionReason || 'Manual override'}` : 'Normal',
        ]);
      }
    }

    return buildCsv(headers, rows);
  }

  /**
   * Generates sanitized CSV export for gate movement events.
   * Protects against formula injection and respects timezones.
   */
  public async exportMovementCsv(
    query: MovementReportQuery,
    actor: StaffActor
  ): Promise<string> {
    if (actor.role === StaffRole.GUARD) {
      throw new ForbiddenError('Guards are not authorized to export movement CSV reports');
    }

    const hostelId = await this.resolveHostelScope(actor, query.hostelId);

    const where: any = {
      hostel: {
        organizationId: actor.organizationId,
        id: hostelId,
      },
    };

    if (query.residentId) {
      where.residentId = query.residentId;
    }

    if (query.direction) {
      where.movementType = query.direction;
    }

    if (query.dateFrom || query.dateTo) {
      where.effectiveTimestamp = {};
      if (query.dateFrom) where.effectiveTimestamp.gte = new Date(query.dateFrom);
      if (query.dateTo) where.effectiveTimestamp.lte = new Date(query.dateTo);
    }

    const events = await this.db.movementEvent.findMany({
      where,
      include: {
        resident: {
          select: {
            residentCode: true,
            fullName: true,
            roomGroup: true,
          },
        },
        camera: { select: { name: true } },
        location: { select: { name: true } },
      },
      orderBy: { effectiveTimestamp: 'desc' },
      take: 5000, // Safe maximum for export
    });

    const headers = [
      'Timestamp',
      'Resident Code',
      'Resident Name',
      'Room',
      'Direction',
      'Gate',
      'Source',
      'Is Correction',
    ];

    const rows: (unknown[])[] = [];

    for (const ev of events) {
      const timeFormatted = formatInAppTimezone(ev.effectiveTimestamp, 'yyyy-MM-dd HH:mm:ss');
      rows.push([
        timeFormatted,
        ev.resident.residentCode,
        ev.resident.fullName,
        ev.resident.roomGroup,
        ev.movementType,
        ev.camera?.name || ev.location?.name || 'Gate',
        ev.source,
        ev.isCorrection ? 'YES' : 'NO',
      ]);
    }

    return buildCsv(headers, rows);
  }
}
