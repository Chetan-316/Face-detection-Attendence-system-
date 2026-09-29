import { CameraHealthStatus, CameraSourceType } from '@prisma/client';
import {
  CameraCapabilities,
  CameraDiagnostics,
  CameraFrame,
  ICameraAdapter,
} from '../camera.types';

export abstract class BaseCameraAdapter implements ICameraAdapter {
  public abstract readonly sourceType: CameraSourceType;
  public readonly cameraId: string;

  protected config: Record<string, any> = {};
  protected totalFrames: number = 0;
  protected lastSeenAt: Date | null = null;
  protected lastError: string | null = null;
  protected currentFps: number = 0;
  protected currentResolution?: { width: number; height: number };

  // FPS calculation window
  private frameTimestamps: number[] = [];

  constructor(cameraId: string) {
    this.cameraId = cameraId;
  }

  public abstract initialize(config: Record<string, any>): Promise<void>;
  public abstract start(): Promise<void>;
  public abstract stop(): Promise<void>;
  public abstract isActive(): boolean;
  public abstract captureSnapshot(): Promise<CameraFrame>;
  public abstract getHealth(): Promise<CameraHealthStatus>;
  public abstract getCapabilities(): CameraCapabilities;
  public abstract getLatestFrame(): CameraFrame | null;
  public abstract onFrame(listener: (frame: CameraFrame) => void): () => void;
  public abstract disconnect(): Promise<void>;

  public getLastError(): string | null {
    return this.lastError;
  }

  public getDiagnostics(): CameraDiagnostics {
    let health: CameraHealthStatus = CameraHealthStatus.UNKNOWN;
    try {
      // Synchronous best-effort health snapshot
      health = this.isActive() ? CameraHealthStatus.ONLINE : CameraHealthStatus.OFFLINE;
      if (this.lastError) {
        health = CameraHealthStatus.DEGRADED;
      }
    } catch {}

    return {
      cameraId: this.cameraId,
      sourceType: this.sourceType,
      isActive: this.isActive(),
      healthStatus: health,
      lastSeenAt: this.lastSeenAt,
      fps: this.currentFps,
      totalFramesCaptured: this.totalFrames,
      resolution: this.currentResolution,
      lastError: this.lastError,
    };
  }

  protected recordFrameIngestion(frame: CameraFrame): void {
    this.totalFrames++;
    this.lastSeenAt = frame.timestamp;
    if (frame.width && frame.height) {
      this.currentResolution = { width: frame.width, height: frame.height };
    }

    const now = Date.now();
    this.frameTimestamps.push(now);

    // Keep only timestamps from the last 1.5 seconds to compute current FPS
    const windowStart = now - 1500;
    this.frameTimestamps = this.frameTimestamps.filter((ts) => ts >= windowStart);

    if (this.frameTimestamps.length > 1) {
      const timeSpanSec = (now - this.frameTimestamps[0]) / 1000;
      this.currentFps = timeSpanSec > 0 ? Math.round((this.frameTimestamps.length / timeSpanSec) * 10) / 10 : 0;
    } else {
      this.currentFps = 0;
    }
  }
}
