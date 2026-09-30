import { Camera } from '@prisma/client';
import { CameraDiagnostics } from '../camera.types';
import { sanitizeCameraConfig } from './url-redaction';

export interface SafeCameraDto {
  id: string;
  organizationId: string;
  hostelId: string;
  locationId: string | null;
  name: string;
  sourceType: string;
  role: string;
  isEnabled: boolean;
  healthStatus: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  location?: any;
  configMetadata: Record<string, any>;
  isStreaming?: boolean;
  fps?: number;
  diagnostics?: CameraDiagnostics | null;
}

/**
 * Transforms a raw Camera model into a safe DTO, stripping sensitive credentials
 * and masking RTSP URLs before emitting to clients or logging.
 */
export function toSafeCameraDto(
  camera: Camera & { location?: any },
  diagnostics?: CameraDiagnostics | null
): SafeCameraDto {
  const safeConfig = sanitizeCameraConfig(
    (camera.configMetadata as Record<string, any>) || {}
  );

  return {
    id: camera.id,
    organizationId: camera.organizationId,
    hostelId: camera.hostelId,
    locationId: camera.locationId,
    name: camera.name,
    sourceType: camera.sourceType,
    role: camera.role,
    isEnabled: camera.isEnabled,
    healthStatus: diagnostics?.healthStatus ?? camera.healthStatus,
    lastSeenAt:
      diagnostics?.lastSeenAt && (!camera.lastSeenAt || new Date(diagnostics.lastSeenAt) > new Date(camera.lastSeenAt))
        ? diagnostics.lastSeenAt
        : camera.lastSeenAt,
    createdAt: camera.createdAt,
    updatedAt: camera.updatedAt,
    location: camera.location,
    configMetadata: safeConfig,
    isStreaming: diagnostics ? diagnostics.isActive : undefined,
    fps: diagnostics ? diagnostics.fps : undefined,
    diagnostics: diagnostics || undefined,
  };
}
