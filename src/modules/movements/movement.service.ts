import {
  Prisma,
  PrismaClient,
  MovementType,
  MovementSource,
  PresenceState,
  StaffRole,
  MovementEvent,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import {
  DomainIntegrityError,
  InvalidStateTransitionError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../../common/errors';
import { assertPermission, assertUserCanOperateInHostel } from '../auth/permissions';
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
   * Enforces cross-hostel, location, camera, and staff boundaries.
   * Atomically executes with row-level locking (SELECT ... FOR UPDATE).
   */
  public async recordNormalMovement(
    input: RecordMovementInput,
    externalTx?: Prisma.TransactionClient
  ): Promise<MovementEvent> {
    if (input.performedByRole) {
      assertPermission(input.performedByRole, 'MOVEMENT_NORMAL_RECORD');
    }

    const effectiveTime = input.effectiveTimestamp || nowUtc();

    const executeOperation = async (tx: Prisma.TransactionClient) => {
      // 1. Lock resident presence row with FOR UPDATE
      const lockedPresence = await tx.$queryRaw<Array<{ currentState: PresenceState; hostelId: string }>>`
        SELECT "currentState", "hostelId" 
        FROM "resident_presences" 
        WHERE "residentId" = ${input.residentId} 
        FOR UPDATE
      `;

      if (!lockedPresence || lockedPresence.length === 0) {
        throw new NotFoundError('ResidentPresence', input.residentId);
      }

      const currentPresence = lockedPresence[0];

      // 2. Cross-Hostel Movement Integrity
      if (currentPresence.hostelId !== input.hostelId) {
        throw new DomainIntegrityError(
          `Resident belongs to hostel '${currentPresence.hostelId}', but movement was requested for hostel '${input.hostelId}'`
        );
      }

      // 3. Location Integrity (if provided)
      if (input.locationId) {
        const location = await tx.location.findUnique({ where: { id: input.locationId } });
        if (!location) {
          throw new NotFoundError('Location', input.locationId);
        }
        if (location.hostelId !== input.hostelId) {
          throw new DomainIntegrityError(
            `Location '${location.id}' belongs to hostel '${location.hostelId}', not movement hostel '${input.hostelId}'`
          );
        }
      }

      // 4. Camera Integrity (if provided)
      if (input.cameraId) {
        const camera = await tx.camera.findUnique({ where: { id: input.cameraId } });
        if (!camera) {
          throw new NotFoundError('Camera', input.cameraId);
        }
        if (!camera.isEnabled) {
          throw new ValidationError(`Camera '${camera.name}' (${camera.id}) is disabled`);
        }
        if (camera.hostelId !== input.hostelId) {
          throw new DomainIntegrityError(
            `Camera '${camera.id}' belongs to hostel '${camera.hostelId}', not movement hostel '${input.hostelId}'`
          );
        }
        if (camera.locationId && input.locationId && camera.locationId !== input.locationId) {
          throw new DomainIntegrityError(
            `Camera location '${camera.locationId}' conflicts with supplied movement location '${input.locationId}'`
          );
        }
      }

      // 5. Staff Boundary Check
      if (input.performedByUserId) {
        const staffUser = await tx.user.findUnique({ where: { id: input.performedByUserId } });
        if (!staffUser) {
          throw new NotFoundError('User', input.performedByUserId);
        }
        const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: input.hostelId } });
        assertUserCanOperateInHostel(staffUser, hostel.organizationId, input.hostelId);
      }

      // 6. Validate normal alternating state rules
      const currentState = currentPresence.currentState;
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

      // 7. Create immutable MovementEvent
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

      // 8. Update Current Presence State
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

      // 9. Create Audit Trail
      const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: input.hostelId } });
      await this.auditService.record(
        {
          organizationId: hostel.organizationId,
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
    };

    if (externalTx) {
      return executeOperation(externalTx);
    }
    return this.db.$transaction(executeOperation);
  }

  /**
   * Performs a Warden or Admin correction for missed IN or missed OUT.
   * Enforces:
   * - Mandatory reason
   * - Valid and non-future effective timestamp
   * - Rejection of same-state correction (IN -> IN, OUT -> OUT)
   * - Cross-hostel resident/hostel match
   * - Location/hostel match
   * - Staff authorization boundary
   */
  public async executeWardenCorrection(
    input: WardenCorrectionInput,
    externalTx?: Prisma.TransactionClient
  ): Promise<MovementEvent> {
    if (input.authorizedByRole === StaffRole.GUARD) {
      throw new PermissionDeniedError('MOVEMENT_CORRECTION', StaffRole.GUARD);
    }

    const actionKey =
      input.targetState === PresenceState.IN
        ? 'MOVEMENT_CORRECTION_MISSED_IN'
        : 'MOVEMENT_CORRECTION_MISSED_OUT';

    assertPermission(input.authorizedByRole, actionKey);

    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError('Correction reason is mandatory for Warden corrections');
    }

    // Effective timestamp validation
    if (!(input.effectiveTimestamp instanceof Date) || isNaN(input.effectiveTimestamp.getTime())) {
      throw new ValidationError('A valid Date must be provided for effectiveTimestamp');
    }
    const maxFutureToleranceMs = 5 * 60 * 1000; // 5 min clock skew tolerance
    if (input.effectiveTimestamp.getTime() > Date.now() + maxFutureToleranceMs) {
      throw new ValidationError('Effective timestamp cannot be later than current system time beyond clock tolerance');
    }

    const movementType =
      input.targetState === PresenceState.IN ? MovementType.IN : MovementType.OUT;

    const executeOperation = async (tx: Prisma.TransactionClient) => {
      // 1. Lock current presence row
      const lockedPresence = await tx.$queryRaw<Array<{ currentState: PresenceState; hostelId: string }>>`
        SELECT "currentState", "hostelId" 
        FROM "resident_presences" 
        WHERE "residentId" = ${input.residentId} 
        FOR UPDATE
      `;

      if (!lockedPresence || lockedPresence.length === 0) {
        throw new NotFoundError('ResidentPresence', input.residentId);
      }

      const currentPresence = lockedPresence[0];
      const oldState = currentPresence.currentState;

      // 2. Cross-hostel validation
      if (currentPresence.hostelId !== input.hostelId) {
        throw new DomainIntegrityError(
          `Resident belongs to hostel '${currentPresence.hostelId}', but correction requested for hostel '${input.hostelId}'`
        );
      }

      // 3. Same-state correction rule: A correction must actually change state
      if (oldState === input.targetState) {
        throw new InvalidStateTransitionError(
          oldState,
          input.targetState,
          `Cannot execute correction to the same state (already ${oldState})`
        );
      }

      // 4. Location validation (if provided)
      if (input.locationId) {
        const location = await tx.location.findUnique({ where: { id: input.locationId } });
        if (!location) {
          throw new NotFoundError('Location', input.locationId);
        }
        if (location.hostelId !== input.hostelId) {
          throw new DomainIntegrityError(
            `Location '${location.id}' belongs to hostel '${location.hostelId}', not correction hostel '${input.hostelId}'`
          );
        }
      }

      // 5. Staff Hostel Boundary Validation
      const authorizer = await tx.user.findUnique({ where: { id: input.authorizedByUserId } });
      if (!authorizer) {
        throw new NotFoundError('User', input.authorizedByUserId);
      }
      const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: input.hostelId } });
      assertUserCanOperateInHostel(authorizer, hostel.organizationId, input.hostelId);

      // 6. Create MovementCorrection record
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

      // 7. Create new MovementEvent preserving history
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

      // 8. Update Current Presence
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

      // 9. Record Audit Log
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
    };

    if (externalTx) {
      return executeOperation(externalTx);
    }
    return this.db.$transaction(executeOperation);
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
