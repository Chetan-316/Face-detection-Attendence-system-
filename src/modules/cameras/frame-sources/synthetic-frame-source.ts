import { CameraHealthStatus, CameraSourceType } from '@prisma/client';
import { CameraFrame } from '../camera.types';
import { FrameSourceConfig, IFrameSource } from './frame-source.interface';

// 640x480 PRAVAHAx Test Pattern JPEG (Base64)
const TEST_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJ' +
  'ChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/' +
  '2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo' +
  'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAA8AFAreasDAQACEQEDEQH/' +
  'xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQIF/8QAJRAAAQIGAgIDAQAAAAAAAAAAA' +
  'QACAxEhMVKxBBNREkFhkdL/xAAWAQEBAQAAAAAAAAAAAAAAAAAAAQL/xAAbE' +
  'QEAAwEBAQEAAAAAAAAAAAABAAIRITEyQf/aAAwDAQACEQMRAD8A9mS8C0sI' +
  '0qFpqhKsqGsqyqKsqyrKsqyrKsKioa4VlcUdVxVlWVZQ1xVlWVRVlWVxVlX' +
  'UdVxVlWVZQ1wrK4oz71ZVVXFXFWVRXxVleVZVVfFXlWVVXxV5VlcUdVxVle' +
  'VZVVxVlWVZQ1wrK4oz71ZVVXFXFWVRXxVleVZVVfFXlWVVXxV5VlcUdVxVl' +
  'eVZVVxVlWVZQ1wrK4o6rqsqsq/9k=';

export class SyntheticFrameSource implements IFrameSource {
  private cameraId: string = '';
  private width: number = 640;
  private height: number = 480;
  private fps: number = 15;
  private active: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Set<(frame: CameraFrame) => void> = new Set();
  private latestFrame: CameraFrame | null = null;
  private sequence: number = 0;
  private health: CameraHealthStatus = CameraHealthStatus.OFFLINE;
  private lastError: string | null = null;
  private sampleFrameBuffer: Buffer = Buffer.from(TEST_JPEG_BASE64, 'base64');

  public async initialize(config: FrameSourceConfig): Promise<void> {
    this.cameraId = config.cameraId;
    this.width = config.width || 640;
    this.height = config.height || 480;
    this.fps = config.fps || 15;
    this.health = CameraHealthStatus.OFFLINE;
    this.lastError = null;
  }

  public async start(): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    this.health = CameraHealthStatus.ONLINE;
    this.lastError = null;

    const intervalMs = Math.max(20, Math.floor(1000 / this.fps));
    this.timer = setInterval(() => {
      this.generateAndEmitFrame();
    }, intervalMs);

    // Immediately generate first frame
    this.generateAndEmitFrame();
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.active = false;
    this.health = CameraHealthStatus.OFFLINE;
  }

  public isActive(): boolean {
    return this.active;
  }

  public getHealth(): CameraHealthStatus {
    return this.health;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getLatestFrame(): CameraFrame | null {
    return this.latestFrame;
  }

  public async captureSnapshot(): Promise<CameraFrame> {
    this.generateAndEmitFrame();
    if (!this.latestFrame) {
      throw new Error('Failed to capture snapshot from synthetic frame source');
    }
    return this.latestFrame;
  }

  public onFrame(listener: (frame: CameraFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async destroy(): Promise<void> {
    await this.stop();
    this.listeners.clear();
    this.latestFrame = null;
  }

  /**
   * For testing failure recovery scenarios.
   */
  public simulateError(message: string, status: CameraHealthStatus = CameraHealthStatus.DEGRADED): void {
    this.health = status;
    this.lastError = message;
  }

  private generateAndEmitFrame(): void {
    this.sequence++;
    const frame: CameraFrame = {
      timestamp: new Date(),
      cameraId: this.cameraId,
      sourceType: CameraSourceType.WEBCAM,
      frameBuffer: this.sampleFrameBuffer,
      format: 'image/jpeg',
      width: this.width,
      height: this.height,
      sequence: this.sequence,
      metadata: {
        generator: 'SyntheticFrameSource',
        synthetic: true,
      },
    };

    this.latestFrame = frame;

    for (const listener of this.listeners) {
      try {
        listener(frame);
      } catch (err) {
        console.error('[SyntheticFrameSource] Error in frame listener:', err);
      }
    }
  }
}
