import {
  Prisma,
  PrismaClient,
  AttendanceSession,
  AttendanceRecord,
  AttendanceSessionType,
  AttendanceSessionStatus,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
  StaffRole,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import {
  ConflictError,
  DomainIntegrityError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '../../common/errors';
import { assertPermission, assertUserCanOperateInHostel } from '../auth/permissions';
import { AuditService } from '../audit/audit.service';
import { nowUtc } from '../../common/utils/timezone';

export interface CreateSessionInput {
  organizationId: string;
  hostelId: string;
  locationId?: string | null;
  sessionType: AttendanceSessionType;
  title: string;
  startTime?: Date;
  createdByUserId: string;
  createdByRole: StaffRole;
}

export interface MarkAttendanceInput {
  sessionId: string;
  residentId: string;
  status: AttendanceRecordStatus;
  markMethod: AttendanceMarkMethod;
  markedByUserId?: string | null;
  markedByRole?: StaffRole | null;
  notes?: string | null;
  recognitionReference?: string | null;
}

export class AttendanceService {
  private auditService: AuditService;

  constructor(private readonly db: PrismaClient = defaultPrisma) {
    this.auditService = new AuditService(this.db);
  }

  public async createSession(input: CreateSessionInput): Promise<AttendanceSession> {
    assertPermission(input.createdByRole, 'ATTENDANCE_SESSION_CREATE');

    if (!input.title || input.title.trim().length === 0) {
      throw new ValidationError('Session title is required');
    }

    const hostel = await this.db.hostel.findUnique({
      where: { id: input.hostelId },
    });
    if (!hostel) {
      throw new NotFoundError('Hostel', input.hostelId);
    }

    // Organization / Hostel consistency
    if (hostel.organizationId !== input.organizationId) {
      throw new DomainIntegrityError(
        `Hostel '${hostel.id}' belongs to organization '${hostel.organizationId}', not '${input.organizationId}'`
      );
    }

    // Location / Hostel consistency (if location provided)
    if (input.locationId) {
      const location = await this.db.location.findUnique({ where: { id: input.locationId } });
      if (!location) {
        throw new NotFoundError('Location', input.locationId);
      }
      if (location.hostelId !== input.hostelId) {
        throw new DomainIntegrityError(
          `Location '${location.id}' belongs to hostel '${location.hostelId}', not session hostel '${input.hostelId}'`
        );
      }
    }

    // Staff authorization boundary
    const staffUser = await this.db.user.findUnique({ where: { id: input.createdByUserId } });
    if (!staffUser) {
      throw new NotFoundError('User', input.createdByUserId);
    }
    assertUserCanOperateInHostel(staffUser, input.organizationId, input.hostelId);

    return this.db.$transaction(async (tx) => {
      const session = await tx.attendanceSession.create({
        data: {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          locationId: input.locationId || null,
          sessionType: input.sessionType,
          title: input.title.trim(),
          status: AttendanceSessionStatus.DRAFT,
          startTime: input.startTime || nowUtc(),
          createdByUserId: input.createdByUserId,
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          entityType: 'ATTENDANCE_SESSION',
          entityId: session.id,
          action: 'CREATE',
          performedByUserId: input.createdByUserId,
          performedByRole: input.createdByRole,
          newValues: {
            title: session.title,
            sessionType: session.sessionType,
            status: session.status,
          },
        },
        tx
      );

      return session;
    });
  }

  public async startSession(
    sessionId: string,
    startedByUserId: string,
    startedByRole: StaffRole
  ): Promise<AttendanceSession> {
    assertPermission(startedByRole, 'ATTENDANCE_SESSION_START');

    const session = await this.db.attendanceSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundError('AttendanceSession', sessionId);
    }
    if (session.status !== AttendanceSessionStatus.DRAFT) {
      throw new InvalidStateTransitionError(
        session.status,
        AttendanceSessionStatus.ACTIVE,
        'Only DRAFT sessions can be started'
      );
    }

    const staffUser = await this.db.user.findUnique({ where: { id: startedByUserId } });
    if (!staffUser) {
      throw new NotFoundError('User', startedByUserId);
    }
    assertUserCanOperateInHostel(staffUser, session.organizationId, session.hostelId);

    return this.db.$transaction(async (tx) => {
      const updated = await tx.attendanceSession.update({
        where: { id: sessionId },
        data: {
          status: AttendanceSessionStatus.ACTIVE,
          startedByUserId,
        },
      });

      await this.auditService.record(
        {
          organizationId: session.organizationId,
          hostelId: session.hostelId,
          entityType: 'ATTENDANCE_SESSION',
          entityId: session.id,
          action: 'SESSION_START',
          performedByUserId: startedByUserId,
          performedByRole: startedByRole,
          oldValues: { status: session.status },
          newValues: { status: AttendanceSessionStatus.ACTIVE },
        },
        tx
      );

      return updated;
    });
  }

  public async closeSession(
    sessionId: string,
    closedByUserId: string,
    closedByRole: StaffRole
  ): Promise<AttendanceSession> {
    assertPermission(closedByRole, 'ATTENDANCE_SESSION_CLOSE');

    const session = await this.db.attendanceSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundError('AttendanceSession', sessionId);
    }
    if (session.status !== AttendanceSessionStatus.ACTIVE) {
      throw new InvalidStateTransitionError(
        session.status,
        AttendanceSessionStatus.CLOSED,
        'Only ACTIVE sessions can be closed'
      );
    }

    const staffUser = await this.db.user.findUnique({ where: { id: closedByUserId } });
    if (!staffUser) {
      throw new NotFoundError('User', closedByUserId);
    }
    assertUserCanOperateInHostel(staffUser, session.organizationId, session.hostelId);

    return this.db.$transaction(async (tx) => {
      const updated = await tx.attendanceSession.update({
        where: { id: sessionId },
        data: {
          status: AttendanceSessionStatus.CLOSED,
          endTime: nowUtc(),
          closedByUserId,
        },
      });

      await this.auditService.record(
        {
          organizationId: session.organizationId,
          hostelId: session.hostelId,
          entityType: 'ATTENDANCE_SESSION',
          entityId: session.id,
          action: 'SESSION_CLOSE',
          performedByUserId: closedByUserId,
          performedByRole: closedByRole,
          oldValues: { status: session.status },
          newValues: { status: AttendanceSessionStatus.CLOSED, endTime: updated.endTime },
        },
        tx
      );

      return updated;
    });
  }

  /**
   * Marks a resident's attendance in a session.
   * Enforces that session is ACTIVE.
   * Enforces cross-hostel & cross-org consistency between resident and session.
   * Enforces UNIQUE attendance record per resident per session (duplicate rejected).
   */
  public async markAttendance(
    input: MarkAttendanceInput,
    externalTx?: Prisma.TransactionClient
  ): Promise<AttendanceRecord> {
    const executeOperation = async (tx: Prisma.TransactionClient) => {
      const session = await tx.attendanceSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session) {
        throw new NotFoundError('AttendanceSession', input.sessionId);
      }
      if (session.status !== AttendanceSessionStatus.ACTIVE) {
        throw new InvalidStateTransitionError(
          session.status,
          'RECORD_ATTENDANCE',
          'Cannot mark attendance in a non-active session'
        );
      }

      const resident = await tx.resident.findUnique({
        where: { id: input.residentId },
      });
      if (!resident) {
        throw new NotFoundError('Resident', input.residentId);
      }

      // Cross-hostel integrity: resident must belong to the session hostel
      if (resident.hostelId !== session.hostelId) {
        throw new DomainIntegrityError(
          `Resident '${resident.residentCode}' belongs to hostel '${resident.hostelId}', cannot be marked in session for hostel '${session.hostelId}'`
        );
      }

      // Cross-organization integrity: resident must belong to the session organization
      if (resident.organizationId !== session.organizationId) {
        throw new DomainIntegrityError(
          `Resident '${resident.residentCode}' belongs to organization '${resident.organizationId}', cannot be marked in session for organization '${session.organizationId}'`
        );
      }

      // Staff authorization boundary
      if (input.markedByUserId) {
        const staffUser = await tx.user.findUnique({ where: { id: input.markedByUserId } });
        if (!staffUser) {
          throw new NotFoundError('User', input.markedByUserId);
        }
        assertUserCanOperateInHostel(staffUser, session.organizationId, session.hostelId);
      }

      // Check duplicate record
      const existing = await tx.attendanceRecord.findUnique({
        where: {
          attendanceSessionId_residentId: {
            attendanceSessionId: input.sessionId,
            residentId: input.residentId,
          },
        },
      });
      if (existing) {
        throw new ConflictError(
          `Attendance record already exists for resident '${resident.residentCode}' in session '${session.title}'`
        );
      }

      const record = await tx.attendanceRecord.create({
        data: {
          attendanceSessionId: input.sessionId,
          residentId: input.residentId,
          status: input.status,
          markMethod: input.markMethod,
          markedByUserId: input.markedByUserId || null,
          recognitionReference: input.recognitionReference || null,
          notes: input.notes || null,
        },
      });

      await this.auditService.record(
        {
          organizationId: session.organizationId,
          hostelId: session.hostelId,
          entityType: 'ATTENDANCE_RECORD',
          entityId: record.id,
          action: 'ATTENDANCE_MARK',
          performedByUserId: input.markedByUserId || null,
          performedByRole: input.markedByRole || null,
          newValues: {
            sessionId: input.sessionId,
            residentId: input.residentId,
            status: record.status,
            markMethod: record.markMethod,
          },
        },
        tx
      );

      return record;
    };

    if (externalTx) {
      return executeOperation(externalTx);
    }
    return this.db.$transaction(executeOperation);
  }

  public async getSessionWithRecords(sessionId: string) {
    const session = await this.db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        records: {
          include: {
            resident: true,
            markedBy: { select: { id: true, username: true, fullName: true, role: true } },
          },
        },
        createdBy: { select: { id: true, username: true, fullName: true, role: true } },
      },
    });
    if (!session) {
      throw new NotFoundError('AttendanceSession', sessionId);
    }
    return session;
  }
}
