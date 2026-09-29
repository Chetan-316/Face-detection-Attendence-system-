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
import { CameraDiagnostics, CameraFrame, ICameraAdapter } from './camera.types';
import { CameraAdapterFactory } from './camera-adapter.factory';

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

export interface UpdateCameraInput {
  name?: string;
  locationId?: string | null;
  role?: CameraRole;
  isEnabled?: boolean;
  configMetadata?: Record<string, any>;
  updatedByUserId?: string;
}

export class CameraService {
  private auditService: AuditService;
  private activeAdapters: Map<string, ICameraAdapter> = new Map();

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

    if (input.locationId) {
      const location = await this.db.location.findUnique({
        where: { id: input.locationId },
      });
      if (!location || location.hostelId !== input.hostelId) {
        throw new ValidationError(`Location '${input.locationId}' does not belong to hostel '${input.hostelId}'`);
      }
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
          healthStatus: CameraHealthStatus.OFFLINE,
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

  public async updateCamera(id: string, input: UpdateCameraInput): Promise<Camera> {
    const existing = await this.getCamera(id);

    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new ValidationError('Camera name cannot be empty');
    }

    if (input.locationId) {
      const location = await this.db.location.findUnique({
        where: { id: input.locationId },
      });
      if (!location || location.hostelId !== existing.hostelId) {
        throw new ValidationError(`Location '${input.locationId}' does not belong to hostel '${existing.hostelId}'`);
      }
    }

    const updated = await this.db.$transaction(async (tx) => {
      const camera = await tx.camera.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
          ...(input.configMetadata !== undefined ? { configMetadata: input.configMetadata } : {}),
        },
        include: { location: true },
      });

      await this.auditService.record(
        {
          organizationId: camera.organizationId,
          hostelId: camera.hostelId,
          entityType: 'CAMERA',
          entityId: camera.id,
          action: 'UPDATE',
          performedByUserId: input.updatedByUserId || null,
          oldValues: {
            name: existing.name,
            role: existing.role,
            isEnabled: existing.isEnabled,
          },
          newValues: {
            name: camera.name,
            role: camera.role,
            isEnabled: camera.isEnabled,
          },
        },
        tx
      );

      return camera;
    });

    // If camera was re-configured or disabled, update runtime adapter
    const adapter = this.activeAdapters.get(id);
    if (adapter) {
      if (updated.isEnabled === false) {
        await adapter.stop();
      } else if (input.configMetadata) {
        await adapter.initialize(input.configMetadata);
      }
    }

    return updated;
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

  public async listCameras(hostelId?: string, organizationId?: string, role?: CameraRole) {
    return this.db.camera.findMany({
      where: {
        ...(hostelId ? { hostelId } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(role ? { role } : {}),
      },
      include: { location: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Retrieves or instantiates the camera adapter for the given camera.
   * Business code never depends on device index or direct camera hardware.
   */
  public async getOrCreateAdapter(cameraId: string): Promise<ICameraAdapter> {
    let adapter = this.activeAdapters.get(cameraId);
    if (adapter) {
      return adapter;
    }

    const camera = await this.getCamera(cameraId);
    if (!camera.isEnabled) {
      throw new ValidationError(`Camera '${camera.name}' (${camera.id}) is disabled`);
    }

    adapter = CameraAdapterFactory.create(camera.sourceType, camera.id);
    const config = (camera.configMetadata as Record<string, any>) || {};
    await adapter.initialize(config);

    this.activeAdapters.set(cameraId, adapter);
    return adapter;
  }

  public async startCamera(cameraId: string): Promise<CameraDiagnostics> {
    const camera = await this.getCamera(cameraId);
    const adapter = await this.getOrCreateAdapter(cameraId);

    try {
      await adapter.start();

      await this.db.camera.update({
        where: { id: cameraId },
        data: {
          healthStatus: CameraHealthStatus.ONLINE,
          lastSeenAt: new Date(),
        },
      });

      return adapter.getDiagnostics();
    } catch (err: any) {
      await this.db.camera.update({
        where: { id: cameraId },
        data: {
          healthStatus: CameraHealthStatus.DEGRADED,
        },
      });
      throw err;
    }
  }

  public async stopCamera(cameraId: string): Promise<CameraDiagnostics> {
    const adapter = this.activeAdapters.get(cameraId);
    if (adapter) {
      await adapter.stop();
    }

    await this.db.camera.update({
      where: { id: cameraId },
      data: {
        healthStatus: CameraHealthStatus.OFFLINE,
      },
    });

    if (adapter) {
      return adapter.getDiagnostics();
    }

    return {
      cameraId,
      sourceType: CameraSourceType.WEBCAM,
      isActive: false,
      healthStatus: CameraHealthStatus.OFFLINE,
      lastSeenAt: null,
      fps: 0,
      totalFramesCaptured: 0,
      lastError: null,
    };
  }

  public async captureSnapshot(cameraId: string): Promise<CameraFrame> {
    const adapter = await this.getOrCreateAdapter(cameraId);
    const frame = await adapter.captureSnapshot();

    await this.db.camera.update({
      where: { id: cameraId },
      data: {
        healthStatus: CameraHealthStatus.ONLINE,
        lastSeenAt: new Date(),
      },
    });

    return frame;
  }

  public async subscribeToStream(
    cameraId: string,
    listener: (frame: CameraFrame) => void
  ): Promise<() => void> {
    const adapter = await this.getOrCreateAdapter(cameraId);
    if (!adapter.isActive()) {
      await this.startCamera(cameraId);
    }
    return adapter.onFrame(listener);
  }

  public async getDiagnostics(cameraId: string): Promise<CameraDiagnostics> {
    const adapter = this.activeAdapters.get(cameraId);
    if (adapter) {
      return adapter.getDiagnostics();
    }

    const camera = await this.getCamera(cameraId);
    return {
      cameraId: camera.id,
      sourceType: camera.sourceType,
      isActive: false,
      healthStatus: camera.healthStatus,
      lastSeenAt: camera.lastSeenAt,
      fps: 0,
      totalFramesCaptured: 0,
      lastError: null,
    };
  }

  public async releaseCamera(cameraId: string): Promise<void> {
    const adapter = this.activeAdapters.get(cameraId);
    if (adapter) {
      await adapter.disconnect();
      this.activeAdapters.delete(cameraId);
    }
  }

  public async shutdownAll(): Promise<void> {
    for (const [id, adapter] of this.activeAdapters.entries()) {
      try {
        await adapter.disconnect();
      } catch (err) {
        console.error(`Error disconnecting camera adapter '${id}':`, err);
      }
    }
    this.activeAdapters.clear();
  }
}
