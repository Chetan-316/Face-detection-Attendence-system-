import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../database/client';
import { AppError } from '../common/errors';
import { config } from '../config';
import { createAuthRouter } from './routes/auth.routes';
import { createResidentRouter } from './routes/resident.routes';

export function createApp(db: PrismaClient = defaultPrisma) {
  const app = express();

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
  app.use('/api/v1/residents', createResidentRouter(db));

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
