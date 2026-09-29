export type CameraSourceType = 'WEBCAM' | 'RTSP' | 'SMART_CAMERA';
export type CameraRole = 'GENERAL' | 'IN' | 'OUT' | 'ATTENDANCE';
export type CameraHealthStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';

export interface CameraCapabilities {
  supportsLiveStreaming: boolean;
  supportsSnapshot: boolean;
  supportsHardwareRecognition: boolean;
  maxFps: number;
}

export interface CameraDiagnostics {
  cameraId: string;
  sourceType: CameraSourceType;
  isActive: boolean;
  healthStatus: CameraHealthStatus;
  lastSeenAt: string | null;
  fps: number;
  totalFramesCaptured: number;
  resolution?: { width: number; height: number };
  lastError: string | null;
}

export interface CameraEntity {
  id: string;
  organizationId: string;
  hostelId: string;
  locationId?: string | null;
  name: string;
  sourceType: CameraSourceType;
  role: CameraRole;
  isEnabled: boolean;
  healthStatus: CameraHealthStatus;
  lastSeenAt: string | null;
  configMetadata?: Record<string, any>;
  location?: {
    id: string;
    code: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  isStreaming?: boolean;
  fps?: number;
  diagnostics?: CameraDiagnostics;
}

export interface CreateCameraPayload {
  name: string;
  sourceType: CameraSourceType;
  role?: CameraRole;
  locationId?: string | null;
  hostelId?: string;
  isEnabled?: boolean;
  configMetadata?: Record<string, any>;
}

export interface UpdateCameraPayload {
  name?: string;
  locationId?: string | null;
  role?: CameraRole;
  isEnabled?: boolean;
  configMetadata?: Record<string, any>;
}
