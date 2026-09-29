import {
  PrismaClient,
  MovementType,
  MovementSource,
  PresenceState,
  StaffRole,
  MovementEvent,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import {
  InvalidStateTransitionError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../../common/errors';
import { assertPermission } from '../auth/permissions';
import { AuditService } from '../audit/audit.service';
import { nowUtc } from '../../common/utils/timezone';

export interface RecordMovementInput {
  residentId: string;
  movementType: MovementType;
  hostelId: string;
  locationId?: string | null;
  cameraId?: string | null;
  source: MovementSource;
  performedByUserId?: string | null;
  performedByRole?: StaffRole | null;
  notes?: string | null;
  recognitionReference?: string | null;
  effectiveTimestamp?: Date;
}

export interface WardenCorrectionInput {
  residentId: string;
  targetState: PresenceState;
  hostelId: string;
  effectiveTimestamp: Date;
  reason: string;
  authorizedByUserId: string;
  authorizedByRole: StaffRole;
  locationId?: string | null;
  notes?: string | null;
}

export class MovementService {
  private auditService: AuditService;

  constructor(private readonly db: PrismaClient = defaultPrisma) {
    this.auditService = new AuditService(this.db);
  }

  /**
   * Records a normal movement (IN -> OUT or OUT -> IN).
   * Atomically executes with row-level locking (SELECT ... FOR UPDATE) to prevent race conditions.
   * Rejects invalid normal transitions (IN -> IN, OUT -> OUT).
   */
  public async recordNormalMovement(input: RecordMovementInput): Promise<MovementEvent> {
    // Role check if staff user is performing action
    if (input.performedByRole) {
      assertPermission(input.performedByRole, 'MOVEMENT_NORMAL_RECORD');
    }

    const effectiveTime = input.effectiveTimestamp || nowUtc();

    return this.db.$transaction(async (tx) => {
      // 1. Lock resident presence row with FOR UPDATE to prevent concurrent conflicting operations
      const lockedPresence = await tx.$queryRaw<Array<{ currentState: PresenceState; hostelId: string }>>`
        SELECT "currentState", "hostelId" 
        FROM "resident_presences" 
        WHERE "residentId" = ${input.residentId} 
        FOR UPDATE
      `;

      if (!lockedPresence || lockedPresence.length === 0) {
        throw new NotFoundError('ResidentPresence', input.residentId);
      }

      const currentState = lockedPresence[0].currentState;

      // 2. Validate normal alternating state rules
      if (currentState === PresenceState.IN && input.movementType === MovementType.IN) {
        throw new InvalidStateTransitionError(
          'IN',
          'IN',
          'Resident is already recorded as IN. Cannot record normal IN without prior OUT.'
        );
      }

      if (currentState === PresenceState.OUT && input.movementType === MovementType.OUT) {
        throw new InvalidStateTransitionError(
          'OUT',
          'OUT',
          'Resident is already recorded as OUT. Cannot record normal OUT without prior IN.'
        );
      }

      const newPresenceState =
        input.movementType === MovementType.IN ? PresenceState.IN : PresenceState.OUT;

      // 3. Create immutable MovementEvent
      const movementEvent = await tx.movementEvent.create({
        data: {
          residentId: input.residentId,
          hostelId: input.hostelId,
          locationId: input.locationId || null,
          cameraId: input.cameraId || null,
          movementType: input.movementType,
          source: input.source,
          effectiveTimestamp: effectiveTime,
          recordedTimestamp: nowUtc(),
          confirmedByUserId: input.performedByUserId || null,
          notes: input.notes || null,
          recognitionReference: input.recognitionReference || null,
          isCorrection: false,
        },
      });

      // 4. Update Current Presence State
      await tx.residentPresence.update({
        where: { residentId: input.residentId },
        data: {
          currentState: newPresenceState,
          lastMovementEventId: movementEvent.id,
          lastMovementType: input.movementType,
          lastMovementTime: effectiveTime,
          lastUpdatedByUserId: input.performedByUserId || null,
        },
      });

      // 5. Create Audit Trail
      await this.auditService.record(
        {
          organizationId: (
            await tx.hostel.findUniqueOrThrow({ where: { id: input.hostelId } })
          ).organizationId,
          hostelId: input.hostelId,
          entityType: 'MOVEMENT',
          entityId: movementEvent.id,
          action: 'NORMAL_MOVEMENT',
          performedByUserId: input.performedByUserId || null,
          performedByRole: input.performedByRole || null,
          newValues: {
            movementType: movementEvent.movementType,
            source: movementEvent.source,
            effectiveTimestamp: movementEvent.effectiveTimestamp,
            newPresenceState,
          },
        },
        tx
      );

      return movementEvent;
    });
  }

  /**
   * Performs a Warden or Admin correction for missed IN or missed OUT.
   * Guard is strictly forbidden from executing this.
   * Reason is mandatory and non-empty.
   * All past historical events remain untouched.
   * Creates a new MovementEvent, links to MovementCorrection, updates Presence, and logs audit.
   */
  public async executeWardenCorrection(input: WardenCorrectionInput): Promise<MovementEvent> {
    // 1. Role permission enforcement
    if (input.authorizedByRole === StaffRole.GUARD) {
      throw new PermissionDeniedError('MOVEMENT_CORRECTION', StaffRole.GUARD);
    }

    const actionKey =
      input.targetState === PresenceState.IN
        ? 'MOVEMENT_CORRECTION_MISSED_IN'
        : 'MOVEMENT_CORRECTION_MISSED_OUT';

    assertPermission(input.authorizedByRole, actionKey);

    // 2. Mandatory reason validation
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError('Correction reason is mandatory for Warden corrections');
    }

    const movementType =
      input.targetState === PresenceState.IN ? MovementType.IN : MovementType.OUT;

    return this.db.$transaction(async (tx) => {
      // Lock current presence row
      const lockedPresence = await tx.$queryRaw<Array<{ currentState: PresenceState; hostelId: string }>>`
        SELECT "currentState", "hostelId" 
        FROM "resident_presences" 
        WHERE "residentId" = ${input.residentId} 
        FOR UPDATE
      `;

      if (!lockedPresence || lockedPresence.length === 0) {
        throw new NotFoundError('ResidentPresence', input.residentId);
      }

      const oldState = lockedPresence[0].currentState;

      // 3. Create MovementCorrection record
      const correction = await tx.movementCorrection.create({
        data: {
          residentId: input.residentId,
          hostelId: input.hostelId,
          oldState,
          newState: input.targetState,
          effectiveTimestamp: input.effectiveTimestamp,
          authorizedByUserId: input.authorizedByUserId,
          reason: input.reason.trim(),
        },
      });

      // 4. Create new MovementEvent preserving history
      const movementEvent = await tx.movementEvent.create({
        data: {
          residentId: input.residentId,
          hostelId: input.hostelId,
          locationId: input.locationId || null,
          movementType,
          source: MovementSource.WARDEN_CORRECTION,
          effectiveTimestamp: input.effectiveTimestamp,
          recordedTimestamp: nowUtc(),
          confirmedByUserId: input.authorizedByUserId,
          notes: input.notes || `Correction: ${input.reason.trim()}`,
          isCorrection: true,
          correctionId: correction.id,
        },
      });

      // 5. Update Current Presence
      await tx.residentPresence.update({
        where: { residentId: input.residentId },
        data: {
          currentState: input.targetState,
          lastMovementEventId: movementEvent.id,
          lastMovementType: movementType,
          lastMovementTime: input.effectiveTimestamp,
          lastUpdatedByUserId: input.authorizedByUserId,
        },
      });

      // 6. Record Audit Log
      const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: input.hostelId } });
      await this.auditService.record(
        {
          organizationId: hostel.organizationId,
          hostelId: input.hostelId,
          entityType: 'CORRECTION',
          entityId: correction.id,
          action: 'CORRECTION',
          performedByUserId: input.authorizedByUserId,
          performedByRole: input.authorizedByRole,
          reason: input.reason.trim(),
          oldValues: { currentState: oldState },
          newValues: {
            currentState: input.targetState,
            movementEventId: movementEvent.id,
            effectiveTimestamp: input.effectiveTimestamp,
          },
        },
        tx
      );

      return movementEvent;
    });
  }

  /**
   * Retrieves complete, immutable movement history for a resident
   */
  public async getResidentMovementHistory(residentId: string) {
    return this.db.movementEvent.findMany({
      where: { residentId },
      orderBy: { effectiveTimestamp: 'desc' },
      include: {
        location: true,
        camera: true,
        confirmedBy: {
          select: { id: true, username: true, fullName: true, role: true },
        },
        correction: true,
      },
    });
  }
}
