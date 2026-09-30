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
  ResidentStatus,
  CameraRole,
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
  cameraId?: string | null;
  sessionType: AttendanceSessionType;
  title: string;
  attendanceDate?: Date;
  startTime?: Date;
  endTime?: Date | null;
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

export interface CorrectAttendanceInput {
  sessionId: string;
  residentId: string;
  status: AttendanceRecordStatus;
  reason: string;
  performedByUserId: string;
  performedByRole: StaffRole;
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

    // Camera / Hostel consistency and role verification (if camera provided)
    if (input.cameraId) {
      const camera = await this.db.camera.findUnique({ where: { id: input.cameraId } });
      if (!camera) {
        throw new NotFoundError('Camera', input.cameraId);
      }
      if (camera.hostelId !== input.hostelId || camera.organizationId !== input.organizationId) {
        throw new DomainIntegrityError(
          `Camera '${camera.name}' belongs to hostel '${camera.hostelId}', not session hostel '${input.hostelId}'`
        );
      }
      if (camera.role !== CameraRole.ATTENDANCE) {
        throw new ValidationError(`Camera '${camera.name}' has role '${camera.role}', must be ATTENDANCE`);
      }
    }

    // Staff authorization boundary
    const staffUser = await this.db.user.findUnique({ where: { id: input.createdByUserId } });
    if (!staffUser) {
      throw new NotFoundError('User', input.createdByUserId);
    }
    assertUserCanOperateInHostel(staffUser, input.organizationId, input.hostelId);

    // Normalize logical attendance date (midnight-safe)
    const effectiveStartTime = input.startTime || nowUtc();
    const logicalDate = input.attendanceDate || new Date(new Date(effectiveStartTime).setUTCHours(0, 0, 0, 0));

    return this.db.$transaction(async (tx) => {
      const session = await tx.attendanceSession.create({
        data: {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          locationId: input.locationId || null,
          cameraId: input.cameraId || null,
          sessionType: input.sessionType,
          title: input.title.trim(),
          attendanceDate: logicalDate,
          status: AttendanceSessionStatus.DRAFT,
          startTime: effectiveStartTime,
          endTime: input.endTime || null,
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
            cameraId: session.cameraId,
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

    // Rule 58: Prevent ambiguous multiple active sessions of the same type for this hostel
    const existingActive = await this.db.attendanceSession.findFirst({
      where: {
        hostelId: session.hostelId,
        sessionType: session.sessionType,
        status: AttendanceSessionStatus.ACTIVE,
        id: { not: sessionId },
      },
    });
    if (existingActive) {
      throw new ConflictError(
        `An active ${session.sessionType} attendance session ('${existingActive.title}') already exists for this hostel`
      );
    }

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

  /**
   * Closes an attendance session.
   * Requirements 23, 24, 25:
   * 1. Server-side auto absent marking: all eligible ACTIVE residents not marked present become ABSENT.
   * 2. Idempotent: closing an already closed session returns the session state without duplicate rows.
   * 3. Atomic transaction: updates session status and creates ABSENT rows safely.
   */
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

    // Idempotency: closing an already closed session is safe and returns existing state
    if (session.status === AttendanceSessionStatus.CLOSED) {
      return session;
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

    const closeTimestamp = nowUtc();

    return this.db.$transaction(async (tx) => {
      // 1. Update session status to CLOSED
      const updated = await tx.attendanceSession.update({
        where: { id: sessionId },
        data: {
          status: AttendanceSessionStatus.CLOSED,
          endTime: closeTimestamp,
          closedByUserId,
        },
      });

      // 2. Query all ACTIVE residents in this hostel (regardless of face enrollment)
      const eligibleResidents = await tx.resident.findMany({
        where: {
          hostelId: session.hostelId,
          organizationId: session.organizationId,
          status: ResidentStatus.ACTIVE,
        },
        select: { id: true, residentCode: true },
      });

      // 3. Query existing attendance records for this session
      const existingRecords = await tx.attendanceRecord.findMany({
        where: { attendanceSessionId: sessionId },
        select: { residentId: true, status: true },
      });

      const markedResidentIds = new Set(existingRecords.map((r) => r.residentId));

      // 4. Any expected active resident who does not have an attendance record becomes ABSENT
      const unmarkedResidents = eligibleResidents.filter((r) => !markedResidentIds.has(r.id));

      if (unmarkedResidents.length > 0) {
        await tx.attendanceRecord.createMany({
          data: unmarkedResidents.map((r) => ({
            attendanceSessionId: sessionId,
            residentId: r.id,
            status: AttendanceRecordStatus.ABSENT,
            markMethod: AttendanceMarkMethod.SYSTEM,
            notes: 'Automatically marked absent upon session close',
            createdAt: closeTimestamp,
          })),
          skipDuplicates: true,
        });
      }

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
          newValues: {
            status: AttendanceSessionStatus.CLOSED,
            endTime: updated.endTime,
            absentCount: unmarkedResidents.length,
          },
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

  /**
   * Manual attendance correction by Admin or Warden.
   * Guard is forbidden (403).
   * Reason is mandatory.
   * Completely audited.
   * Movement isolation: does NOT change ResidentPresence or MovementEvents.
   */
  public async correctAttendanceRecord(input: CorrectAttendanceInput): Promise<AttendanceRecord> {
    assertPermission(input.performedByRole, 'ATTENDANCE_CORRECTION');

    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError('Correction reason is mandatory');
    }

    const session = await this.db.attendanceSession.findUnique({
      where: { id: input.sessionId },
    });
    if (!session) {
      throw new NotFoundError('AttendanceSession', input.sessionId);
    }

    // Staff user authorization check
    const staffUser = await this.db.user.findUnique({
      where: { id: input.performedByUserId },
    });
    if (!staffUser) {
      throw new NotFoundError('User', input.performedByUserId);
    }
    assertUserCanOperateInHostel(staffUser, session.organizationId, session.hostelId);

    const resident = await this.db.resident.findUnique({
      where: { id: input.residentId },
    });
    if (!resident) {
      throw new NotFoundError('Resident', input.residentId);
    }
    if (resident.hostelId !== session.hostelId) {
      throw new DomainIntegrityError(
        `Resident '${resident.residentCode}' belongs to hostel '${resident.hostelId}', not session hostel '${session.hostelId}'`
      );
    }

    return this.db.$transaction(async (tx) => {
      const existingRecord = await tx.attendanceRecord.findUnique({
        where: {
          attendanceSessionId_residentId: {
            attendanceSessionId: input.sessionId,
            residentId: input.residentId,
          },
        },
      });

      const oldStatus = existingRecord?.status || 'NOT_RECORDED';

      let record: AttendanceRecord;
      if (existingRecord) {
        record = await tx.attendanceRecord.update({
          where: { id: existingRecord.id },
          data: {
            status: input.status,
            markMethod: AttendanceMarkMethod.WARDEN_OVERRIDE,
            correctionReason: input.reason.trim(),
            correctedByUserId: input.performedByUserId,
          },
        });
      } else {
        record = await tx.attendanceRecord.create({
          data: {
            attendanceSessionId: input.sessionId,
            residentId: input.residentId,
            status: input.status,
            markMethod: AttendanceMarkMethod.WARDEN_OVERRIDE,
            correctionReason: input.reason.trim(),
            correctedByUserId: input.performedByUserId,
          },
        });
      }

      await this.auditService.record(
        {
          organizationId: session.organizationId,
          hostelId: session.hostelId,
          entityType: 'ATTENDANCE_RECORD',
          entityId: record.id,
          action: 'ATTENDANCE_OVERRIDE',
          performedByUserId: input.performedByUserId,
          performedByRole: input.performedByRole,
          reason: input.reason.trim(),
          oldValues: { status: oldStatus },
          newValues: { status: record.status },
        },
        tx
      );

      return record;
    });
  }

  /**
   * Retrieves full attendance roster and progress counts for a session.
   * Real database counts for expected, present, absent, remaining.
   * Includes active residents who do not have face enrollment.
   */
  public async getAttendanceRoster(sessionId: string) {
    const session = await this.db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        hostel: { select: { id: true, code: true, name: true } },
        camera: { select: { id: true, name: true, role: true } },
        createdBy: { select: { id: true, username: true, fullName: true, role: true } },
        startedBy: { select: { id: true, username: true, fullName: true, role: true } },
        closedBy: { select: { id: true, username: true, fullName: true, role: true } },
      },
    });
    if (!session) {
      throw new NotFoundError('AttendanceSession', sessionId);
    }

    // Active residents in this hostel (Requirements 10 & 11)
    const residents = await this.db.resident.findMany({
      where: {
        hostelId: session.hostelId,
        organizationId: session.organizationId,
        status: ResidentStatus.ACTIVE,
      },
      orderBy: [{ roomGroup: 'asc' }, { residentCode: 'asc' }],
    });

    // Attendance records for this session
    const records = await this.db.attendanceRecord.findMany({
      where: { attendanceSessionId: sessionId },
      include: {
        markedBy: { select: { id: true, username: true, fullName: true, role: true } },
        correctedBy: { select: { id: true, username: true, fullName: true, role: true } },
      },
    });

    const recordMap = new Map(records.map((r) => [r.residentId, r]));

    let presentCount = 0;
    let absentCount = 0;
    let notRecordedCount = 0;

    const roster = residents.map((resident) => {
      const record = recordMap.get(resident.id);
      let status: AttendanceRecordStatus | 'NOT_RECORDED';
      let markedAt: Date | null = null;
      let markMethod: AttendanceMarkMethod | null = null;
      let recordId: string | null = null;
      let correctionReason: string | null = null;

      if (record) {
        status = record.status;
        markedAt = record.createdAt;
        markMethod = record.markMethod;
        recordId = record.id;
        correctionReason = record.correctionReason;
        if (
          status === AttendanceRecordStatus.PRESENT ||
          status === AttendanceRecordStatus.CORRECTED_PRESENT
        ) {
          presentCount++;
        } else if (status === AttendanceRecordStatus.ABSENT) {
          absentCount++;
        }
      } else {
        status = 'NOT_RECORDED';
        notRecordedCount++;
      }

      return {
        residentId: resident.id,
        residentCode: resident.residentCode,
        fullName: resident.fullName,
        roomGroup: resident.roomGroup,
        faceEnrollmentStatus: resident.faceEnrollmentStatus,
        status,
        markedAt,
        markMethod,
        recordId,
        correctionReason,
        notes: record?.notes || null,
      };
    });

    const expectedResidents = residents.length;
    const remainingCount = Math.max(0, expectedResidents - presentCount);

    return {
      session,
      stats: {
        expectedResidents,
        presentCount,
        absentCount,
        notRecordedCount,
        remainingCount,
      },
      roster,
    };
  }

  /**
   * Lists sessions filtered by hostel, status, date.
   */
  public async listSessions(params: {
    hostelId?: string;
    organizationId?: string;
    sessionType?: AttendanceSessionType;
    status?: AttendanceSessionStatus;
    date?: string;
    user: any;
  }) {
    const where: Prisma.AttendanceSessionWhereInput = {};

    if (params.hostelId) {
      where.hostelId = params.hostelId;
    }
    if (params.organizationId) {
      where.organizationId = params.organizationId;
    }
    if (params.sessionType) {
      where.sessionType = params.sessionType;
    }
    if (params.status) {
      where.status = params.status;
    }
    if (params.date) {
      const startOfDay = new Date(`${params.date}T00:00:00.000Z`);
      const endOfDay = new Date(`${params.date}T23:59:59.999Z`);
      where.attendanceDate = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    // Role scoping: non-admin users only see sessions in their assigned hostel
    if (params.user.role !== StaffRole.ADMIN && params.user.hostelId) {
      where.hostelId = params.user.hostelId;
    }

    const sessions = await this.db.attendanceSession.findMany({
      where,
      include: {
        camera: { select: { id: true, name: true, role: true } },
        hostel: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, username: true, fullName: true, role: true } },
        startedBy: { select: { id: true, username: true, fullName: true, role: true } },
        closedBy: { select: { id: true, username: true, fullName: true, role: true } },
        records: { select: { id: true, status: true } },
      },
      orderBy: { startTime: 'desc' },
    });

    return sessions.map((s) => {
      const presentCount = s.records.filter(
        (r) =>
          r.status === AttendanceRecordStatus.PRESENT ||
          r.status === AttendanceRecordStatus.CORRECTED_PRESENT
      ).length;
      const absentCount = s.records.filter((r) => r.status === AttendanceRecordStatus.ABSENT).length;
      return {
        ...s,
        presentCount,
        absentCount,
        recordCount: s.records.length,
        records: undefined,
      };
    });
  }

  public async getSessionWithRecords(sessionId: string) {
    const session = await this.db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        camera: { select: { id: true, name: true, role: true } },
        hostel: { select: { id: true, code: true, name: true } },
        records: {
          include: {
            resident: true,
            markedBy: { select: { id: true, username: true, fullName: true, role: true } },
            correctedBy: { select: { id: true, username: true, fullName: true, role: true } },
          },
        },
        createdBy: { select: { id: true, username: true, fullName: true, role: true } },
        startedBy: { select: { id: true, username: true, fullName: true, role: true } },
        closedBy: { select: { id: true, username: true, fullName: true, role: true } },
      },
    });
    if (!session) {
      throw new NotFoundError('AttendanceSession', sessionId);
    }
    return session;
  }
}
