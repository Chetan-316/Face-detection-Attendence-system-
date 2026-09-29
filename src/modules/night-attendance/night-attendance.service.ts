import {
  PrismaClient,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
  StaffRole,
  PresenceState,
  AttendanceSessionType,
  AttendanceSessionStatus,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import {
  AttendanceRuleViolationError,
  ConflictError,
  DomainIntegrityError,
  InvalidStateTransitionError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../../common/errors';
import { assertPermission, assertUserCanOperateInHostel } from '../auth/permissions';
import { MovementService } from '../movements/movement.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditService } from '../audit/audit.service';

export interface MarkNightAttendanceInput {
  sessionId: string;
  residentId: string;
  markedByUserId: string;
  markedByRole: StaffRole;
  markMethod: AttendanceMarkMethod;
  notes?: string | null;
  recognitionReference?: string | null;
}

export interface ResolveMissedInAndMarkPresentInput {
  sessionId: string;
  residentId: string;
  effectiveReturnTime: Date;
  correctionReason: string;
  wardenUserId: string;
  wardenRole: StaffRole;
  notes?: string | null;
}

export class NightAttendanceService {
  private movementService: MovementService;
  private attendanceService: AttendanceService;
  private auditService: AuditService;

  constructor(private readonly db: PrismaClient = defaultPrisma) {
    this.movementService = new MovementService(this.db);
    this.attendanceService = new AttendanceService(this.db);
    this.auditService = new AuditService(this.db);
  }

  /**
   * Attempts to mark a resident as PRESENT in Night Attendance.
   * CRITICAL RULES:
   * 1. Resident must belong to the same hostel as the session.
   * 2. If Current Presence State is OUT: automatic PRESENT is BLOCKED with AttendanceRuleViolationError.
   */
  public async markNightAttendancePresent(input: MarkNightAttendanceInput) {
    const session = await this.db.attendanceSession.findUnique({
      where: { id: input.sessionId },
    });
    if (!session) {
      throw new NotFoundError('AttendanceSession', input.sessionId);
    }
    if (session.sessionType !== AttendanceSessionType.NIGHT) {
      throw new ValidationError('This workflow is only applicable to NIGHT attendance sessions');
    }
    if (session.status !== AttendanceSessionStatus.ACTIVE) {
      throw new InvalidStateTransitionError(
        session.status,
        'MARK_NIGHT_ATTENDANCE',
        'Night attendance session must be ACTIVE'
      );
    }

    const presence = await this.db.residentPresence.findUnique({
      where: { residentId: input.residentId },
      include: { resident: true },
    });
    if (!presence) {
      throw new NotFoundError('ResidentPresence', input.residentId);
    }

    // Cross-Hostel Safety Check
    if (presence.hostelId !== session.hostelId || presence.resident.hostelId !== session.hostelId) {
      throw new DomainIntegrityError(
        `Resident '${presence.resident.residentCode}' belongs to hostel '${presence.hostelId}', cannot be marked in night session for hostel '${session.hostelId}'`
      );
    }

    // Staff authorization boundary
    const staffUser = await this.db.user.findUnique({ where: { id: input.markedByUserId } });
    if (staffUser) {
      assertUserCanOperateInHostel(staffUser, session.organizationId, session.hostelId);
    }

    // CRITICAL ENFORCEMENT: Resident recorded as OUT cannot automatically be marked PRESENT
    if (presence.currentState === PresenceState.OUT) {
      throw new AttendanceRuleViolationError(
        `Resident '${presence.resident.residentCode}' (${presence.resident.fullName}) is currently recorded as OUT. ` +
        `Cannot automatically mark PRESENT in Night Attendance until movement inconsistency is verified and corrected by a Warden.`
      );
    }

    // If resident is IN, proceed with normal attendance marking
    return this.attendanceService.markAttendance({
      sessionId: input.sessionId,
      residentId: input.residentId,
      status: AttendanceRecordStatus.PRESENT,
      markMethod: input.markMethod,
      markedByUserId: input.markedByUserId,
      markedByRole: input.markedByRole,
      notes: input.notes,
      recognitionReference: input.recognitionReference,
    });
  }

  /**
   * Warden Resolution Workflow:
   * ATOMIC TRANSACTION:
   * 1. Validates session, resident, and cross-hostel consistency.
   * 2. Checks duplicate attendance BEFORE performing any state changes.
   * 3. Validates effective return time.
   * 4. Executes Warden Missed IN correction (inside tx).
   * 5. Marks resident as CORRECTED_PRESENT (inside tx).
   * 6. Audits both correction and attendance mark (inside tx).
   * If any step fails, the entire workflow rolls back!
   */
  public async resolveMissedInAndMarkPresent(input: ResolveMissedInAndMarkPresentInput) {
    if (input.wardenRole === StaffRole.GUARD) {
      throw new PermissionDeniedError('NIGHT_ATTENDANCE_CORRECTION', StaffRole.GUARD);
    }
    assertPermission(input.wardenRole, 'NIGHT_ATTENDANCE_REVIEW_INCONSISTENCY');

    if (!input.correctionReason || input.correctionReason.trim().length === 0) {
      throw new ValidationError('Correction reason is mandatory to resolve missed IN night attendance');
    }

    // Effective return time validation
    if (!(input.effectiveReturnTime instanceof Date) || isNaN(input.effectiveReturnTime.getTime())) {
      throw new ValidationError('A valid Date must be provided for effectiveReturnTime');
    }
    const maxFutureToleranceMs = 5 * 60 * 1000;
    if (input.effectiveReturnTime.getTime() > Date.now() + maxFutureToleranceMs) {
      throw new ValidationError('Effective return time cannot be in the future beyond allowed tolerance');
    }

    return this.db.$transaction(async (tx) => {
      // 1. Session verification
      const session = await tx.attendanceSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session) {
        throw new NotFoundError('AttendanceSession', input.sessionId);
      }
      if (session.status !== AttendanceSessionStatus.ACTIVE) {
        throw new InvalidStateTransitionError(
          session.status,
          'MARK_NIGHT_ATTENDANCE',
          'Night attendance session must be ACTIVE'
        );
      }

      // 2. Resident & Presence verification
      const resident = await tx.resident.findUnique({
        where: { id: input.residentId },
        include: { presence: true },
      });
      if (!resident) {
        throw new NotFoundError('Resident', input.residentId);
      }
      if (!resident.presence) {
        throw new NotFoundError('ResidentPresence', input.residentId);
      }

      // Cross-hostel safety
      if (resident.hostelId !== session.hostelId || resident.presence.hostelId !== session.hostelId) {
        throw new DomainIntegrityError(
          `Resident '${resident.residentCode}' belongs to hostel '${resident.hostelId}', cannot be resolved in session for hostel '${session.hostelId}'`
        );
      }

      // Staff authorization boundary
      const warden = await tx.user.findUnique({ where: { id: input.wardenUserId } });
      if (warden) {
        assertUserCanOperateInHostel(warden, session.organizationId, session.hostelId);
      }

      // 3. Pre-check: Duplicate Attendance Check BEFORE mutating state
      const existingRecord = await tx.attendanceRecord.findUnique({
        where: {
          attendanceSessionId_residentId: {
            attendanceSessionId: input.sessionId,
            residentId: input.residentId,
          },
        },
      });
      if (existingRecord) {
        throw new ConflictError(
          `Resident '${resident.residentCode}' already has an attendance record in session '${session.title}'`
        );
      }

      // 4. Execute Warden Missed IN correction INSIDE this atomic transaction
      const movementEvent = await this.movementService.executeWardenCorrection(
        {
          residentId: input.residentId,
          targetState: PresenceState.IN,
          hostelId: session.hostelId,
          effectiveTimestamp: input.effectiveReturnTime,
          reason: input.correctionReason.trim(),
          authorizedByUserId: input.wardenUserId,
          authorizedByRole: input.wardenRole,
          notes: `Resolved during Night Attendance session: ${session.title}`,
        },
        tx
      );

      // 5. Mark attendance record as CORRECTED_PRESENT INSIDE this atomic transaction
      const attendanceRecord = await tx.attendanceRecord.create({
        data: {
          attendanceSessionId: input.sessionId,
          residentId: input.residentId,
          status: AttendanceRecordStatus.CORRECTED_PRESENT,
          markMethod: AttendanceMarkMethod.WARDEN_OVERRIDE,
          markedByUserId: input.wardenUserId,
          correctionReason: input.correctionReason.trim(),
          correctedByUserId: input.wardenUserId,
          notes: input.notes || `Missed IN corrected by Warden. MovementEvent ID: ${movementEvent.id}`,
        },
      });

      // 6. Record Audit Log for attendance override
      await this.auditService.record(
        {
          organizationId: session.organizationId,
          hostelId: session.hostelId,
          entityType: 'ATTENDANCE_RECORD',
          entityId: attendanceRecord.id,
          action: 'ATTENDANCE_OVERRIDE',
          performedByUserId: input.wardenUserId,
          performedByRole: input.wardenRole,
          reason: input.correctionReason.trim(),
          newValues: {
            sessionId: input.sessionId,
            residentId: input.residentId,
            status: attendanceRecord.status,
            movementEventId: movementEvent.id,
          },
        },
        tx
      );

      return {
        movementEvent,
        attendanceRecord,
      };
    });
  }
}
