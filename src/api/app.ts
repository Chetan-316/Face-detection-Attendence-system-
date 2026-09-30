import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../database/client';
import { AppError } from '../common/errors';
import { config } from '../config';
import { createAuthRouter } from './routes/auth.routes';
import { createResidentRouter } from './routes/resident.routes';
import { createCameraRouter } from './routes/camera.routes';
import { createBiometricRouter } from './routes/biometric.routes';
import { createRecognitionRouter } from './routes/recognition.routes';
import { EnrollmentService } from '../modules/biometrics/enrollment.service';
import { BiometricService } from '../modules/biometrics/biometric.service';
import { CameraService } from '../modules/cameras/camera.service';
import { RecognitionService, defaultRecognitionService } from '../modules/recognition/recognition.service';
import { MovementDecisionService } from '../modules/movement-decision/movement-decision.service';
import { MovementRecognitionBridge } from '../modules/movement-decision/movement-bridge';
import { createMovementRouter } from './routes/movement.routes';

export interface CreateAppOptions {
  enrollmentService?: EnrollmentService;
  biometricService?: BiometricService;
  cameraService?: CameraService;
  recognitionService?: RecognitionService;
  movementDecisionService?: MovementDecisionService;
  movementBridge?: MovementRecognitionBridge;
}

export function createApp(db: PrismaClient = defaultPrisma, options?: CreateAppOptions) {
  const app = express();

  const movementDecisionService =
    options?.movementDecisionService || new MovementDecisionService(db);
  const movementBridge =
    options?.movementBridge || new MovementRecognitionBridge(movementDecisionService);

  const recognitionService = options?.recognitionService || defaultRecognitionService;
  if (!recognitionService.getMovementBridge()) {
    recognitionService.setMovementBridge(movementBridge);
  }

  // Basic Security & HTTP Headers
  app.use(helmet());

  // CORS configuration
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : '*';
  app.use(cors({ origin: allowedOrigins }));

  // JSON Body Parser with 100kb limit
  app.use(express.json({ limit: '100kb' }));

  // Health check endpoint (unversioned)
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      // Verify PostgreSQL connection
      await db.$queryRaw`SELECT 1`;
      res.json({
        status: 'UP',
        service: 'PRAVAHAx Face Recognition Hostel Attendance & Resident Movement System',
        stage: 'STEP_02_RESIDENT_API',
        appEnv: config.appEnv,
        timezone: config.timezone,
        database: 'CONNECTED',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'DOWN',
        database: 'DISCONNECTED',
        error: error.message,
      });
    }
  });

  // Versioned API Routes (/api/v1)
  app.use('/api/v1/auth', createAuthRouter(db));
  app.use('/api/v1/residents', createResidentRouter(db, options?.enrollmentService));
  app.use('/api/v1/cameras', createCameraRouter(db, options?.cameraService));
  app.use('/api/v1/cameras', createRecognitionRouter(db, recognitionService));
  app.use('/api/v1/biometrics', createBiometricRouter(db, options?.biometricService));
  app.use('/api/v1/movements', createMovementRouter(db, movementDecisionService));

  // Static frontend serving if client/dist exists (production / single-server mode)
  const clientDistPath = path.resolve(__dirname, '../../../client/dist');
  const altClientDistPath = path.resolve(process.cwd(), 'client/dist');
  const targetDistPath = fs.existsSync(altClientDistPath) ? altClientDistPath : clientDistPath;

  if (fs.existsSync(targetDistPath)) {
    app.use(express.static(targetDistPath));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.path === '/health') {
        return next();
      }
      res.sendFile(path.join(targetDistPath, 'index.html'));
    });
  }

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          details: err.details || {},
        },
      });
      return;
    }

    // Never leak stack trace, database internals, or secrets in response
    console.error('Unhandled internal server error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal server error occurred',
        details: {},
      },
    });
  });

  return app;
}
