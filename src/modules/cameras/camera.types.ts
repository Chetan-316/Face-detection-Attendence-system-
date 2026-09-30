import { CameraSourceType, CameraRole, CameraHealthStatus } from '@prisma/client';

export interface CameraFrame {
  timestamp: Date;
  cameraId: string;
  sourceType: CameraSourceType;
  frameBuffer?: Buffer;
  format?: string; // e.g. 'image/jpeg'
  width?: number;
  height?: number;
  sequence?: number;
  metadata?: Record<string, any>;
}

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
  lastSeenAt: Date | null;
  fps: number;
  totalFramesCaptured: number;
  resolution?: { width: number; height: number };
  lastError: string | null;
}

/**
 * Universal interface for camera adapters (Webcam, RTSP, Smart AI Camera).
 * Allows future interchangeable integration without altering business logic.
 */
export interface ICameraAdapter {
  readonly sourceType: CameraSourceType;
  readonly cameraId: string;

  initialize(config: Record<string, any>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
  captureSnapshot(): Promise<CameraFrame>;
  getHealth(): Promise<CameraHealthStatus>;
  getLastError(): string | null;
  getCapabilities(): CameraCapabilities;
  getDiagnostics(): CameraDiagnostics;
  getLatestFrame(): CameraFrame | null;
  onFrame(listener: (frame: CameraFrame) => void): () => void;
  onHealthChange?(listener: (status: CameraHealthStatus, error?: string | null) => void): () => void;
  disconnect(): Promise<void>;
}
