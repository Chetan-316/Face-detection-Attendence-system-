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
  InvalidStateTransitionError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../../common/errors';
import { assertPermission } from '../auth/permissions';
import { MovementService } from '../movements/movement.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditService } from '../audit/audit.service';
import { nowUtc } from '../../common/utils/timezone';

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
   * CRITICAL RULE: If the resident's Current Presence State is OUT:
   * Automatic PRESENT is BLOCKED with an AttendanceRuleViolationError!
   * Guard cannot override this. Only Warden can perform Missed IN correction.
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
   * 1. Warden verifies resident physically present despite OUT state.
   * 2. Warden provides mandatory return time and reason.
   * 3. Executes Warden Missed IN correction -> updates Presence to IN, preserves old history.
   * 4. Marks resident as CORRECTED_PRESENT in the active Night Attendance session.
   */
  public async resolveMissedInAndMarkPresent(input: ResolveMissedInAndMarkPresentInput) {
    // Only Warden or Admin authorized
    if (input.wardenRole === StaffRole.GUARD) {
      throw new PermissionDeniedError('NIGHT_ATTENDANCE_CORRECTION', StaffRole.GUARD);
    }
    assertPermission(input.wardenRole, 'NIGHT_ATTENDANCE_REVIEW_INCONSISTENCY');

    if (!input.correctionReason || input.correctionReason.trim().length === 0) {
      throw new ValidationError('Correction reason is mandatory to resolve missed IN night attendance');
    }

    const session = await this.db.attendanceSession.findUnique({
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

    // 1. Execute Warden Missed IN correction (sets presence to IN, stores immutable event)
    const movementEvent = await this.movementService.executeWardenCorrection({
      residentId: input.residentId,
      targetState: PresenceState.IN,
      hostelId: session.hostelId,
      effectiveTimestamp: input.effectiveReturnTime,
      reason: input.correctionReason.trim(),
      authorizedByUserId: input.wardenUserId,
      authorizedByRole: input.wardenRole,
      notes: `Resolved during Night Attendance session: ${session.title}`,
    });

    // 2. Mark attendance record as CORRECTED_PRESENT
    const attendanceRecord = await this.db.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.create({
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

      await this.auditService.record(
        {
          organizationId: session.organizationId,
          hostelId: session.hostelId,
          entityType: 'ATTENDANCE_RECORD',
          entityId: record.id,
          action: 'ATTENDANCE_OVERRIDE',
          performedByUserId: input.wardenUserId,
          performedByRole: input.wardenRole,
          reason: input.correctionReason.trim(),
          newValues: {
            sessionId: input.sessionId,
            residentId: input.residentId,
            status: record.status,
            movementEventId: movementEvent.id,
          },
        },
        tx
      );

      return record;
    });

    return {
      movementEvent,
      attendanceRecord,
    };
  }
}
