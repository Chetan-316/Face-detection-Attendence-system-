import { spawn, ChildProcess } from 'child_process';
import { CameraFrame } from '../camera.types';
import { FrameSourceConfig, FrameSourceState, IFrameSource } from './frame-source.interface';
import { getFfmpegPath } from '../utils/ffmpeg-locator';
import { redactRtspUrl, buildAuthenticatedRtspUrl } from '../utils/url-redaction';

const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB maximum parser accumulation buffer

/**
 * Extracts width and height from a JPEG buffer by scanning for SOF0/SOF1/SOF2 markers.
 */
function extractJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    let offset = 2; // Skip initial 0xFF, 0xD8 (SOI)
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marker = buffer[offset + 1];
      // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }

      // Standalone markers without length: RST0-7, SOI, EOI, TEM
      if (
        (marker >= 0xd0 && marker <= 0xd7) ||
        marker === 0xd8 ||
        marker === 0xd9 ||
        marker === 0x01
      ) {
        offset += 2;
        continue;
      }

      // Marker segment with length
      if (offset + 4 <= buffer.length) {
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      } else {
        break;
      }
    }
  } catch {}

  return null;
}

export interface RtspFrameSourceConfig extends FrameSourceConfig {
  rtspUrl: string;
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
  testInputOverride?: string; // Used for automated synthetic integration tests (e.g. lavfi testsrc)
  realtimePacing?: boolean; // When true, passes -re to FFmpeg for paced playback
}

export class RtspFrameSource implements IFrameSource {
  private cameraId: string = '';
  private rawRtspUrl: string = '';
  private authenticatedUrl: string = '';
  private transport: 'tcp' | 'udp' = 'tcp';
  private width?: number;
  private height?: number;
  private fps: number = 15;
  private quality: number = 80;
  private connectTimeoutMs: number = 10000;
  private reconnectEnabled: boolean = true;
  private reconnectDelayMs: number = 1000;
  private maxReconnectDelayMs: number = 15000;
  private testInputOverride?: string;
  private realtimePacing: boolean = false;

  private ffmpegProcess: ChildProcess | null = null;
  private active: boolean = false;
  private manualStop: boolean = false;
  private state: FrameSourceState = 'OFFLINE';
  private stateListeners: Set<(state: FrameSourceState, error?: string | null) => void> = new Set();
  private lastError: string | null = null;
  private isCapturingEphemeralSnapshot: boolean = false;

  private buffer: Buffer = Buffer.alloc(0);
  private latestFrame: CameraFrame | null = null;
  private sequence: number = 0;
  private listeners: Set<(frame: CameraFrame) => void> = new Set();

  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stderrRingBuffer: string[] = [];

  public getState(): FrameSourceState {
    return this.state;
  }

  public getHealth(): string {
    return this.state;
  }

  public onStateChange(listener: (state: FrameSourceState, error?: string | null) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private setState(newState: FrameSourceState, error?: string | null): void {
    const changed = this.state !== newState || (error && error !== this.lastError);
    this.state = newState;
    if (error !== undefined) {
      this.lastError = error;
    }
    if (changed && !this.isCapturingEphemeralSnapshot) {
      for (const listener of this.stateListeners) {
        try {
          listener(newState, this.lastError);
        } catch (err) {
          console.error('[RtspFrameSource] Error in state listener:', err);
        }
      }
    }
  }

  public async initialize(config: RtspFrameSourceConfig): Promise<void> {
    if (!config.rtspUrl && !config.testInputOverride) {
      throw new Error('RTSP URL is required to initialize RTSP frame source');
    }

    this.cameraId = config.cameraId;
    this.rawRtspUrl = config.rtspUrl || '';
    this.testInputOverride = config.testInputOverride;
    this.realtimePacing = Boolean(config.realtimePacing);
    this.authenticatedUrl = buildAuthenticatedRtspUrl(
      this.rawRtspUrl,
      config.username,
      config.password
    );

    this.transport = config.transport === 'udp' ? 'udp' : 'tcp';
    this.width = config.width;
    this.height = config.height;
    this.fps = config.fps && config.fps > 0 ? config.fps : 15;
    this.quality = config.quality && config.quality > 0 ? config.quality : 80;
    this.connectTimeoutMs = config.connectTimeoutMs ?? 10000;
    this.reconnectEnabled = config.reconnectEnabled !== false;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = config.maxReconnectDelayMs ?? 15000;

    this.manualStop = false;
    this.setState('OFFLINE', null);
  }

  public async start(): Promise<void> {
    if (this.active && this.ffmpegProcess) {
      return;
    }

    this.manualStop = false;
    this.clearReconnectTimer();

    return new Promise<void>((resolve, reject) => {
      let isSettled = false;
      const ffmpegPath = getFfmpegPath();

      // Build FFmpeg process arguments
      const args: string[] = [];

      if (this.testInputOverride) {
        // Synthetic test generator pattern
        if (this.realtimePacing) {
          args.push('-re');
        }
        args.push(
          '-f', 'lavfi',
          '-i', this.testInputOverride,
          '-an',
          '-sn'
        );
      } else {
        // Standard RTSP Network Camera
        args.push(
          '-rtsp_transport', this.transport,
          '-analyzeduration', '1000000',
          '-probesize', '1000000',
          '-fflags', 'nobuffer',
          '-flags', 'low_delay',
          '-i', this.authenticatedUrl,
          '-an',
          '-sn'
        );
      }

      // Video filters (downscale if configured + target decoding FPS)
      const filterParts: string[] = [];
      if (this.width && this.height) {
        filterParts.push(`scale=${this.width}:${this.height}`);
      }
      filterParts.push(`fps=${this.fps}`);

      args.push('-vf', filterParts.join(','));
      args.push(
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-q:v', String(Math.max(2, Math.min(31, Math.round(31 - (this.quality * 29) / 100)))),
        'pipe:1'
      );

      this.setState('CONNECTING', null);

      try {
        this.ffmpegProcess = spawn(ffmpegPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err: any) {
        this.lastError = `Failed to spawn FFmpeg process: ${err.message}`;
        this.setState('OFFLINE', this.lastError);
        return reject(new Error(this.lastError));
      }

      this.active = true;
      this.buffer = Buffer.alloc(0);
      this.stderrRingBuffer = [];

      // Set first-frame arrival timeout
      const startupTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          const parsedErr = this.extractFriendlyStderrMessage();
          this.lastError =
            parsedErr ||
            'Unable to receive video from this camera. Check camera address, credentials, network connection and RTSP settings.';
          this.setState('OFFLINE', this.lastError);
          this.terminateSubprocess();
          reject(new Error(this.lastError));
        }
      }, this.connectTimeoutMs);

      // Handle decoded stdout (JPEG image2pipe stream)
      this.ffmpegProcess.stdout?.on('data', (chunk: Buffer) => {
        this.handleStdoutChunk(chunk);

        // First valid frame arrival settles the start promise
        if (!isSettled && this.latestFrame) {
          isSettled = true;
          clearTimeout(startupTimer);
          this.lastError = null;
          this.setState('ONLINE', null);
          this.reconnectAttempts = 0;
          resolve();
        }
      });

      // Handle stderr diagnostic output
      this.ffmpegProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = redactRtspUrl(chunk.toString('utf-8'));
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          this.stderrRingBuffer.push(line);
          if (this.stderrRingBuffer.length > 50) {
            this.stderrRingBuffer.shift();
          }
        }
      });

      // Process error handler
      this.ffmpegProcess.on('error', (err: Error) => {
        this.lastError = `FFmpeg error: ${err.message}`;
        this.setState('OFFLINE', this.lastError);
        if (!isSettled) {
          isSettled = true;
          clearTimeout(startupTimer);
          reject(new Error(this.lastError));
        }
      });

      // Process exit handler
      this.ffmpegProcess.on('exit', (code, signal) => {
        const wasActive = this.active;
        this.active = false;
        this.ffmpegProcess = null;

        if (this.manualStop) {
          // Manual operator stop -> do not reconnect
          this.setState('OFFLINE', null);
          return;
        }

        // Unexpected exit while camera was active -> schedule reconnect
        const friendlyErr = this.extractFriendlyStderrMessage();
        this.lastError =
          friendlyErr ||
          `Camera connection lost (process exited with code ${code}${signal ? `, signal ${signal}` : ''})`;
        this.setState('DEGRADED', this.lastError);

        if (!isSettled && wasActive) {
          isSettled = true;
          clearTimeout(startupTimer);
          reject(new Error(this.lastError));
          return;
        }

        if (this.reconnectEnabled && !this.manualStop) {
          this.scheduleReconnect();
        }
      });
    });
  }

  public async stop(): Promise<void> {
    this.manualStop = true;
    this.active = false;
    this.clearReconnectTimer();
    this.terminateSubprocess();
    this.setState('OFFLINE', null);
    this.buffer = Buffer.alloc(0);
  }

  public isActive(): boolean {
    return this.active && this.ffmpegProcess !== null;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getLatestFrame(): CameraFrame | null {
    return this.latestFrame;
  }

  public async captureSnapshot(): Promise<CameraFrame> {
    const wasActive = this.isActive();

    // 1. If camera is already streaming and has a latest frame, return it immediately
    if (wasActive && this.latestFrame) {
      return this.latestFrame;
    }

    // 2. If camera is not active, preserve operator state: start temporarily, capture frame, and stop
    if (!wasActive) {
      this.isCapturingEphemeralSnapshot = true;
      try {
        await this.start();
        if (this.latestFrame) {
          const frame = this.latestFrame;
          await this.stop();
          return frame;
        }

        const frame = await new Promise<CameraFrame>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for RTSP camera frame snapshot'));
          }, Math.min(5000, this.connectTimeoutMs));

          const unsubscribe = this.onFrame((f) => {
            clearTimeout(timeout);
            unsubscribe();
            resolve(f);
          });
        });

        await this.stop();
        return frame;
      } catch (err) {
        await this.stop().catch(() => {});
        throw err;
      } finally {
        this.isCapturingEphemeralSnapshot = false;
      }
    }

    // 3. If camera is active but latestFrame not yet populated, wait for frame without stopping
    return new Promise<CameraFrame>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for RTSP camera frame snapshot'));
      }, 5000);

      const unsubscribe = this.onFrame((frame) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(frame);
      });
    });
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
    this.stateListeners.clear();
    this.latestFrame = null;
    this.buffer = Buffer.alloc(0);
    this.stderrRingBuffer = [];
  }

  /**
   * Safe chunk parser splitting image2pipe MJPEG frames via SOI (0xFFD8) and EOI (0xFFD9).
   */
  private handleStdoutChunk(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // Prevent unbounded memory growth if stream sends malformed or non-JPEG data
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = Buffer.alloc(0);
      this.lastError = 'RTSP parser buffer exceeded threshold (10MB); buffer reset';
      this.setState('DEGRADED', this.lastError);
      return;
    }

    while (this.buffer.length >= 4) {
      // Find Start of Image (SOI)
      const soiIndex = this.buffer.indexOf(JPEG_SOI);
      if (soiIndex === -1) {
        // No SOI found; preserve last byte in case 0xFF is split across chunks
        const keepLength = this.buffer[this.buffer.length - 1] === 0xff ? 1 : 0;
        this.buffer = this.buffer.subarray(this.buffer.length - keepLength);
        break;
      }

      // Discard any junk before SOI
      if (soiIndex > 0) {
        this.buffer = this.buffer.subarray(soiIndex);
      }

      // Find End of Image (EOI) starting after SOI
      const eoiIndex = this.buffer.indexOf(JPEG_EOI, 2);
      if (eoiIndex === -1) {
        // Incomplete JPEG; wait for next stdout chunk
        break;
      }

      // Full JPEG extracted
      const jpegEnd = eoiIndex + 2;
      const frameBuffer = Buffer.from(this.buffer.subarray(0, jpegEnd));
      this.buffer = this.buffer.subarray(jpegEnd);

      // Extract image dimensions
      const parsedDim = extractJpegDimensions(frameBuffer);
      const width = parsedDim?.width || this.width || 1280;
      const height = parsedDim?.height || this.height || 720;

      this.sequence++;
      const frame: CameraFrame = {
        timestamp: new Date(),
        cameraId: this.cameraId,
        sourceType: 'RTSP' as any,
        frameBuffer,
        format: 'image/jpeg',
        width,
        height,
        sequence: this.sequence,
        metadata: {
          transport: this.transport,
          fps: this.fps,
        },
      };

      this.latestFrame = frame;

      // Notify all attached listeners (Preview, Recognition, Diagnostics)
      for (const listener of this.listeners) {
        try {
          listener(frame);
        } catch (err) {
          console.error('[RtspFrameSource] Error in frame listener:', err);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manualStop) {
      return;
    }

    const backoffDelay = Math.min(
      this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelayMs
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.manualStop) return;

      try {
        await this.start();
      } catch (err: any) {
        // If reconnect failed, schedule next retry if still in desired active state
        if (!this.manualStop && this.reconnectEnabled) {
          this.scheduleReconnect();
        }
      }
    }, backoffDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private terminateSubprocess(): void {
    if (!this.ffmpegProcess) {
      return;
    }

    const proc = this.ffmpegProcess;
    this.ffmpegProcess = null;

    try {
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners('exit');
      proc.removeAllListeners('error');

      proc.kill('SIGTERM');

      // Force kill after 1.5s if process fails to terminate gracefully
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {}
      }, 1500);
    } catch {}
  }

  private extractFriendlyStderrMessage(): string | null {
    const text = this.stderrRingBuffer.join('\n');
    if (/401\s+Unauthorized/i.test(text)) {
      return 'Camera authentication failed.';
    }
    if (/connection timed out/i.test(text) || /timed out/i.test(text)) {
      return 'Unable to connect to camera: connection timed out.';
    }
    if (/network is unreachable|no route to host/i.test(text)) {
      return 'Unable to connect to camera: network unreachable.';
    }
    if (/invalid data found/i.test(text)) {
      return 'Stream format error: invalid RTSP data received.';
    }
    return null;
  }
}
