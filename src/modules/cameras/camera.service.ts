import {
  PrismaClient,
  Camera,
  CameraSourceType,
  CameraRole,
  CameraHealthStatus,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { NotFoundError, ValidationError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';

export interface CreateCameraInput {
  organizationId: string;
  hostelId: string;
  locationId?: string | null;
  name: string;
  sourceType: CameraSourceType;
  role?: CameraRole;
  isEnabled?: boolean;
  configMetadata?: Record<string, any>;
  createdByUserId?: string;
}

export class CameraService {
  private auditService: AuditService;

  constructor(private readonly db: PrismaClient = defaultPrisma) {
    this.auditService = new AuditService(this.db);
  }

  public async createCamera(input: CreateCameraInput): Promise<Camera> {
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Camera name is required');
    }

    const hostel = await this.db.hostel.findUnique({
      where: { id: input.hostelId },
    });
    if (!hostel) {
      throw new NotFoundError('Hostel', input.hostelId);
    }

    return this.db.$transaction(async (tx) => {
      const camera = await tx.camera.create({
        data: {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          locationId: input.locationId || null,
          name: input.name.trim(),
          sourceType: input.sourceType,
          role: input.role || CameraRole.GENERAL,
          isEnabled: input.isEnabled ?? true,
          healthStatus: CameraHealthStatus.UNKNOWN,
          configMetadata: input.configMetadata || {},
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          entityType: 'CAMERA',
          entityId: camera.id,
          action: 'CREATE',
          performedByUserId: input.createdByUserId || null,
          newValues: {
            name: camera.name,
            sourceType: camera.sourceType,
            role: camera.role,
            isEnabled: camera.isEnabled,
          },
        },
        tx
      );

      return camera;
    });
  }

  public async getCamera(id: string): Promise<Camera> {
    const camera = await this.db.camera.findUnique({
      where: { id },
      include: { location: true },
    });
    if (!camera) {
      throw new NotFoundError('Camera', id);
    }
    return camera;
  }

  public async listCameras(hostelId: string, role?: CameraRole) {
    return this.db.camera.findMany({
      where: {
        hostelId,
        ...(role ? { role } : {}),
      },
      include: { location: true },
      orderBy: { name: 'asc' },
    });
  }
}
