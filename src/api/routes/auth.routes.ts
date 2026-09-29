import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../../modules/auth/auth.service';
import { tokenService } from '../auth/token.service';
import { validateRequest } from '../middleware/validation.middleware';
import { loginSchema } from '../../modules/auth/auth.schemas';
import { AuthenticationError } from '../../common/errors';
import { config } from '../../config';
import { prisma as defaultPrisma } from '../../database/client';
import { createAuthMiddleware } from '../middleware/auth.middleware';

export function createAuthRouter(db = defaultPrisma) {
  const router = Router();
  const authService = new AuthService(db);
  const { requireAuth } = createAuthMiddleware(db);

  // Rate limiter: 10 attempts per minute per IP
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many login attempts. Please try again later.',
        details: {},
      },
    },
    skip: () => process.env.NODE_ENV === 'test' || config.appEnv === 'test',
  });

  router.post(
    '/login',
    loginLimiter,
    validateRequest({ body: loginSchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { username, password } = req.body;

        const user = await authService.verifyCredentials(username, password);
        if (!user) {
          // Generic failure response without leaking whether username or password was incorrect
          throw new AuthenticationError('Invalid username or password');
        }

        const tokenResult = tokenService.generateToken({
          sub: user.id,
          role: user.role,
          organizationId: user.organizationId,
          hostelId: user.hostelId,
        });

        // Safe user response - NO passwordHash or database internals
        res.status(200).json({
          user: {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            organizationId: user.organizationId,
            hostelId: user.hostelId,
            status: user.status,
          },
          token: tokenResult.token,
          expiresIn: tokenResult.expiresIn,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * GET /api/v1/auth/me
   * Return authenticated user profile from token
   */
  router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        user: req.user!,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const authRouter = createAuthRouter();
