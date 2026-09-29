import { CameraHealthStatus } from '@prisma/client';
import { CameraFrame } from '../camera.types';

export interface FrameSourceConfig {
  cameraId: string;
  deviceIndex?: number;
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
  [key: string]: any;
}

export interface IFrameSource {
  initialize(config: FrameSourceConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
  getHealth(): CameraHealthStatus;
  getLastError(): string | null;
  getLatestFrame(): CameraFrame | null;
  captureSnapshot(): Promise<CameraFrame>;
  onFrame(listener: (frame: CameraFrame) => void): () => void;
  destroy(): Promise<void>;
}
