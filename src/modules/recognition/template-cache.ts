import { PrismaClient, ResidentStatus, FaceEnrollmentStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { CachedTemplate } from './recognition.types';
import { TemplateMatcher } from './template-matcher';

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

      // Compatibility checks: SFace 2021dec
      if (activeProfile.modelName !== 'SFace') {
        console.warn(
          `[Recognition TemplateCache] Incompatible modelName '${activeProfile.modelName}' for resident ${resident.id}. Expected 'SFace'.`
        );
        continue;
      }

      if (activeProfile.modelVersion !== '2021dec') {
        console.warn(
          `[Recognition TemplateCache] Incompatible modelVersion '${activeProfile.modelVersion}' for resident ${resident.id}. Expected '2021dec'.`
        );
        continue;
      }

      const metadata = (activeProfile.metadata as Record<string, any>) || {};
      const templateVector = metadata.template;

      // Compatibility check: embeddingDimension & templateVersion (Req 23)
      if (metadata.embeddingDimension !== undefined && metadata.embeddingDimension !== 128) {
        console.warn(
          `[Recognition TemplateCache] Incompatible embeddingDimension '${metadata.embeddingDimension}' for resident ${resident.id}. Expected 128.`
        );
        continue;
      }

      if (metadata.templateVersion !== undefined && metadata.templateVersion !== '1.0.0') {
        console.warn(
          `[Recognition TemplateCache] Incompatible templateVersion '${metadata.templateVersion}' for resident ${resident.id}. Expected '1.0.0'.`
        );
        continue;
      }

      // Dimension, finite numbers, non-zero norm check (Req 22)
      if (!TemplateMatcher.isValidVector(templateVector)) {
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
        templateVersion: metadata.templateVersion || '1.0.0',
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
