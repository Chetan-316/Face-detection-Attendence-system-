import { CameraSourceType, CameraRole, CameraHealthStatus } from '@prisma/client';

export interface CameraFrame {
  timestamp: Date;
  cameraId: string;
  sourceType: CameraSourceType;
  frameBuffer?: Buffer;
  metadata?: Record<string, any>;
}

export interface CameraCapabilities {
  supportsLiveStreaming: boolean;
  supportsSnapshot: boolean;
  supportsHardwareRecognition: boolean;
  maxFps: number;
}

/**
 * Universal interface for camera adapters (Webcam, RTSP, Smart AI Camera).
 * Allows future interchangeable integration without altering business logic.
 */
export interface ICameraAdapter {
  readonly sourceType: CameraSourceType;
  initialize(config: Record<string, any>): Promise<void>;
  captureSnapshot(): Promise<CameraFrame>;
  getHealth(): Promise<CameraHealthStatus>;
  getCapabilities(): CameraCapabilities;
  disconnect(): Promise<void>;
}
