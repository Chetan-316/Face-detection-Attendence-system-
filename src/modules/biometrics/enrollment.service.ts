import { PrismaClient, StaffRole, FaceEnrollmentStatus, ResidentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma as defaultPrisma } from '../../database/client';
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { CameraService } from '../cameras/camera.service';
import { PythonWorkerClient, defaultPythonWorkerClient } from './python-worker-client';
import {
  EnrollmentSession,
  EnrollmentStatusResponse,
  BiometricQualityResult,
  EnrollmentPose,
} from './biometric.types';
import {
  EnrollmentSessionError,
  EnrollmentInconsistentError,
} from './biometric.errors';
import { TemplateCache, defaultTemplateCache } from '../recognition/template-cache';

export interface AuthenticatedActor {
  id: string;
  role: StaffRole;
  organizationId: string;
  hostelId?: string | null;
}

export class EnrollmentService {
  private auditService: AuditService;
  private cameraService: CameraService;
  private templateCache: TemplateCache;
  private sessions: Map<string, EnrollmentSession> = new Map(); // residentId -> EnrollmentSession

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    private readonly workerClient: PythonWorkerClient = defaultPythonWorkerClient,
    cameraService?: CameraService,
    templateCache?: TemplateCache
  ) {
    this.auditService = new AuditService(this.db);
    this.cameraService = cameraService || new CameraService(this.db);
    this.templateCache = templateCache || defaultTemplateCache;
  }

  /**
   * Helper to verify actor permission for a given resident
   */
  private async verifyActorScope(residentId: string, actor: AuthenticatedActor) {
    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
    });

    if (!resident) {
      throw new NotFoundError('Resident', residentId);
    }

    if (resident.organizationId !== actor.organizationId) {
      throw new NotFoundError('Resident', residentId);
    }

    if (actor.role === StaffRole.GUARD) {
      const isRegularComer = resident.roomGroup?.includes('Non-Resident');
      const isAssignedHostel = !actor.hostelId || resident.hostelId === actor.hostelId;
      if (!isRegularComer || !isAssignedHostel) {
        throw new ForbiddenError('Guards are not authorized to perform face enrollment or revocation');
      }
    }

    if (actor.role === StaffRole.WARDEN && actor.hostelId && resident.hostelId !== actor.hostelId) {
      throw new NotFoundError('Resident', residentId);
    }

    if (actor.role === StaffRole.ADMIN && actor.hostelId && resident.hostelId !== actor.hostelId) {
      throw new NotFoundError('Resident', residentId);
    }

    return resident;
  }

  /**
   * Starts a face enrollment session for a resident
   */
  public async startEnrollment(
    residentId: string,
    cameraId?: string,
    actor?: AuthenticatedActor
  ): Promise<EnrollmentStatusResponse> {
    if (!actor) {
      throw new ForbiddenError('Authentication required');
    }

    const resident = await this.verifyActorScope(residentId, actor);

    if (resident.status !== ResidentStatus.ACTIVE) {
      throw new ValidationError(`Cannot enroll face for inactive resident (current status: ${resident.status})`);
    }

    // Determine target camera
    let targetCameraId = cameraId;
    if (!targetCameraId) {
      // Find first enabled camera in resident's hostel ONLY
      const availableCam = await this.db.camera.findFirst({
        where: {
          organizationId: resident.organizationId,
          hostelId: resident.hostelId,
          isEnabled: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!availableCam) {
        throw new ValidationError("No active camera is available in this resident's hostel");
      }
      targetCameraId = availableCam.id;
    } else {
      const camera = await this.db.camera.findUnique({ where: { id: targetCameraId } });
      if (
        !camera ||
        camera.organizationId !== resident.organizationId ||
        camera.hostelId !== resident.hostelId ||
        !camera.isEnabled
      ) {
        throw new NotFoundError('Camera', targetCameraId);
      }
    }

    // Clean up any existing session
    this.sessions.delete(residentId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min TTL

    const session: EnrollmentSession = {
      sessionId: `enr_${randomUUID().replace(/-/g, '')}`,
      residentId: resident.id,
      hostelId: resident.hostelId,
      organizationId: resident.organizationId,
      cameraId: targetCameraId,
      createdByUserId: actor.id,
      startedAt: now,
      expiresAt,
      status: 'CAPTURING',
      requiredSamples: 5,
      samplesAccepted: 0,
      samplesRejected: 0,
      requiredPoses: ['FRONT', 'LEFT', 'RIGHT', 'UP', 'DOWN'],
      currentPoseIndex: 0,
      completedPoses: [],
      acceptedPoseEmbeddings: {},
      lastQuality: null,
      lastCaptureTime: 0,
      acceptedEmbeddings: [],
    };

    this.sessions.set(residentId, session);

    return this.buildStatusResponse(session);
  }

  public getPoseInstruction(pose: EnrollmentPose): string {
    switch (pose) {
      case 'FRONT':
        return 'Look straight at the camera.';
      case 'LEFT':
        return 'Turn slightly left.';
      case 'RIGHT':
        return 'Turn slightly right.';
      case 'UP':
        return 'Look slightly up.';
      case 'DOWN':
        return 'Look slightly down.';
      default:
        return 'Face the camera directly.';
    }
  }

  /**
   * Retrieves active enrollment session status
   */
  public async getEnrollmentStatus(
    residentId: string,
    actor?: AuthenticatedActor
  ): Promise<EnrollmentStatusResponse> {
    if (actor) {
      await this.verifyActorScope(residentId, actor);
    }

    const session = this.sessions.get(residentId);
    if (!session) {
      throw new NotFoundError('Active enrollment session for resident', residentId);
    }

    if (Date.now() > session.expiresAt.getTime()) {
      session.status = 'EXPIRED';
      this.sessions.delete(residentId);
      throw new EnrollmentSessionError('Enrollment session has expired. Please restart.', 410);
    }

    return this.buildStatusResponse(session);
  }

  /**
   * Captures or evaluates a single frame against the enrollment session
   */
  public async captureFrame(
    residentId: string,
    actor?: AuthenticatedActor,
    targetPose?: EnrollmentPose,
    imageBase64?: string
  ): Promise<{
    sessionStatus: EnrollmentStatusResponse;
    quality: BiometricQualityResult;
    sampleAccepted: boolean;
  }> {
    if (actor) {
      await this.verifyActorScope(residentId, actor);
    }

    const session = this.sessions.get(residentId);
    if (!session) {
      throw new NotFoundError('Active enrollment session for resident', residentId);
    }

    if (Date.now() > session.expiresAt.getTime()) {
      session.status = 'EXPIRED';
      this.sessions.delete(residentId);
      throw new EnrollmentSessionError('Enrollment session has expired', 410);
    }

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      throw new EnrollmentSessionError(`Enrollment session is already ${session.status}`);
    }

    // Source frame buffer: from client webcam imageBase64 if provided, or from server camera snapshot
    let frameBuffer: Buffer;
    if (imageBase64) {
      const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      frameBuffer = Buffer.from(cleanBase64, 'base64');
    } else {
      const snapshot = await this.cameraService.captureFreshSnapshot(session.cameraId);
      if (!snapshot || !snapshot.frameBuffer) {
        throw new ValidationError('Camera failed to deliver snapshot frame');
      }
      frameBuffer = snapshot.frameBuffer;
    }

    const requiredPose = targetPose || (
      session.currentPoseIndex < session.requiredPoses.length
        ? session.requiredPoses[session.currentPoseIndex]
        : null
    );

    // Run frame through Python worker
    const processResult = await this.workerClient.processFrame(frameBuffer, {
      expectedPose: requiredPose || undefined,
    });

    const quality: BiometricQualityResult = processResult?.quality || {
      is_valid: false,
      rejection_reason: 'NO_FACE',
      message: processResult?.message || 'Biometric analysis failed',
    };
    session.lastQuality = quality;

    let sampleAccepted = false;

    const detectedPose = quality.detected_pose !== undefined
      ? quality.detected_pose
      : (quality.metrics as any)?.detected_pose !== undefined
      ? (quality.metrics as any)?.detected_pose
      : (quality.is_valid ? requiredPose : null);

    if (quality.is_valid && processResult?.embedding && requiredPose) {
      if (detectedPose !== requiredPose) {
        session.samplesRejected += 1;
        quality.is_valid = false;
        quality.rejection_reason = 'WRONG_POSE';
        quality.message = this.getPoseInstruction(requiredPose);
      } else {
        // Enforce capture interval pacing (at least 200ms between accepted manual samples)
        const now = Date.now();
        const timeSinceLast = now - session.lastCaptureTime;

        if (timeSinceLast >= 200) {
          session.acceptedPoseEmbeddings[requiredPose] = processResult.embedding;
          if (!session.completedPoses.includes(requiredPose)) {
            session.completedPoses.push(requiredPose);
          }
          session.acceptedEmbeddings = Object.values(session.acceptedPoseEmbeddings);
          session.samplesAccepted = session.completedPoses.length;
          if (!targetPose || targetPose === session.requiredPoses[session.currentPoseIndex]) {
            session.currentPoseIndex = session.completedPoses.length;
          }
          session.lastCaptureTime = now;
          sampleAccepted = true;

          if (
            session.completedPoses.length >= session.requiredPoses.length
          ) {
            session.status = 'READY';
          }
        }
      }
    } else {
      session.samplesRejected += 1;
    }

    return {
      sessionStatus: this.buildStatusResponse(session),
      quality,
      sampleAccepted,
    };
  }

  /**
   * Finalizes enrollment: checks consistency, averages & normalizes embedding, commits to DB atomically
   */
  public async completeEnrollment(
    residentId: string,
    actor?: AuthenticatedActor
  ): Promise<{
    residentId: string;
    enrollmentStatus: FaceEnrollmentStatus;
    modelName: string;
    modelVersion: string;
    samplesCount: number;
    consistencyScore: number;
    enrolledAt: Date;
  }> {
    if (!actor) {
      throw new ForbiddenError('Authentication required');
    }

    const resident = await this.verifyActorScope(residentId, actor);

    const session = this.sessions.get(residentId);
    if (!session) {
      throw new NotFoundError('Active enrollment session for resident', residentId);
    }

    if (Date.now() > session.expiresAt.getTime()) {
      session.status = 'EXPIRED';
      this.sessions.delete(residentId);
      throw new EnrollmentSessionError('Enrollment session has expired', 410);
    }

    // Minimum 5 samples required and all 5 poses completed
    const minRequired = 5;
    if (session.samplesAccepted < minRequired || session.completedPoses.length < session.requiredPoses.length) {
      throw new ValidationError(
        `Insufficient samples or poses completed (${session.completedPoses.length}/${session.requiredPoses.length} poses, ${session.samplesAccepted}/${minRequired} samples required). Please complete all required poses.`
      );
    }

    // Aggregate samples via Python worker and perform outlier rejection
    const aggResult = await this.workerClient.aggregateEmbeddings(session.acceptedEmbeddings);
    if (!aggResult.success || !aggResult.template) {
      session.status = 'FAILED';
      throw new EnrollmentInconsistentError(
        aggResult.message || 'Face samples consistency validation failed. Recapture required.',
        { details: aggResult }
      );
    }

    const templateVector = aggResult.template;
    const consistencyScore = aggResult.consistency_score || 1.0;
    const samplesCount = aggResult.samples_count || session.samplesAccepted;

    const modelHealth = await this.workerClient.health();
    if (
      modelHealth.status !== 'UP' ||
      !modelHealth.detectorLoaded ||
      !modelHealth.embedderLoaded
    ) {
      session.status = 'FAILED';
      throw new ValidationError(
        modelHealth.error || 'Biometric model worker is not ready'
      );
    }

    if (templateVector.length !== modelHealth.embeddingDimension) {
      session.status = 'FAILED';
      throw new ValidationError(
        `Biometric template dimension mismatch: worker reported ${modelHealth.embeddingDimension}, aggregation produced ${templateVector.length}`
      );
    }

    const modelName = modelHealth.modelName;
    const modelVersion = modelHealth.modelVersion;
    const embeddingDimension = modelHealth.embeddingDimension;
    const templateVersion = modelHealth.templateVersion || '1.0.0';

    // Atomic commit to PostgreSQL
    const result = await this.db.$transaction(async (tx) => {
      // Check existing profile
      const existingProfile = await tx.faceProfile.findFirst({
        where: { residentId: resident.id, enrollmentStatus: FaceEnrollmentStatus.ENROLLED },
        orderBy: { enrolledAt: 'desc' },
      });

      const isReenrollment = !!existingProfile;

      // Invalidate existing enrolled profile if re-enrolling
      if (existingProfile) {
        await tx.faceProfile.update({
          where: { id: existingProfile.id },
          data: {
            enrollmentStatus: FaceEnrollmentStatus.NEEDS_REENROLLMENT,
          },
        });
      }

      // Create new FaceProfile
      const profile = await tx.faceProfile.create({
        data: {
          residentId: resident.id,
          enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
          modelName,
          modelVersion,
          templateReference: `fptpl_${randomUUID().replace(/-/g, '')}`,
          metadata: {
            template: templateVector,
            embeddingDimension,
            templateVersion,
            modelName,
            modelVersion,
            biometricEngine: modelHealth.engine || null,
            detectorName: modelHealth.detectorName,
            detectorVersion: modelHealth.detectorVersion,
            samplesCount,
            consistencyScore,
            posesCompleted: session.completedPoses.join(','),
            enrolledVia: 'WEBCAM_ENROLLMENT',
          },
          enrolledByUserId: actor.id,
          enrolledAt: new Date(),
        },
      });

      // Synchronize Resident faceEnrollmentStatus atomically
      await tx.resident.update({
        where: { id: resident.id },
        data: {
          faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
        },
      });

      // Record Audit Log (embeddings are never included!)
      await this.auditService.record(
        {
          organizationId: resident.organizationId,
          hostelId: resident.hostelId,
          entityType: 'FACE_PROFILE',
          entityId: profile.id,
          action: isReenrollment ? 'UPDATE' : 'CREATE',
          performedByUserId: actor.id,
          performedByRole: actor.role,
          reason: isReenrollment ? 'Face re-enrollment completed' : 'Initial face enrollment completed',
          newValues: {
            residentId: resident.id,
            modelName: profile.modelName,
            modelVersion: profile.modelVersion,
            enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
            samplesCount,
            consistencyScore,
          },
        },
        tx
      );

      return profile;
    });

    // Cleanup session and discard temporary raw embeddings from memory
    session.status = 'COMPLETED';
    session.acceptedEmbeddings = [];
    this.sessions.delete(residentId);

    // Invalidate recognition template cache for this hostel
    this.templateCache.invalidate(resident.hostelId);

    return {
      residentId: result.residentId,
      enrollmentStatus: result.enrollmentStatus,
      modelName: result.modelName,
      modelVersion: result.modelVersion,
      samplesCount,
      consistencyScore,
      enrolledAt: result.enrolledAt,
    };
  }

  /**
   * Cancels active enrollment session and discards memory samples without modifying DB
   */
  public async cancelEnrollment(
    residentId: string,
    actor?: AuthenticatedActor
  ): Promise<{ cancelled: boolean; message: string }> {
    if (actor) {
      await this.verifyActorScope(residentId, actor);
    }

    const session = this.sessions.get(residentId);
    if (session) {
      session.status = 'CANCELLED';
      session.acceptedEmbeddings = [];
      this.sessions.delete(residentId);
    }

    return {
      cancelled: true,
      message: 'Enrollment session cancelled. No changes were made.',
    };
  }

  /**
   * Revokes face enrollment: removes usable template for privacy, updates Resident & FaceProfile status
   */
  public async revokeEnrollment(
    residentId: string,
    reason: string,
    actor?: AuthenticatedActor
  ): Promise<{ residentId: string; status: FaceEnrollmentStatus; revokedAt: Date }> {
    if (!actor) {
      throw new ForbiddenError('Authentication required');
    }

    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('A non-empty reason is mandatory for revoking biometric enrollment');
    }

    const resident = await this.verifyActorScope(residentId, actor);

    const revokedAt = new Date();

    await this.db.$transaction(async (tx) => {
      // Find all active or enrolled profiles
      const activeProfiles = await tx.faceProfile.findMany({
        where: {
          residentId: resident.id,
          enrollmentStatus: { in: [FaceEnrollmentStatus.ENROLLED, FaceEnrollmentStatus.NEEDS_REENROLLMENT] },
        },
      });

      for (const profile of activeProfiles) {
        // Privacy rule: wipe the embedding vector from database
        const existingMeta = (profile.metadata as Record<string, any>) || {};
        const sanitizedMeta = {
          ...existingMeta,
          template: null,
          embedding: null,
          revocationReason: reason.trim(),
        };

        await tx.faceProfile.update({
          where: { id: profile.id },
          data: {
            enrollmentStatus: FaceEnrollmentStatus.REVOKED,
            revokedAt,
            metadata: sanitizedMeta,
          },
        });

        await this.auditService.record(
          {
            organizationId: resident.organizationId,
            hostelId: resident.hostelId,
            entityType: 'FACE_PROFILE',
            entityId: profile.id,
            action: 'UPDATE',
            performedByUserId: actor.id,
            performedByRole: actor.role,
            reason: reason.trim(),
            oldValues: { enrollmentStatus: profile.enrollmentStatus },
            newValues: { enrollmentStatus: FaceEnrollmentStatus.REVOKED },
          },
          tx
        );
      }

      // Update resident
      await tx.resident.update({
        where: { id: resident.id },
        data: {
          faceEnrollmentStatus: FaceEnrollmentStatus.REVOKED,
        },
      });
    });

    // Also clear any active capture session
    this.sessions.delete(residentId);

    // Invalidate recognition template cache for this hostel
    this.templateCache.invalidate(resident.hostelId);

    return {
      residentId: resident.id,
      status: FaceEnrollmentStatus.REVOKED,
      revokedAt,
    };
  }

  /**
   * Sets NEEDS_REENROLLMENT status (e.g. manual staff request or model migration)
   */
  public async markNeedsReenrollment(
    residentId: string,
    reason: string,
    actor?: AuthenticatedActor
  ): Promise<{ residentId: string; status: FaceEnrollmentStatus }> {
    if (!actor) {
      throw new ForbiddenError('Authentication required');
    }

    const resident = await this.verifyActorScope(residentId, actor);

    await this.db.$transaction(async (tx) => {
      const activeProfile = await tx.faceProfile.findFirst({
        where: { residentId: resident.id, enrollmentStatus: FaceEnrollmentStatus.ENROLLED },
      });

      if (activeProfile) {
        await tx.faceProfile.update({
          where: { id: activeProfile.id },
          data: { enrollmentStatus: FaceEnrollmentStatus.NEEDS_REENROLLMENT },
        });

        await this.auditService.record(
          {
            organizationId: resident.organizationId,
            hostelId: resident.hostelId,
            entityType: 'FACE_PROFILE',
            entityId: activeProfile.id,
            action: 'UPDATE',
            reason,
            performedByUserId: actor.id,
            performedByRole: actor.role,
            newValues: { enrollmentStatus: FaceEnrollmentStatus.NEEDS_REENROLLMENT },
          },
          tx
        );
      }

      await tx.resident.update({
        where: { id: resident.id },
        data: { faceEnrollmentStatus: FaceEnrollmentStatus.NEEDS_REENROLLMENT },
      });
    });

    return {
      residentId: resident.id,
      status: FaceEnrollmentStatus.NEEDS_REENROLLMENT,
    };
  }

  private buildStatusResponse(session: EnrollmentSession): EnrollmentStatusResponse {
    const progress = Math.min(
      100,
      Math.round((session.samplesAccepted / session.requiredSamples) * 100)
    );

    const currentPose = session.currentPoseIndex < session.requiredPoses.length
      ? session.requiredPoses[session.currentPoseIndex]
      : null;

    return {
      sessionId: session.sessionId,
      residentId: session.residentId,
      cameraId: session.cameraId,
      status: session.status,
      requiredSamples: session.requiredSamples,
      acceptedSamples: session.samplesAccepted,
      rejectedSamples: session.samplesRejected,
      currentPose,
      completedPoses: [...session.completedPoses],
      requiredPoses: [...session.requiredPoses],
      progressPercentage: progress,
      isReady: session.completedPoses.length >= session.requiredPoses.length && session.samplesAccepted >= 5,
      lastQuality: session.lastQuality,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
