import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { prisma } from '../database/client';
import { AppError } from '../common/errors';
import { config } from '../config';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      // Verify PostgreSQL connection
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'UP',
        service: 'PRAVAHAx Face Recognition Hostel Attendance & Resident Movement System',
        stage: 'STEP_01_FOUNDATION',
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

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
        },
      });
      return;
    }

    console.error('Unhandled error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal server error occurred',
      },
    });
  });

  return app;
}
