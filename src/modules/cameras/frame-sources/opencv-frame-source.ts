import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { CameraHealthStatus, CameraSourceType } from '@prisma/client';
import { CameraFrame } from '../camera.types';
import { FrameSourceConfig, IFrameSource } from './frame-source.interface';

const HEADER_SIZE = 20;
const MAGIC = 'PXF1';

export class OpenCvFrameSource implements IFrameSource {
  private cameraId: string = '';
  private deviceIndex: number = 0;
  private width: number = 640;
  private height: number = 480;
  private fps: number = 15;
  private quality: number = 80;

  private workerProcess: ChildProcess | null = null;
  private active: boolean = false;
  private health: CameraHealthStatus = CameraHealthStatus.OFFLINE;
  private lastError: string | null = null;

  private buffer: Buffer = Buffer.alloc(0);
  private latestFrame: CameraFrame | null = null;
  private sequence: number = 0;
  private listeners: Set<(frame: CameraFrame) => void> = new Set();

  public async initialize(config: FrameSourceConfig): Promise<void> {
    this.cameraId = config.cameraId;
    this.deviceIndex = typeof config.deviceIndex === 'number' ? config.deviceIndex : 0;
    this.width = config.width || 640;
    this.height = config.height || 480;
    this.fps = config.fps || 15;
    this.quality = config.quality || 80;
    this.health = CameraHealthStatus.OFFLINE;
    this.lastError = null;
  }

  public async start(): Promise<void> {
    if (this.active && this.workerProcess) {
      return;
    }

    const scriptPath = path.resolve(__dirname, '../workers/webcam_worker.py');

    return new Promise<void>((resolve, reject) => {
      let isSettled = false;

      const pythonCmd = process.env.PYTHON_PATH || 'python';
      const args = [
        scriptPath,
        '--device',
        String(this.deviceIndex),
        '--width',
        String(this.width),
        '--height',
        String(this.height),
        '--fps',
        String(this.fps),
        '--quality',
        String(this.quality),
      ];

      try {
        this.workerProcess = spawn(pythonCmd, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err: any) {
        this.health = CameraHealthStatus.OFFLINE;
        this.lastError = `Failed to spawn webcam worker: ${err.message}`;
        return reject(new Error(this.lastError));
      }

      this.active = true;
      this.buffer = Buffer.alloc(0);

      // Handle worker stdout (binary frame data)
      this.workerProcess.stdout?.on('data', (chunk: Buffer) => {
        this.handleStreamData(chunk);
      });

      // Handle worker stderr (structured JSON logs and errors)
      this.workerProcess.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString('utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === 'ready') {
              this.health = CameraHealthStatus.ONLINE;
              this.lastError = null;
              if (!isSettled) {
                isSettled = true;
                resolve();
              }
            } else if (event.type === 'error') {
              this.health = CameraHealthStatus.OFFLINE;
              this.lastError = event.message || event.error || 'Camera worker error';
              if (!isSettled) {
                isSettled = true;
                reject(new Error(this.lastError || 'Webcam worker initialization failed'));
              }
            }
          } catch {
            // Non-JSON logging output (ignore or debug)
          }
        }
      });

      // Handle worker process errors (e.g. executable not found)
      this.workerProcess.on('error', (err: Error) => {
        this.active = false;
        this.health = CameraHealthStatus.OFFLINE;
        this.lastError = `Webcam process error: ${err.message}`;
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      });

      // Handle worker unexpected exit
      this.workerProcess.on('exit', (code, signal) => {
        const wasActive = this.active;
        this.active = false;
        this.health = CameraHealthStatus.OFFLINE;
        if (code !== 0 && code !== null) {
          this.lastError = `Webcam process exited unexpectedly with code ${code}`;
        }
        if (!isSettled && wasActive) {
          isSettled = true;
          reject(new Error(this.lastError || `Webcam worker exited before ready (code: ${code})`));
        }
        this.workerProcess = null;
      });

      // Startup timeout guard (15 seconds)
      setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.stop().catch(() => {});
          reject(new Error('Webcam hardware initialization timed out (15s)'));
        }
      }, 15000);
    });
  }

  public async stop(): Promise<void> {
    this.active = false;
    this.health = CameraHealthStatus.OFFLINE;

    if (!this.workerProcess) {
      return;
    }

    const proc = this.workerProcess;
    this.workerProcess = null;

    return new Promise<void>((resolve) => {
      let resolved = false;
      const cleanupTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            if (process.platform === 'win32' && proc.pid) {
              spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true });
            } else {
              proc.kill('SIGKILL');
            }
          } catch {}
          resolve();
        }
      }, 1500);

      proc.once('exit', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(cleanupTimer);
          resolve();
        }
      });

      // Instruct worker to stop gracefully via stdin
      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
          proc.stdin.end();
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        proc.kill('SIGTERM');
      }
    });
  }

  public isActive(): boolean {
    return this.active && this.workerProcess !== null;
  }

  public getHealth(): CameraHealthStatus {
    return this.health;
  }

  public getState(): 'CONNECTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' {
    if (this.health === CameraHealthStatus.ONLINE) return 'ONLINE';
    if (this.health === CameraHealthStatus.DEGRADED) return 'DEGRADED';
    return 'OFFLINE';
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getLatestFrame(): CameraFrame | null {
    return this.latestFrame;
  }

  public async captureSnapshot(): Promise<CameraFrame> {
    if (this.latestFrame) {
      return this.latestFrame;
    }

    if (!this.isActive()) {
      await this.start();
    }

    // Wait for first frame to arrive
    return new Promise<CameraFrame>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for camera frame snapshot'));
      }, 3000);

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
    this.buffer = Buffer.alloc(0);
    this.latestFrame = null;
  }

  private handleStreamData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= HEADER_SIZE) {
      // Realign to magic bytes if stream gets out of sync
      const magicStr = this.buffer.subarray(0, 4).toString('ascii');
      if (magicStr !== MAGIC) {
        const magicIndex = this.buffer.indexOf(MAGIC);
        if (magicIndex === -1) {
          // No magic found, keep only last 3 bytes in case magic spans chunk boundary
          this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3));
          break;
        }
        this.buffer = this.buffer.subarray(magicIndex);
        if (this.buffer.length < HEADER_SIZE) {
          break;
        }
      }

      const payloadLength = this.buffer.readUInt32BE(4);
      const totalPacketLength = HEADER_SIZE + payloadLength;

      if (this.buffer.length < totalPacketLength) {
        // Incomplete packet; wait for next chunk
        break;
      }

      const timestampMs = Number(this.buffer.readBigUInt64BE(8));
      const width = this.buffer.readUInt16BE(16);
      const height = this.buffer.readUInt16BE(18);
      const frameBuffer = Buffer.from(this.buffer.subarray(HEADER_SIZE, totalPacketLength));

      // Advance buffer past packet
      this.buffer = this.buffer.subarray(totalPacketLength);

      this.sequence++;
      const frame: CameraFrame = {
        timestamp: new Date(timestampMs),
        cameraId: this.cameraId,
        sourceType: CameraSourceType.WEBCAM,
        frameBuffer,
        format: 'image/jpeg',
        width,
        height,
        sequence: this.sequence,
        metadata: {
          deviceIndex: this.deviceIndex,
          backend: 'opencv',
        },
      };

      this.latestFrame = frame;

      for (const listener of this.listeners) {
        try {
          listener(frame);
        } catch (err) {
          console.error('[OpenCvFrameSource] Error in frame listener:', err);
        }
      }
    }
  }
}
