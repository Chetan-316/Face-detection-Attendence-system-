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
import { AttendanceService } from '../modules/attendance/attendance.service';
import { AttendanceDecisionService } from '../modules/attendance-decision/attendance-decision.service';
import { AttendanceRecognitionBridge } from '../modules/attendance-decision/attendance-bridge';
import { createAttendanceRouter } from './routes/attendance.routes';
import { ReportService } from '../modules/reports/report.service';
import { createReportRouter } from './routes/report.routes';
import { createStaffRouter } from './routes/staff.routes';
import { createFacilityRouter } from './routes/facility.routes';

export interface CreateAppOptions {
  enrollmentService?: EnrollmentService;
  biometricService?: BiometricService;
  cameraService?: CameraService;
  recognitionService?: RecognitionService;
  movementDecisionService?: MovementDecisionService;
  movementBridge?: MovementRecognitionBridge;
  attendanceService?: AttendanceService;
  attendanceDecisionService?: AttendanceDecisionService;
  attendanceBridge?: AttendanceRecognitionBridge;
  reportService?: ReportService;
}

export function createApp(db: PrismaClient = defaultPrisma, options?: CreateAppOptions) {
  const app = express();

  // Render terminates TLS and forwards the real client address through one proxy hop.
  if (process.env.RENDER === 'true' || config.appEnv === 'production') {
    app.set('trust proxy', 1);
  }

  const movementDecisionService =
    options?.movementDecisionService || new MovementDecisionService(db);
  const movementBridge =
    options?.movementBridge || new MovementRecognitionBridge(movementDecisionService);

  const attendanceService =
    options?.attendanceService || new AttendanceService(db);
  const attendanceDecisionService =
    options?.attendanceDecisionService || new AttendanceDecisionService(db);
  const attendanceBridge =
    options?.attendanceBridge || new AttendanceRecognitionBridge(attendanceDecisionService);

  const recognitionService = options?.recognitionService || defaultRecognitionService;
  if (!recognitionService.getMovementBridge()) {
    recognitionService.setMovementBridge(movementBridge);
  }
  if (!recognitionService.getAttendanceBridge()) {
    recognitionService.setAttendanceBridge(attendanceBridge);
  }

  const cameraService = options?.cameraService || new CameraService(db);
  cameraService.onCameraChange((camera, previousRole) => {
    recognitionService.handleCameraChange(camera, previousRole);
  });

  const reportService = options?.reportService || new ReportService(db);

  // Basic Security & HTTP Headers
  app.use(helmet());

  // CORS configuration: Allow explicit origins, any vercel.app preview/production deployment, and localhost
  const rawOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          rawOrigins.includes('*') ||
          rawOrigins.includes(origin) ||
          origin.endsWith('.vercel.app') ||
          origin.includes('localhost') ||
          origin.includes('127.0.0.1')
        ) {
          return callback(null, true);
        }
        callback(new Error(`Origin '${origin}' not allowed by CORS`));
      },
      credentials: true,
    })
  );

  // Body parsers: JSON up to 10mb (supports profile photos) and raw image streams
  app.use(express.json({ limit: '10mb' }));
  app.use(express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }));

  // Health check endpoint (unversioned - cheap liveness only)
  // Must NOT access PostgreSQL, cameras, FFmpeg, Python worker, or recognition service
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'UP',
      service: 'PRAVAHAx',
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check endpoint (verifies critical service availability: db reachable & app initialized)
  // Camera availability must NOT control application readiness
  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.status(200).json({
        status: 'READY',
        service: 'PRAVAHAx',
        database: 'CONNECTED',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('[Readiness Check] Database reachability check failed:', error?.message || error);
      res.status(503).json({
        status: 'NOT_READY',
        database: 'DISCONNECTED',
      });
    }
  });

  // Versioned API Routes (/api/v1)
  app.use('/api/v1/auth', createAuthRouter(db));
  app.use('/api/v1/residents', createResidentRouter(db, options?.enrollmentService, cameraService));
  app.use('/api/v1/cameras', createCameraRouter(db, cameraService));
  app.use('/api/v1/cameras', createRecognitionRouter(db, recognitionService));
  app.use('/api/v1/biometrics', createBiometricRouter(db, options?.biometricService));
  app.use('/api/v1/movements', createMovementRouter(db, movementDecisionService));
  app.use('/api/v1/attendance', createAttendanceRouter(db, attendanceService, attendanceDecisionService));
  app.use('/api/v1/reports', createReportRouter(db, reportService));
  app.use('/api/v1/staff', createStaffRouter(db));
  app.use('/api/v1/facilities', createFacilityRouter(db));

  // Static frontend serving if client/dist exists (production / single-server mode)
  const clientDistPath = path.resolve(__dirname, '../../../client/dist');
  const altClientDistPath = path.resolve(process.cwd(), 'client/dist');
  const targetDistPath = fs.existsSync(altClientDistPath) ? altClientDistPath : clientDistPath;

  if (fs.existsSync(targetDistPath)) {
    app.use(express.static(targetDistPath));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/ready') {
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
