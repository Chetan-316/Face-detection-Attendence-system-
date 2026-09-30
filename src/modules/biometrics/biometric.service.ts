import { PrismaClient, FaceEnrollmentStatus, FaceProfile } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { NotFoundError, ValidationError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { EnrollmentService, AuthenticatedActor } from './enrollment.service';
import { PythonWorkerClient, defaultPythonWorkerClient } from './python-worker-client';
import { BiometricHealthStatus } from './biometric.types';

export interface EnrollFaceProfileInput {
  residentId: string;
  modelName: string;
  modelVersion: string;
  templateReference: string;
  metadata?: Record<string, any>;
  enrolledByUserId?: string;
}

export class BiometricService {
  private auditService: AuditService;
  public readonly enrollmentService: EnrollmentService;
  public readonly workerClient: PythonWorkerClient;

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    workerClient: PythonWorkerClient = defaultPythonWorkerClient
  ) {
    this.auditService = new AuditService(this.db);
    this.workerClient = workerClient;
    this.enrollmentService = new EnrollmentService(this.db, this.workerClient);
  }

  public async getHealth(): Promise<BiometricHealthStatus> {
    return this.workerClient.health();
  }

  public async enrollFaceProfile(input: EnrollFaceProfileInput): Promise<FaceProfile> {
    if (!input.templateReference || input.templateReference.trim().length === 0) {
      throw new ValidationError('Template reference is required for face enrollment');
    }
    if (!input.modelName || !input.modelVersion) {
      throw new ValidationError('Model name and version are required');
    }

    const resident = await this.db.resident.findUnique({
      where: { id: input.residentId },
    });
    if (!resident) {
      throw new NotFoundError('Resident', input.residentId);
    }

    return this.db.$transaction(async (tx) => {
      // Invalidate old enrolled profile if any
      const existing = await tx.faceProfile.findFirst({
        where: { residentId: input.residentId, enrollmentStatus: FaceEnrollmentStatus.ENROLLED },
      });
      if (existing) {
        await tx.faceProfile.update({
          where: { id: existing.id },
          data: { enrollmentStatus: FaceEnrollmentStatus.NEEDS_REENROLLMENT },
        });
      }

      // Create separate face profile record
      const profile = await tx.faceProfile.create({
        data: {
          residentId: input.residentId,
          enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
          modelName: input.modelName,
          modelVersion: input.modelVersion,
          templateReference: input.templateReference,
          metadata: input.metadata || {},
          enrolledByUserId: input.enrolledByUserId || null,
        },
      });

      // Update resident face enrollment status
      await tx.resident.update({
        where: { id: input.residentId },
        data: {
          faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
        },
      });

      // Audit log (never logs actual biometric template)
      await this.auditService.record(
        {
          organizationId: resident.organizationId,
          hostelId: resident.hostelId,
          entityType: 'FACE_PROFILE',
          entityId: profile.id,
          action: existing ? 'UPDATE' : 'CREATE',
          performedByUserId: input.enrolledByUserId || null,
          reason: existing ? 'Face re-enrollment' : 'Initial face enrollment',
          newValues: {
            residentId: profile.residentId,
            modelName: profile.modelName,
            modelVersion: profile.modelVersion,
            enrollmentStatus: profile.enrollmentStatus,
          },
        },
        tx
      );

      return profile;
    });
  }

  public async revokeFaceProfile(
    profileId: string,
    reason: string,
    performedByUserId?: string
  ): Promise<FaceProfile> {
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('Reason is mandatory for revoking biometric profile');
    }

    const profile = await this.db.faceProfile.findUnique({
      where: { id: profileId },
      include: { resident: true },
    });
    if (!profile) {
      throw new NotFoundError('FaceProfile', profileId);
    }

    return this.db.$transaction(async (tx) => {
      const existingMeta = (profile.metadata as Record<string, any>) || {};
      const updated = await tx.faceProfile.update({
        where: { id: profileId },
        data: {
          enrollmentStatus: FaceEnrollmentStatus.REVOKED,
          revokedAt: new Date(),
          metadata: { ...existingMeta, embedding: null, revocationReason: reason },
        },
      });

      await tx.resident.update({
        where: { id: profile.residentId },
        data: {
          faceEnrollmentStatus: FaceEnrollmentStatus.REVOKED,
        },
      });

      await this.auditService.record(
        {
          organizationId: profile.resident.organizationId,
          hostelId: profile.resident.hostelId,
          entityType: 'FACE_PROFILE',
          entityId: profile.id,
          action: 'UPDATE',
          reason,
          performedByUserId: performedByUserId || null,
          oldValues: { enrollmentStatus: profile.enrollmentStatus },
          newValues: { enrollmentStatus: FaceEnrollmentStatus.REVOKED },
        },
        tx
      );

      return updated;
    });
  }

  public async getActiveProfile(residentId: string): Promise<FaceProfile | null> {
    return this.db.faceProfile.findFirst({
      where: {
        residentId,
        enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }
}
