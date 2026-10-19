import { Server } from 'http';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { CameraService } from '../modules/cameras/camera.service';
import { PythonWorkerClient, defaultPythonWorkerClient } from '../modules/biometrics/python-worker-client';

const WEAK_JWT_MARKERS = ['dev_secret', 'changeme', 'change_me', 'your-secret', 'example'];

export interface LifecycleOptions {
  cameraService?: CameraService;
  workerClient?: PythonWorkerClient;
}

export class LifecycleManager {
  private isShuttingDown = false;
  private server?: Server;
  private db: PrismaClient;
  private cameraService?: CameraService;
  private workerClient?: PythonWorkerClient;

  constructor(db: PrismaClient, options?: LifecycleOptions) {
    this.db = db;
    this.cameraService = options?.cameraService;
    this.workerClient = options?.workerClient || defaultPythonWorkerClient;
  }

  public setServer(server: Server): void {
    this.server = server;
  }

  /**
   * Enforces critical production safety guards before startup completes.
   */
  public validateEnvironment(): void {
    const isProd = process.env.NODE_ENV === 'production' || config.appEnv === 'production';
    if (isProd) {
      const refuse = (reason: string): never => {
        throw new Error(`[PRAVAHAx Security Guard] Production startup rejected: ${reason}`);
      };

      // 1. JWT secret must be secure, non-placeholder, and not trivially repetitive
      const jwtSecret = config.jwtSecret;
      if (
        !jwtSecret ||
        jwtSecret.length < 32 ||
        WEAK_JWT_MARKERS.some((marker) => jwtSecret.toLowerCase().includes(marker)) ||
        new Set(jwtSecret).size < 16
      ) {
        refuse('JWT_SECRET must be configured with a secure random key of at least 32 characters (not a placeholder).');
      }

      // 2. Mock biometrics and silent mock fallback must NEVER run in production
      if (process.env.BIOMETRIC_MOCK === 'true') {
        refuse('BIOMETRIC_MOCK cannot be enabled in production environment.');
      }
      if (process.env.BIOMETRIC_ALLOW_MOCK_FALLBACK === 'true') {
        refuse('BIOMETRIC_ALLOW_MOCK_FALLBACK cannot be enabled in production environment.');
      }

      // 3. Biometric model configuration and checksums must be pinned for the selected engine
      const sha256 = /^[a-f0-9]{64}$/i;
      const requiredChecksums =
        config.biometric.engine === 'scrfd_adaface'
          ? ['SCRFD_MODEL_SHA256', 'ADAFACE_MODEL_SHA256']
          : ['YUNET_MODEL_SHA256', 'SFACE_MODEL_SHA256'];
      for (const key of requiredChecksums) {
        if (!sha256.test(process.env[key] ?? '')) {
          refuse(`${key} must be set to a 64-character hex SHA-256 for engine '${config.biometric.engine}'.`);
        }
      }

      // 4. CORS_ORIGIN must contain explicit trusted frontend origin(s) (cannot be missing, empty, or '*')
      const corsOrigin = process.env.CORS_ORIGIN?.trim();
      if (!corsOrigin || corsOrigin.split(',').map((s) => s.trim()).some((origin) => origin === '*' || origin === '')) {
        refuse('CORS_ORIGIN must contain explicit trusted frontend origin(s).');
      }

      // 5. Destructive seed/reset tooling is development-only
      if (process.env.ALLOW_DESTRUCTIVE_SEED === 'true') {
        refuse('ALLOW_DESTRUCTIVE_SEED cannot be enabled in production environment.');
      }
    }
  }

  /**
   * Verifies critical database connectivity at startup.
   * If database is unavailable, throws an explicit error and does not enter a half-running state.
   */
  public async verifyDatabaseStartup(): Promise<void> {
    try {
      await this.db.$connect();
      await this.db.$queryRaw`SELECT 1`;
      console.log('[PRAVAHAx Lifecycle] Database connected successfully.');
    } catch (err: any) {
      const msg = `[PRAVAHAx Lifecycle] Fatal: PostgreSQL database is unreachable at startup: ${err.message}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  /**
   * Gracefully shuts down the HTTP server, camera adapters, FFmpeg processes,
   * Python biometric worker, and Prisma connection.
   * Idempotent: Calling cleanup more than once does not crash or throw.
   */
  public async shutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      console.log('[PRAVAHAx Lifecycle] Shutdown already in progress, ignoring duplicate call.');
      return;
    }

    this.isShuttingDown = true;
    console.log(`[PRAVAHAx Lifecycle] ${signal || 'Manual'} signal received, initiating graceful shutdown...`);

    // 1. Stop HTTP server from accepting new incoming requests
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close((err) => {
          if (err) {
            console.error('[PRAVAHAx Lifecycle] Error closing HTTP server:', err);
          } else {
            console.log('[PRAVAHAx Lifecycle] HTTP server closed cleanly.');
          }
          resolve();
        });
      });
    }

    // 2. Terminate active camera adapters and FFmpeg processes
    if (this.cameraService) {
      try {
        console.log('[PRAVAHAx Lifecycle] Disconnecting active camera adapters and FFmpeg processes...');
        await this.cameraService.shutdownAll();
        console.log('[PRAVAHAx Lifecycle] Camera adapters terminated cleanly.');
      } catch (err) {
        console.error('[PRAVAHAx Lifecycle] Error shutting down camera adapters:', err);
      }
    }

    // 3. Terminate biometric Python worker process
    if (this.workerClient) {
      try {
        console.log('[PRAVAHAx Lifecycle] Stopping Python biometric worker process...');
        await this.workerClient.stop();
        console.log('[PRAVAHAx Lifecycle] Biometric worker stopped cleanly.');
      } catch (err) {
        console.error('[PRAVAHAx Lifecycle] Error stopping biometric worker:', err);
      }
    }

    // 4. Disconnect PostgreSQL Prisma client
    try {
      console.log('[PRAVAHAx Lifecycle] Disconnecting Prisma database client...');
      await this.db.$disconnect();
      console.log('[PRAVAHAx Lifecycle] Database client disconnected.');
    } catch (err) {
      console.error('[PRAVAHAx Lifecycle] Error disconnecting Prisma client:', err);
    }

    console.log('[PRAVAHAx Lifecycle] Graceful shutdown complete.');
  }

  /**
   * Registers OS process signal listeners for SIGTERM and SIGINT.
   */
  public registerSignalHandlers(): void {
    const handleSignal = async (sig: string) => {
      try {
        await this.shutdown(sig);
        process.exit(0);
      } catch (err) {
        console.error(`[PRAVAHAx Lifecycle] Error during ${sig} shutdown:`, err);
        process.exit(1);
      }
    };

    process.once('SIGTERM', () => handleSignal('SIGTERM'));
    process.once('SIGINT', () => handleSignal('SIGINT'));
  }
}
