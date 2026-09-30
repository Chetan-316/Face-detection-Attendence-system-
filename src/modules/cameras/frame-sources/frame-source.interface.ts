import { CameraFrame } from '../camera.types';

export type FrameSourceState = 'CONNECTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE';

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
  getState(): FrameSourceState;
  getHealth?(): string;
  getLastError(): string | null;
  getLatestFrame(): CameraFrame | null;
  captureSnapshot(): Promise<CameraFrame>;
  onFrame(listener: (frame: CameraFrame) => void): () => void;
  onStateChange?(listener: (state: FrameSourceState, error?: string | null) => void): () => void;
  destroy(): Promise<void>;
}

