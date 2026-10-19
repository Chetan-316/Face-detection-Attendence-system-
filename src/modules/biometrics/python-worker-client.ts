import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import {
  BiometricHealthStatus,
  FrameProcessingResult,
  AggregationResult,
  ExtractFacesResult,
} from './biometric.types';
import { BiometricWorkerError } from './biometric.errors';
import { config } from '../../config';

interface PendingRequest {
  id: number;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer?: NodeJS.Timeout;
  // A timed-out request stays queued so the worker's late reply is consumed, not handed to the next request.
  abandoned: boolean;
}

const MAX_PENDING_REQUESTS = 32;

export class PythonWorkerClient {
  private process: ChildProcess | null = null;
  private pendingQueue: PendingRequest[] = [];
  private requestSeq: number = 0;
  private isReady: boolean = false;
  private isStarting: boolean = false;
  private startPromise: Promise<void> | null = null;
  private mockMode: boolean = false;
  private lastStderr: string = '';
  private lastError: string = '';

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
    this.lastStderr = '';
    this.lastError = '';

    this.startPromise = new Promise<void>((resolve, reject) => {
      let scriptPath = path.resolve(__dirname, 'workers/face_worker.py');
      if (!fs.existsSync(scriptPath)) {
        const candidates = [
          path.resolve(process.cwd(), 'src/modules/biometrics/workers/face_worker.py'),
          path.resolve(__dirname, '../../../src/modules/biometrics/workers/face_worker.py'),
          path.resolve(__dirname, '../../../../src/modules/biometrics/workers/face_worker.py'),
        ];
        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            scriptPath = cand;
            break;
          }
        }
      }

      const args = [scriptPath];
      if (this.mockMode) {
        args.push('--mock');
      }

      const pythonCmd = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
      const workerDir = path.dirname(scriptPath);

      let child: ChildProcess;
      try {
        child = spawn(pythonCmd, args, {
          cwd: workerDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONPATH: workerDir + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ''),
          },
        });
      } catch (err: any) {
        this.isStarting = false;
        this.lastError = `Spawn error: ${err.message}`;
        return reject(new BiometricWorkerError(`Failed to spawn Python biometric worker (${pythonCmd}): ${err.message}`));
      }
      // Handlers below act only while this child is the current process, so a stale
      // child's events cannot reset or reject state that belongs to a newer start.
      this.process = child;

      child.on('error', (err) => {
        if (this.process !== child) return;
        console.error('Python biometric worker process error:', err);
        this.lastError = `Process error: ${err.message}`;
        this.cleanup(child);
        if (this.isStarting) {
          this.isStarting = false;
          reject(new BiometricWorkerError(`Biometric worker error (${pythonCmd}): ${err.message}`));
        }
      });

      child.on('exit', (code, signal) => {
        if (this.process !== child) return;
        const exitMsg = `Worker exited with code ${code}, signal ${signal}. Stderr: ${this.lastStderr}`;
        this.lastError = exitMsg;
        console.warn('Python biometric worker exited:', exitMsg);
        this.cleanup(child);
        if (this.isStarting) {
          this.isStarting = false;
          reject(new BiometricWorkerError(`Biometric worker exited prematurely: ${exitMsg}`));
        }
      });

      // Handle stderr
      if (child.stderr) {
        const stderrRl = readline.createInterface({ input: child.stderr });
        stderrRl.on('line', (line) => {
          this.lastStderr = (this.lastStderr ? this.lastStderr + '\n' : '') + line;
          if (this.lastStderr.length > 2000) {
            this.lastStderr = this.lastStderr.slice(-2000);
          }
          console.error('[BiometricWorker stderr]', line);
        });
      }

      // Handle stdout
      if (child.stdout) {
        const stdoutRl = readline.createInterface({ input: child.stdout });
        stdoutRl.on('line', (line) => {
          if (this.process !== child) return;
          line = line.trim();
          if (!line) return;

          try {
            const data = JSON.parse(line);
            if (data.event === 'started') {
              this.isReady = true;
              this.isStarting = false;
              clearTimeout(initTimer);
              resolve();
              return;
            }

            // The current worker does not echo request_id, so it answers in queue order.
            // A worker that echoes it is matched exactly.
            const idx = typeof data.request_id === 'number'
              ? this.pendingQueue.findIndex((req) => req.id === data.request_id)
              : 0;
            if (idx === -1) {
              console.warn('[PythonWorkerClient] Dropped worker response with unknown request_id');
              return;
            }
            const [req] = this.pendingQueue.splice(idx, 1);
            if (!req) return;
            if (req.timer) clearTimeout(req.timer);
            if (!req.abandoned) {
              req.resolve(data);
            }
          } catch (e) {
            console.error('Failed to parse worker stdout JSON:', line);
          }
        });
      }

      // SCRFD + AdaFace may take longer to map ONNX weights on low-end CPUs.
      const initTimer = setTimeout(() => {
        if (!this.isReady && this.process === child) {
          const timeoutMsg = `Timed out waiting for biometric worker initialization. Last stderr: ${this.lastStderr || 'none'}`;
          this.lastError = timeoutMsg;
          this.cleanup(child);
          // A worker that never reports ready would otherwise keep running as an orphan.
          try {
            child.kill();
          } catch (e) {}
          reject(new BiometricWorkerError(timeoutMsg));
        }
      }, config.biometric.engine === 'scrfd_adaface' ? 30000 : 10000);
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

        const child = this.process;
        if (!child || !child.stdin || !child.stdin.writable) {
          throw new BiometricWorkerError('Biometric worker stdin is not writable');
        }

        if (this.pendingQueue.length >= MAX_PENDING_REQUESTS) {
          throw new BiometricWorkerError(
            `Biometric worker backlog is full (${MAX_PENDING_REQUESTS} requests pending)`
          );
        }

        const requestId = ++this.requestSeq;
        const req: PendingRequest = { id: requestId, resolve, reject, abandoned: false };
        req.timer = setTimeout(() => {
          req.abandoned = true;
          reject(new BiometricWorkerError(`Biometric worker request '${command}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        this.pendingQueue.push(req);

        const cmdObj = { command, ...payload, request_id: requestId };
        child.stdin.write(JSON.stringify(cmdObj) + '\n');
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
        engine: config.biometric.engine,
        detectorLoaded: true,
        embedderLoaded: true,
        detectorName: `${config.biometric.detectorName} (Mock)`,
        detectorVersion: config.biometric.detectorVersion,
        detectorLicense: 'Mock / test only',
        modelName: config.biometric.modelName,
        modelVersion: config.biometric.modelVersion,
        embeddingDimension: config.biometric.embeddingDimension,
        templateVersion: config.biometric.templateVersion,
        runtime: 'In-Memory Mock',
        license: 'Mock / test only',
        mock: true,
      };
    }

    try {
      const res = await this.sendCommand<any>('health');
      return {
        status: res.status || 'UP',
        workerReady: !!res.workerReady,
        engine: res.engine || config.biometric.engine,
        detectorLoaded: !!res.detectorLoaded,
        embedderLoaded: !!res.embedderLoaded,
        detectorName: res.detectorName || config.biometric.detectorName,
        detectorVersion: res.detectorVersion || config.biometric.detectorVersion,
        detectorLicense: res.detectorLicense,
        modelName: res.modelName || config.biometric.modelName,
        modelVersion: res.modelVersion || config.biometric.modelVersion,
        embeddingDimension:
          res.embeddingDimension || config.biometric.embeddingDimension,
        templateVersion:
          res.templateVersion || config.biometric.templateVersion,
        runtime: res.runtime || 'ONNX / OpenCV CPU',
        license: res.license || 'Unknown model license',
        mock: !!res.mock,
      };
    } catch (err: any) {
      return {
        status: 'DOWN',
        workerReady: false,
        engine: config.biometric.engine,
        detectorLoaded: false,
        embedderLoaded: false,
        detectorName: config.biometric.detectorName,
        detectorVersion: config.biometric.detectorVersion,
        modelName: config.biometric.modelName,
        modelVersion: config.biometric.modelVersion,
        embeddingDimension: config.biometric.embeddingDimension,
        templateVersion: config.biometric.templateVersion,
        runtime: 'Unavailable',
        license: 'Unavailable',
        mock: this.mockMode,
        error: `${err.message || 'Worker unavailable'}${this.lastStderr ? ` | Stderr: ${this.lastStderr}` : ''}`,
      };
    }
  }

  public async processFrame(
    imageBufferOrBase64: Buffer | string,
    options?: { expectedPose?: string; mockPose?: string }
  ): Promise<FrameProcessingResult> {
    if (this.mockMode) {
      const mockEmbedding = Array.from(
        { length: config.biometric.embeddingDimension },
        (_, i) => Math.round(Math.sin(i + 0.1) * 1000000) / 1000000
      );
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
      const mockEmbedding = Array.from(
        { length: config.biometric.embeddingDimension },
        (_, i) => Math.round(Math.sin(i + 0.1) * 1000000) / 1000000
      );
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
    // Capture this instance's current child. The delayed kill targets only that child, so a
    // start() that runs during the grace period is never killed by this stop().
    const child = this.process;
    if (!child) return;

    try {
      if (child.stdin && child.stdin.writable) {
        child.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
      }
    } catch (e) {
      // Ignore write errors during shutdown
    }

    // Detach state now so new requests start a fresh child instead of queuing on a stopping one.
    this.cleanup(child);

    setTimeout(() => {
      try {
        child.kill();
      } catch (e) {}
    }, 1000);
  }

  /**
   * Resets state for the given child. When a child is passed, state is reset only if that child
   * is still the current process, so events from an older child cannot affect a newer one.
   */
  private cleanup(child?: ChildProcess) {
    if (child && this.process !== child) return;
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
