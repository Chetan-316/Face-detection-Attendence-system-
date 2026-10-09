import { PrismaClient, ResidentStatus, FaceEnrollmentStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { CachedTemplate } from './recognition.types';
import { TemplateMatcher } from './template-matcher';
import { config } from '../../config';

interface CacheBucket {
  templates: CachedTemplate[];
  loadedAt: number;
  isDirty: boolean;
}

export class TemplateCache {
  private cache: Map<string, CacheBucket> = new Map(); // hostelId -> CacheBucket
  private ttlMs: number;

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    ttlSeconds = 45
  ) {
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Retrieves active, eligible face templates for a specific hostel.
   * Scoped strictly to the camera's hostel and organization.
   */
  public async getTemplatesForHostel(hostelId: string, organizationId: string): Promise<CachedTemplate[]> {
    const bucket = this.cache.get(hostelId);
    const now = Date.now();

    if (bucket && !bucket.isDirty && (now - bucket.loadedAt < this.ttlMs)) {
      return bucket.templates;
    }

    // Refresh from PostgreSQL
    const freshTemplates = await this.loadFromDatabase(hostelId, organizationId);
    this.cache.set(hostelId, {
      templates: freshTemplates,
      loadedAt: now,
      isDirty: false,
    });

    return freshTemplates;
  }

  /**
   * Query PostgreSQL for eligible residents and their latest ENROLLED FaceProfile.
   */
  private async loadFromDatabase(hostelId: string, organizationId: string): Promise<CachedTemplate[]> {
    const residents = await this.db.resident.findMany({
      where: {
        hostelId,
        organizationId,
        status: ResidentStatus.ACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
      },
      include: {
        faceProfiles: {
          where: {
            enrollmentStatus: FaceEnrollmentStatus.ENROLLED,
          },
          orderBy: { enrolledAt: 'desc' },
        },
      },
    });

    const eligibleTemplates: CachedTemplate[] = [];

    for (const resident of residents) {
      if (!resident.faceProfiles || resident.faceProfiles.length === 0) {
        continue;
      }

      if (resident.faceProfiles.length > 1) {
        console.warn(
          `[Recognition TemplateCache] Resident ${resident.id} has ${resident.faceProfiles.length} active ENROLLED profiles. Selecting newest.`
        );
      }

      const activeProfile = resident.faceProfiles[0];

      const expected = config.biometric;

      if (activeProfile.modelName !== expected.modelName) {
        console.warn(
          `[Recognition TemplateCache] Incompatible modelName '${activeProfile.modelName}' for resident ${resident.id}. Expected '${expected.modelName}'. Re-enrollment is required.`
        );
        continue;
      }

      if (activeProfile.modelVersion !== expected.modelVersion) {
        console.warn(
          `[Recognition TemplateCache] Incompatible modelVersion '${activeProfile.modelVersion}' for resident ${resident.id}. Expected '${expected.modelVersion}'. Re-enrollment is required.`
        );
        continue;
      }

      const metadata = (activeProfile.metadata as Record<string, any>) || {};
      const templateVector = metadata.template;

      if (
        metadata.embeddingDimension !== undefined &&
        metadata.embeddingDimension !== expected.embeddingDimension
      ) {
        console.warn(
          `[Recognition TemplateCache] Incompatible embeddingDimension '${metadata.embeddingDimension}' for resident ${resident.id}. Expected ${expected.embeddingDimension}.`
        );
        continue;
      }

      if (
        metadata.templateVersion !== undefined &&
        metadata.templateVersion !== expected.templateVersion
      ) {
        console.warn(
          `[Recognition TemplateCache] Incompatible templateVersion '${metadata.templateVersion}' for resident ${resident.id}. Expected '${expected.templateVersion}'.`
        );
        continue;
      }

      // Dimension, finite numbers, non-zero norm check (Req 22)
      if (!TemplateMatcher.isValidVector(templateVector, config.biometric.embeddingDimension)) {
        console.warn(`[Recognition TemplateCache] Invalid biometric template for resident ${resident.id}`);
        continue;
      }


      eligibleTemplates.push({
        residentId: resident.id,
        residentCode: resident.residentCode,
        fullName: resident.fullName,
        hostelId: resident.hostelId,
        organizationId: resident.organizationId,
        template: templateVector,
        modelName: activeProfile.modelName,
        modelVersion: activeProfile.modelVersion,
        templateVersion: metadata.templateVersion || config.biometric.templateVersion,
        enrolledAt: activeProfile.enrolledAt,
      });
    }

    return eligibleTemplates;
  }

  /**
   * Explicitly invalidate the cache for a given hostel (or all if not specified).
   * Called on enrollment lifecycle events: enrollment complete, revocation, reactivation/deactivation.
   */
  public invalidate(hostelId?: string): void {
    if (hostelId) {
      const bucket = this.cache.get(hostelId);
      if (bucket) {
        bucket.isDirty = true;
      }
    } else {
      for (const bucket of this.cache.values()) {
        bucket.isDirty = true;
      }
    }
  }

  /**
   * Clear all cached data
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Get diagnostic count of cached templates for a hostel without querying DB if present
   */
  public getCachedCount(hostelId: string): number {
    return this.cache.get(hostelId)?.templates.length ?? 0;
  }
}

export const defaultTemplateCache = new TemplateCache();
