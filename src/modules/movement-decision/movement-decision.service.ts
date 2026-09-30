import {
  PrismaClient,
  CameraRole,
  MovementType,
  PresenceState,
  ResidentStatus,
  FaceEnrollmentStatus,
  MovementSource,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { MovementService } from '../movements/movement.service';
import { RecognitionObservation } from '../recognition/recognition.types';
import {
  MovementDecisionResult,
  MovementDecisionStatus,
} from './movement-decision.types';
import { config } from '../../config';

export interface MovementDecisionServiceOptions {
  globalAutomationEnabled?: boolean;
  minTransitionIntervalMs?: number;
}

export class MovementDecisionService {
  private globalAutomationEnabled: boolean;
  private minTransitionIntervalMs: number;
  private processedObservationIds: Map<string, MovementDecisionResult> = new Map();
  private maxCacheSize = 5000;

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    private readonly movementService: MovementService = new MovementService(db),
    options?: MovementDecisionServiceOptions
  ) {
    this.globalAutomationEnabled =
      options?.globalAutomationEnabled ?? config.movement.automationEnabled;
    this.minTransitionIntervalMs =
      options?.minTransitionIntervalMs ?? config.movement.minTransitionIntervalMs;
  }

  public setGlobalAutomation(enabled: boolean): void {
    this.globalAutomationEnabled = enabled;
  }

  public isGlobalAutomationEnabled(): boolean {
    return this.globalAutomationEnabled;
  }

  public getMinTransitionIntervalMs(): number {
    return this.minTransitionIntervalMs;
  }

  public setMinTransitionIntervalMs(intervalMs: number): void {
    this.minTransitionIntervalMs = intervalMs;
  }

  /**
   * Evaluates a recognition observation and creates safe, deterministic movement events.
   * Only stable MATCH observations create real-world side effects.
   */
  public async evaluateObservation(
    observation: RecognitionObservation
  ): Promise<MovementDecisionResult> {
    const timestamp = new Date().toISOString();

    // 1. Mandatory Gate: ONLY classification = 'MATCH' may create movement
    if (observation.classification !== 'MATCH') {
      return {
        status: 'NO_MATCH',
        cameraId: observation.cameraId,
        timestamp,
        reason: `Observation classification '${observation.classification}' does not permit movement`,
      };
    }

    // Resident must be identified
    if (!observation.resident?.id) {
      return {
        status: 'NO_MATCH',
        cameraId: observation.cameraId,
        timestamp,
        reason: 'Observation has no resident identity',
      };
    }

    const residentId = observation.resident.id;
    const observationId = observation.id;

    // 2. Idempotency Check (In-memory cache fast path)
    if (observationId && this.processedObservationIds.has(observationId)) {
      const cached = this.processedObservationIds.get(observationId)!;
      return {
        ...cached,
        status: 'DUPLICATE_OBSERVATION_SUPPRESSED',
        reason: 'Observation was already evaluated (cached idempotency)',
      };
    }

    // 3. Database Idempotency Check (prevent duplicate replay across restarts / multiple workers)
    if (observationId) {
      const existingDbEvent = await this.db.movementEvent.findFirst({
        where: { recognitionReference: observationId },
      });
      if (existingDbEvent) {
        const result: MovementDecisionResult = {
          status: 'DUPLICATE_OBSERVATION_SUPPRESSED',
          direction: existingDbEvent.movementType,
          movementEventId: existingDbEvent.id,
          residentId,
          residentCode: observation.resident.residentCode,
          residentName: observation.resident.fullName,
          currentPresence:
            existingDbEvent.movementType === MovementType.IN ? PresenceState.IN : PresenceState.OUT,
          cameraId: observation.cameraId,
          timestamp,
          reason: 'Movement event already exists for this recognition observation (db idempotency)',
        };
        this.cacheResult(observationId, result);
        return result;
      }
    }

    // 4. Camera Role & Capability Validation
    const camera = await this.db.camera.findUnique({
      where: { id: observation.cameraId },
    });

    if (!camera || !camera.isEnabled) {
      return {
        status: 'CAMERA_NOT_MOVEMENT_CAPABLE',
        cameraId: observation.cameraId,
        residentId,
        timestamp,
        reason: camera ? `Camera '${camera.name}' is disabled` : 'Camera not found',
      };
    }

    if (camera.role !== CameraRole.IN && camera.role !== CameraRole.OUT) {
      return {
        status: 'CAMERA_NOT_MOVEMENT_CAPABLE',
        cameraId: camera.id,
        cameraRole: camera.role,
        residentId,
        timestamp,
        reason: `Camera role '${camera.role}' does not create automatic movements (only IN and OUT roles)`,
      };
    }

    // 5. Automation Enablement Checks (Global switch + per-camera switch)
    if (!this.globalAutomationEnabled) {
      return {
        status: 'AUTOMATION_DISABLED',
        cameraId: camera.id,
        cameraRole: camera.role,
        residentId,
        residentCode: observation.resident.residentCode,
        residentName: observation.resident.fullName,
        timestamp,
        reason: 'Movement automation is disabled globally',
      };
    }

    const cameraConfig = (camera.configMetadata as Record<string, any>) || {};
    if (cameraConfig.movementAutomationEnabled === false) {
      return {
        status: 'AUTOMATION_DISABLED',
        cameraId: camera.id,
        cameraRole: camera.role,
        residentId,
        residentCode: observation.resident.residentCode,
        residentName: observation.resident.fullName,
        timestamp,
        reason: `Movement automation is disabled for camera '${camera.name}'`,
      };
    }

    // 6. Direction MUST come from camera role (server-authoritative)
    const targetDirection: MovementType =
      camera.role === CameraRole.IN ? MovementType.IN : MovementType.OUT;

    // 7. Validate Resident Eligibility Server-Side
    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
    });

    if (!resident) {
      return {
        status: 'RESIDENT_INACTIVE',
        cameraId: camera.id,
        residentId,
        timestamp,
        reason: 'Resident record not found',
      };
    }

    if (resident.status !== ResidentStatus.ACTIVE) {
      return {
        status: 'RESIDENT_INACTIVE',
        cameraId: camera.id,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        timestamp,
        reason: `Resident status is '${resident.status}' (must be ACTIVE)`,
      };
    }

    if (resident.faceEnrollmentStatus !== FaceEnrollmentStatus.ENROLLED) {
      return {
        status: 'RESIDENT_NOT_ENROLLED',
        cameraId: camera.id,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        timestamp,
        reason: `Resident face enrollment status is '${resident.faceEnrollmentStatus}' (must be ENROLLED)`,
      };
    }

    // 8. Cross-Hostel & Organization Defense-in-Depth
    if (
      resident.organizationId !== camera.organizationId ||
      resident.hostelId !== camera.hostelId
    ) {
      return {
        status: 'CROSS_HOSTEL_MISMATCH',
        cameraId: camera.id,
        cameraRole: camera.role,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        timestamp,
        reason: `Cross-hostel mismatch: Resident belongs to hostel '${resident.hostelId}', but camera belongs to hostel '${camera.hostelId}'`,
      };
    }

    // 9. Inspect Current Authoritative ResidentPresence State
    const currentPresence = await this.db.residentPresence.findUnique({
      where: { residentId: resident.id },
    });

    // Handle initial presence state policy (Requirement 10)
    if (!currentPresence) {
      if (targetDirection === MovementType.OUT) {
        return {
          status: 'INITIAL_PRESENCE_MISSING',
          cameraId: camera.id,
          cameraRole: camera.role,
          residentId: resident.id,
          residentCode: resident.residentCode,
          residentName: resident.fullName,
          timestamp,
          reason: 'No prior presence record found; automatic OUT movement refused',
        };
      }

      // For IN camera: safely initialize presence to OUT so recordNormalMovement can transition OUT -> IN
      await this.db.residentPresence.create({
        data: {
          residentId: resident.id,
          hostelId: resident.hostelId,
          currentState: PresenceState.OUT,
        },
      });
    }

    const effectiveCurrentPresence =
      currentPresence ||
      (await this.db.residentPresence.findUniqueOrThrow({
        where: { residentId: resident.id },
      }));

    const currentState = effectiveCurrentPresence.currentState;

    // 10. Duplicate State Suppression (Requirement 9 & 19)
    if (currentState === PresenceState.IN && targetDirection === MovementType.IN) {
      const result: MovementDecisionResult = {
        status: 'ALREADY_IN',
        direction: MovementType.IN,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        previousPresence: PresenceState.IN,
        currentPresence: PresenceState.IN,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
        reason: 'Resident is already recorded as IN; duplicate movement suppressed',
      };
      if (observationId) this.cacheResult(observationId, result);
      return result;
    }

    if (currentState === PresenceState.OUT && targetDirection === MovementType.OUT) {
      const result: MovementDecisionResult = {
        status: 'ALREADY_OUT',
        direction: MovementType.OUT,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        previousPresence: PresenceState.OUT,
        currentPresence: PresenceState.OUT,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
        reason: 'Resident is already recorded as OUT; duplicate movement suppressed',
      };
      if (observationId) this.cacheResult(observationId, result);
      return result;
    }

    // 11. Rapid Camera Transition Guard (Requirement 18)
    if (effectiveCurrentPresence.lastMovementTime) {
      const elapsedMs =
        Date.now() - new Date(effectiveCurrentPresence.lastMovementTime).getTime();
      if (elapsedMs < this.minTransitionIntervalMs) {
        const result: MovementDecisionResult = {
          status: 'TRANSITION_SUPPRESSED',
          residentId: resident.id,
          residentCode: resident.residentCode,
          residentName: resident.fullName,
          previousPresence: currentState,
          currentPresence: currentState,
          cameraId: camera.id,
          cameraRole: camera.role,
          timestamp,
          reason: `Rapid opposite transition suppressed: only ${elapsedMs}ms elapsed since last movement (minimum threshold: ${this.minTransitionIntervalMs}ms)`,
        };
        if (observationId) this.cacheResult(observationId, result);
        return result;
      }
    }

    // 12. Commit Atomic Movement Transaction via MovementService (Requirement 11 & 39)
    try {
      const movementEvent = await this.movementService.recordNormalMovement({
        residentId: resident.id,
        movementType: targetDirection,
        hostelId: camera.hostelId,
        locationId: camera.locationId,
        cameraId: camera.id,
        source: MovementSource.FACE_RECOGNITION,
        performedByUserId: null,
        performedByRole: null,
        notes: `Automated face recognition at ${camera.name} (${camera.role})`,
        recognitionReference: observationId || null,
        effectiveTimestamp: new Date(),
      });

      const newPresence =
        targetDirection === MovementType.IN ? PresenceState.IN : PresenceState.OUT;

      const result: MovementDecisionResult = {
        status: 'MOVEMENT_CREATED',
        direction: targetDirection,
        movementEventId: movementEvent.id,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        previousPresence: currentState,
        currentPresence: newPresence,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp: movementEvent.effectiveTimestamp.toISOString(),
      };

      if (observationId) {
        this.cacheResult(observationId, result);
      }

      return result;
    } catch (err: any) {
      console.error(`[MovementDecisionService] Error recording movement for resident ${resident.id}:`, err);
      return {
        status: 'ERROR',
        cameraId: camera.id,
        cameraRole: camera.role,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        timestamp,
        reason: err.message || 'Database error during movement execution',
      };
    }
  }

  private cacheResult(observationId: string, result: MovementDecisionResult): void {
    if (this.processedObservationIds.size >= this.maxCacheSize) {
      const firstKey = this.processedObservationIds.keys().next().value;
      if (firstKey) this.processedObservationIds.delete(firstKey);
    }
    this.processedObservationIds.set(observationId, result);
  }

  public clearCache(): void {
    this.processedObservationIds.clear();
  }
}
