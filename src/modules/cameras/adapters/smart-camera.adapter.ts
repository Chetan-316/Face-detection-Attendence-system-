import { CameraHealthStatus, CameraSourceType } from '@prisma/client';
import { CameraCapabilities, CameraFrame } from '../camera.types';
import { BaseCameraAdapter } from './base.adapter';

export interface SmartCameraConfig {
  endpoint?: string;
  webhookSecret?: string;
  deviceSerialNumber?: string;
  [key: string]: any;
}

/**
 * Smart AI Camera Adapter (Extensible Foundation).
 * For edge cameras with onboard processing pushing frames or events.
 */
export class SmartCameraAdapter extends BaseCameraAdapter {
  public readonly sourceType = CameraSourceType.SMART_CAMERA;
  private active: boolean = false;
  private listeners: Set<(frame: CameraFrame) => void> = new Set();
  private latestFrame: CameraFrame | null = null;

  constructor(cameraId: string) {
    super(cameraId);
  }

  public async initialize(config: SmartCameraConfig = {}): Promise<void> {
    this.config = { ...config };
    this.active = false;
  }

  public async start(): Promise<void> {
    this.active = true;
  }

  public async stop(): Promise<void> {
    this.active = false;
  }

  public isActive(): boolean {
    return this.active;
  }

  public async captureSnapshot(): Promise<CameraFrame> {
    if (!this.latestFrame) {
      throw new Error('Smart camera snapshot not available');
    }
    return this.latestFrame;
  }

  public async getHealth(): Promise<CameraHealthStatus> {
    return this.active ? CameraHealthStatus.ONLINE : CameraHealthStatus.OFFLINE;
  }

  public getCapabilities(): CameraCapabilities {
    return {
      supportsLiveStreaming: true,
      supportsSnapshot: true,
      supportsHardwareRecognition: true,
      maxFps: 30,
    };
  }

  public getLatestFrame(): CameraFrame | null {
    return this.latestFrame;
  }

  public onFrame(listener: (frame: CameraFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async disconnect(): Promise<void> {
    await this.stop();
    this.listeners.clear();
    this.latestFrame = null;
  }
}
