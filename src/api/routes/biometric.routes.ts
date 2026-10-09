import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';
import { BiometricService } from '../../modules/biometrics/biometric.service';
import { ForbiddenError } from '../../common/errors';

export function createBiometricRouter(
  db: PrismaClient = defaultPrisma,
  biometricService?: BiometricService
) {
  const router = Router();
  const service = biometricService || new BiometricService(db);
  const { requireAuth } = createAuthMiddleware(db);

  router.use(requireAuth);

  /**
   * GET /api/v1/biometrics/health
   * Authenticated Admin/Warden health check of the biometric worker & models
   */
  router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role === StaffRole.GUARD) {
        throw new ForbiddenError('Guards are not authorized to view biometric engine diagnostics');
      }

      const health = await service.getHealth();
      res.status(200).json({ data: health });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/biometrics/diag
   * Diagnostic environment info (Admin only)
   */
  router.get('/diag', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role !== StaffRole.ADMIN) {
        throw new ForbiddenError('Only Admins can run system diagnostics');
      }

      const { execSync } = require('child_process');
      const fs = require('fs');
      const path = require('path');

      const run = (cmd: string) => {
        try {
          return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
        } catch (e: any) {
          return `ERROR: ${e.message || String(e)}`;
        }
      };

      const rootDir = process.cwd();
      const modelsDir = path.resolve(rootDir, 'models');
      const models = {
        dirExists: fs.existsSync(modelsDir),
        files: fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir) : [],
      };

      res.status(200).json({
        nodeVersion: process.version,
        platform: process.platform,
        cwd: rootDir,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          BIOMETRIC_ENGINE: process.env.BIOMETRIC_ENGINE || 'legacy',
          BIOMETRIC_MOCK: process.env.BIOMETRIC_MOCK,
          BIOMETRIC_ALLOW_MOCK_FALLBACK: process.env.BIOMETRIC_ALLOW_MOCK_FALLBACK,
          PYTHON_BIN: process.env.PYTHON_BIN,
          MODELS_DIR: process.env.MODELS_DIR,
          SCRFD_MODEL_PATH: process.env.SCRFD_MODEL_PATH ? '[configured]' : '[not configured]',
          ADAFACE_MODEL_PATH: process.env.ADAFACE_MODEL_PATH ? '[configured]' : '[not configured]',
        },
        models,
        pythonVersion: run('python3 --version'),
        whichPython: run('which python3 || where python3'),
        whichPip: run('which pip3 || which pip || where pip3'),
        cv2Import: run('python3 -c "import cv2; print(cv2.__version__)"'),
        workerHealth: await service.getHealth(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
