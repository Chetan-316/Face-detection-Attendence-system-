import { CameraHealthStatus, CameraSourceType } from '@prisma/client';
import { CameraCapabilities, CameraFrame } from '../camera.types';
import { BaseCameraAdapter } from './base.adapter';
import { IFrameSource } from '../frame-sources/frame-source.interface';
import { RtspFrameSource, RtspFrameSourceConfig } from '../frame-sources/rtsp-frame-source';

export interface RtspAdapterConfig {
  rtspUrl?: string;
  transport?: 'tcp' | 'udp';
  username?: string;
  password?: string;
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
  connectTimeoutMs?: number;
  reconnectEnabled?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  testInputOverride?: string;
  [key: string]: any;
}

/**
 * RTSP Network Camera Adapter for IP/PoE cameras.
 * Emits standard JPEG CameraFrame objects consumed identically downstream by
 * CameraService, preview streaming, and RecognitionService.
 */
export class RtspAdapter extends BaseCameraAdapter {
  public readonly sourceType = CameraSourceType.RTSP;
  private frameSource: IFrameSource | null = null;
  private unsubscribeInternalMetrics: (() => void) | null = null;

  constructor(cameraId: string) {
    super(cameraId);
  }

  public async initialize(config: RtspAdapterConfig = {}): Promise<void> {
    this.config = {
      transport: 'tcp',
      fps: 15,
      quality: 80,
      connectTimeoutMs: 10000,
      reconnectEnabled: true,
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 15000,
      ...config,
    };

    // If re-initializing existing adapter, cleanly disconnect previous frame source
    if (this.frameSource) {
      await this.disconnect();
    }

    const frameSource = new RtspFrameSource();
    await frameSource.initialize({
      cameraId: this.cameraId,
      rtspUrl: this.config.rtspUrl || '',
      transport: this.config.transport,
      username: this.config.username,
      password: this.config.password,
      width: this.config.width,
      height: this.config.height,
      fps: this.config.fps,
      quality: this.config.quality,
      connectTimeoutMs: this.config.connectTimeoutMs,
      reconnectEnabled: this.config.reconnectEnabled,
      reconnectDelayMs: this.config.reconnectDelayMs,
      maxReconnectDelayMs: this.config.maxReconnectDelayMs,
      testInputOverride: this.config.testInputOverride,
    });

    this.frameSource = frameSource;

    // Track internal metrics (FPS, resolution, lastSeenAt, totalFrames)
    this.unsubscribeInternalMetrics = this.frameSource.onFrame((frame: CameraFrame) => {
      this.recordFrameIngestion(frame);
    });
  }

  public async start(): Promise<void> {
    if (!this.frameSource) {
      await this.initialize(this.config);
    }

    try {
      this.lastError = null;
      await this.frameSource!.start();
    } catch (err: any) {
      this.lastError = err.message || 'Failed to connect to RTSP camera';
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (this.frameSource) {
      await this.frameSource.stop();
    }
  }

  public isActive(): boolean {
    return this.frameSource ? this.frameSource.isActive() : false;
  }

  public async captureSnapshot(): Promise<CameraFrame> {
    if (!this.frameSource) {
      await this.initialize(this.config);
    }
    return this.frameSource!.captureSnapshot();
  }

  public async getHealth(): Promise<CameraHealthStatus> {
    if (!this.frameSource) {
      return CameraHealthStatus.OFFLINE;
    }
    const sourceHealth = this.frameSource.getHealth();
    const sourceErr = this.frameSource.getLastError();
    if (sourceErr) {
      this.lastError = sourceErr;
    }
    return sourceHealth;
  }

  public getCapabilities(): CameraCapabilities {
    return {
      supportsLiveStreaming: true,
      supportsSnapshot: true,
      supportsHardwareRecognition: false,
      maxFps: this.config.fps || 25,
    };
  }

  public getLatestFrame(): CameraFrame | null {
    return this.frameSource ? this.frameSource.getLatestFrame() : null;
  }

  public onFrame(listener: (frame: CameraFrame) => void): () => void {
    if (!this.frameSource) {
      throw new Error('RTSP Camera adapter is not initialized');
    }
    return this.frameSource.onFrame(listener);
  }

  public async disconnect(): Promise<void> {
    if (this.unsubscribeInternalMetrics) {
      this.unsubscribeInternalMetrics();
      this.unsubscribeInternalMetrics = null;
    }

    if (this.frameSource) {
      await this.frameSource.destroy();
      this.frameSource = null;
    }

    this.currentFps = 0;
  }
}
