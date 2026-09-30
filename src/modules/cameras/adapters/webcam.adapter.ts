import { CameraHealthStatus, CameraSourceType } from '@prisma/client';
import { CameraCapabilities, CameraFrame } from '../camera.types';
import { BaseCameraAdapter } from './base.adapter';
import { IFrameSource } from '../frame-sources/frame-source.interface';
import { OpenCvFrameSource } from '../frame-sources/opencv-frame-source';
import { SyntheticFrameSource } from '../frame-sources/synthetic-frame-source';

export interface WebcamAdapterConfig {
  deviceIndex?: number;
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
  backend?: 'auto' | 'opencv' | 'synthetic';
  [key: string]: any;
}

export class WebcamAdapter extends BaseCameraAdapter {
  public readonly sourceType = CameraSourceType.WEBCAM;
  private frameSource: IFrameSource | null = null;
  private unsubscribeFrameListener: (() => void) | null = null;

  constructor(cameraId: string) {
    super(cameraId);
  }

  public async initialize(config: WebcamAdapterConfig = {}): Promise<void> {
    this.config = {
      deviceIndex: 0,
      width: 640,
      height: 480,
      fps: 15,
      quality: 80,
      backend: 'auto',
      ...config,
    };

    // Clean up existing frame source if re-initializing
    if (this.frameSource) {
      await this.disconnect();
    }

    const backend = this.config.backend;
    const isTestEnv = process.env.NODE_ENV === 'test';

    // In automated testing environments, default to SyntheticFrameSource unless explicitly overridden
    if (backend === 'synthetic' || (backend === 'auto' && isTestEnv)) {
      this.frameSource = new SyntheticFrameSource();
    } else {
      this.frameSource = new OpenCvFrameSource();
    }

    await this.frameSource.initialize({
      cameraId: this.cameraId,
      deviceIndex: this.config.deviceIndex,
      width: this.config.width,
      height: this.config.height,
      fps: this.config.fps,
      quality: this.config.quality,
    });

    // Subscribe internal metrics tracking
    this.unsubscribeFrameListener = this.frameSource.onFrame((frame: CameraFrame) => {
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
      this.lastError = err.message || 'Failed to start webcam capture';

      // Fallback: If opencv failed because device is unavailable and backend was auto, we record error
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
    const state = this.frameSource.getState?.() || 'OFFLINE';
    let sourceHealth: CameraHealthStatus = CameraHealthStatus.OFFLINE;
    if (state === 'ONLINE') sourceHealth = CameraHealthStatus.ONLINE;
    else if (state === 'DEGRADED') sourceHealth = CameraHealthStatus.DEGRADED;

    const sourceError = this.frameSource.getLastError();
    if (sourceError) {
      this.lastError = sourceError;
    }
    return sourceHealth;
  }

  public getCapabilities(): CameraCapabilities {
    return {
      supportsLiveStreaming: true,
      supportsSnapshot: true,
      supportsHardwareRecognition: false,
      maxFps: this.config.fps || 30,
    };
  }

  public getLatestFrame(): CameraFrame | null {
    return this.frameSource ? this.frameSource.getLatestFrame() : null;
  }

  public onFrame(listener: (frame: CameraFrame) => void): () => void {
    if (!this.frameSource) {
      throw new Error('Camera adapter is not initialized');
    }
    return this.frameSource.onFrame(listener);
  }

  public async disconnect(): Promise<void> {
    if (this.unsubscribeFrameListener) {
      this.unsubscribeFrameListener();
      this.unsubscribeFrameListener = null;
    }

    if (this.frameSource) {
      await this.frameSource.destroy();
      this.frameSource = null;
    }

    this.currentFps = 0;
  }
}
