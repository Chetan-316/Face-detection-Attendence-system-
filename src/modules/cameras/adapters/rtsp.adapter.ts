import { CameraHealthStatus, CameraSourceType } from '@prisma/client';
import { CameraCapabilities, CameraFrame } from '../camera.types';
import { BaseCameraAdapter } from './base.adapter';

export interface RtspAdapterConfig {
  rtspUrl?: string;
  transport?: 'tcp' | 'udp';
  username?: string;
  password?: string;
  [key: string]: any;
}

/**
 * RTSP Network Camera Adapter (Extensible Foundation).
 * Designed for IP cameras at hostel gates/corridors.
 */
export class RtspAdapter extends BaseCameraAdapter {
  public readonly sourceType = CameraSourceType.RTSP;
  private active: boolean = false;
  private listeners: Set<(frame: CameraFrame) => void> = new Set();
  private latestFrame: CameraFrame | null = null;

  constructor(cameraId: string) {
    super(cameraId);
  }

  public async initialize(config: RtspAdapterConfig = {}): Promise<void> {
    this.config = {
      transport: 'tcp',
      ...config,
    };
    this.active = false;
  }

  public async start(): Promise<void> {
    if (!this.config.rtspUrl) {
      throw new Error('RTSP stream URL is required for RTSP camera adapter');
    }
    // Future implementation: spawn ffmpeg / gstreamer / live555 pipeline to consume RTSP stream
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
      throw new Error('RTSP snapshot not available: camera is offline or deferred');
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
      supportsHardwareRecognition: false,
      maxFps: 25,
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
