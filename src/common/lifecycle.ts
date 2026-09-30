import { Server } from 'http';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { CameraService } from '../modules/cameras/camera.service';
import { PythonWorkerClient, defaultPythonWorkerClient } from '../modules/biometrics/python-worker-client';

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
      // 1. JWT secret must be secure and non-default
      if (
        !config.jwtSecret ||
        config.jwtSecret === 'dev_secret_pravahax_attendance_movement_2026_key' ||
        config.jwtSecret.length < 32
      ) {
        throw new Error(
          '[PRAVAHAx Security Guard] Production startup rejected: JWT_SECRET must be configured with a secure random key of at least 32 characters.'
        );
      }

      // 2. Mock biometrics must NEVER run in production
      if (process.env.BIOMETRIC_MOCK === 'true') {
        throw new Error(
          '[PRAVAHAx Security Guard] Production startup rejected: BIOMETRIC_MOCK cannot be enabled in production environment.'
        );
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
