import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import readline from 'readline';
import {
  BiometricHealthStatus,
  FrameProcessingResult,
  AggregationResult,
  ExtractFacesResult,
} from './biometric.types';
import { BiometricWorkerError } from './biometric.errors';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class PythonWorkerClient {
  private process: ChildProcess | null = null;
  private pendingQueue: PendingRequest[] = [];
  private isReady: boolean = false;
  private isStarting: boolean = false;
  private startPromise: Promise<void> | null = null;
  private mockMode: boolean = false;

  constructor(options: { mock?: boolean } = {}) {
    this.mockMode = options.mock || process.env.BIOMETRIC_MOCK === 'true';
  }

  public setMockMode(mock: boolean) {
    this.mockMode = mock;
  }

  public async start(): Promise<void> {
    if (this.mockMode) {
      this.isReady = true;
      return Promise.resolve();
    }

    if (this.isReady && this.process) {
      return;
    }
    if (this.isStarting && this.startPromise) {
      return this.startPromise;
    }

    this.isStarting = true;
    this.startPromise = new Promise<void>((resolve, reject) => {
      const scriptPath = path.resolve(__dirname, 'workers/face_worker.py');
      const args = [scriptPath];
      if (this.mockMode) {
        args.push('--mock');
      }

      const pythonCmd = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

      try {
        this.process = spawn(pythonCmd, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });
      } catch (err: any) {
        this.isStarting = false;
        return reject(new BiometricWorkerError(`Failed to spawn Python biometric worker: ${err.message}`));
      }

      this.process.on('error', (err) => {
        console.error('Python biometric worker process error:', err);
        this.cleanup();
      });

      this.process.on('exit', (code, signal) => {
        this.cleanup();
      });

      // Handle stderr
      if (this.process.stderr) {
        const stderrRl = readline.createInterface({ input: this.process.stderr });
        stderrRl.on('line', (line) => {
          // Debug logs or worker events
        });
      }

      // Handle stdout
      if (this.process.stdout) {
        const stdoutRl = readline.createInterface({ input: this.process.stdout });
        stdoutRl.on('line', (line) => {
          line = line.trim();
          if (!line) return;

          try {
            const data = JSON.parse(line);
            if (data.event === 'started') {
              this.isReady = true;
              this.isStarting = false;
              resolve();
              return;
            }

            const nextReq = this.pendingQueue.shift();
            if (nextReq) {
              clearTimeout(nextReq.timer);
              nextReq.resolve(data);
            }
          } catch (e) {
            console.error('Failed to parse worker stdout JSON:', line);
          }
        });
      }

      // Timeout for worker startup (15 seconds)
      const initTimer = setTimeout(() => {
        if (!this.isReady) {
          this.cleanup();
          reject(new BiometricWorkerError('Timed out waiting for biometric worker initialization'));
        }
      }, 15000);
      initTimer.unref();
    });

    return this.startPromise;
  }

  private sendCommand<T>(command: string, payload: Record<string, any> = {}, timeoutMs = 8000): Promise<T> {
    return new Promise(async (resolve, reject) => {
      try {
        if (!this.isReady) {
          await this.start();
        }

        if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
          throw new BiometricWorkerError('Biometric worker stdin is not writable');
        }

        const timer = setTimeout(() => {
          const idx = this.pendingQueue.findIndex((req) => req.timer === timer);
          if (idx !== -1) {
            this.pendingQueue.splice(idx, 1);
            reject(new BiometricWorkerError(`Biometric worker request '${command}' timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        this.pendingQueue.push({ resolve, reject, timer });

        const cmdObj = { command, ...payload };
        this.process.stdin.write(JSON.stringify(cmdObj) + '\n');
      } catch (err) {
        reject(err);
      }
    });
  }

  public async health(): Promise<BiometricHealthStatus> {
    if (this.mockMode) {
      return {
        status: 'UP',
        workerReady: true,
        detectorLoaded: true,
        embedderLoaded: true,
        detectorName: 'YuNet (Mock)',
        detectorVersion: '2023mar',
        modelName: 'SFace',
        modelVersion: '2021dec',
        embeddingDimension: 128,
        runtime: 'In-Memory Mock',
        license: 'Apache-2.0',
        mock: true,
      };
    }

    try {
      const res = await this.sendCommand<any>('health');
      return {
        status: res.status || 'UP',
        workerReady: !!res.workerReady,
        detectorLoaded: !!res.detectorLoaded,
        embedderLoaded: !!res.embedderLoaded,
        detectorName: res.detectorName || 'YuNet',
        detectorVersion: res.detectorVersion || '2023mar',
        modelName: res.modelName || 'SFace',
        modelVersion: res.modelVersion || '2021dec',
        embeddingDimension: res.embeddingDimension || 128,
        runtime: res.runtime || 'OpenCV DNN (CPU)',
        license: res.license || 'Apache-2.0',
        mock: !!res.mock,
      };
    } catch (err: any) {
      return {
        status: 'DOWN',
        workerReady: false,
        detectorLoaded: false,
        embedderLoaded: false,
        detectorName: 'YuNet',
        detectorVersion: '2023mar',
        modelName: 'SFace',
        modelVersion: '2021dec',
        embeddingDimension: 128,
        runtime: 'Unavailable',
        license: 'Apache-2.0',
        mock: this.mockMode,
      };
    }
  }

  public async processFrame(
    imageBufferOrBase64: Buffer | string,
    options?: { expectedPose?: string; mockPose?: string }
  ): Promise<FrameProcessingResult> {
    if (this.mockMode) {
      const mockEmbedding = Array.from({ length: 128 }, (_, i) => Math.round(Math.sin(i + 0.1) * 1000000) / 1000000);
      return {
        success: true,
        quality: {
          is_valid: true,
          rejection_reason: null,
          message: 'Face detected and verified',
          face_count: 1,
        },
        embedding: mockEmbedding,
      };
    }

    const b64 = typeof imageBufferOrBase64 === 'string'
      ? imageBufferOrBase64
      : imageBufferOrBase64.toString('base64');

    return this.sendCommand<FrameProcessingResult>('process_frame', {
      image_base64: b64,
      expected_pose: options?.expectedPose,
      mock_pose: options?.mockPose,
    });
  }

  public async extractFaces(
    imageBufferOrBase64: Buffer | string,
    options?: { minFaceSize?: number; minConfidence?: number; mockFaces?: any[] }
  ): Promise<ExtractFacesResult> {
    if (this.mockMode) {
      if (options?.mockFaces) {
        return { success: true, faces: options.mockFaces };
      }
      const mockEmbedding = Array.from({ length: 128 }, (_, i) => Math.round(Math.sin(i + 0.1) * 1000000) / 1000000);
      return {
        success: true,
        faces: [
          {
            faceIndex: 0,
            bbox: { x: 200, y: 140, width: 240, height: 260 },
            detectionConfidence: 0.95,
            embedding: mockEmbedding,
            quality: {
              usable: true,
              rejectionReason: null,
              blurScore: 120.0,
              brightness: 128.0,
            },
          },
        ],
      };
    }

    const b64 = typeof imageBufferOrBase64 === 'string'
      ? imageBufferOrBase64
      : imageBufferOrBase64.toString('base64');

    return this.sendCommand<ExtractFacesResult>('extract_faces', {
      image_base64: b64,
      min_face_size: options?.minFaceSize,
      min_confidence: options?.minConfidence,
      mock_faces: options?.mockFaces,
    });
  }

  public async aggregateEmbeddings(embeddings: number[][]): Promise<AggregationResult> {
    if (this.mockMode) {
      if (!embeddings || embeddings.length === 0) {
        return { success: false, error: 'NO_EMBEDDINGS', template: [], samples_count: 0 };
      }
      const dim = 128;
      const mean = new Array(dim).fill(0);
      for (const emb of embeddings) {
        for (let i = 0; i < dim; i++) {
          mean[i] += emb[i] || 0;
        }
      }
      for (let i = 0; i < dim; i++) {
        mean[i] /= embeddings.length;
      }
      let sumSq = 0;
      for (let i = 0; i < dim; i++) sumSq += mean[i] * mean[i];
      const norm = Math.sqrt(sumSq);
      const normalized = norm > 1e-6 ? mean.map((x) => Math.round((x / norm) * 1000000) / 1000000) : mean;
      return {
        success: true,
        template: normalized,
        samples_count: embeddings.length,
        consistency_score: 0.98,
      };
    }

    return this.sendCommand<AggregationResult>('aggregate_embeddings', { embeddings });
  }

  public async stop(): Promise<void> {
    if (!this.process) return;

    try {
      if (this.process.stdin && this.process.stdin.writable) {
        this.process.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
      }
    } catch (e) {
      // Ignore write errors during shutdown
    }

    setTimeout(() => {
      if (this.process) {
        try {
          this.process.kill();
        } catch (e) {}
      }
      this.cleanup();
    }, 1000);
  }

  private cleanup() {
    this.isReady = false;
    this.isStarting = false;
    this.startPromise = null;
    this.process = null;

    while (this.pendingQueue.length > 0) {
      const req = this.pendingQueue.shift()!;
      clearTimeout(req.timer);
      req.reject(new BiometricWorkerError('Biometric worker process disconnected'));
    }
  }
}

export const defaultPythonWorkerClient = new PythonWorkerClient();
