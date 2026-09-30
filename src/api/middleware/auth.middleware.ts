import { Request, Response, NextFunction } from 'express';
import { StaffRole, UserStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { tokenService } from '../auth/token.service';
import { AuthenticationError, PermissionDeniedError } from '../../common/errors';
import { ActionName, assertPermission } from '../../modules/auth/permissions';

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: StaffRole;
  organizationId: string;
  hostelId: string | null;
  status: UserStatus;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function createAuthMiddleware(db = defaultPrisma) {
  const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      let token: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }

      if (!token) {
        throw new AuthenticationError('Authentication token is required');
      }

      const payload = tokenService.verifyToken(token);

      // Verify user in database
      const user = await db.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new AuthenticationError('Authenticated user no longer exists');
      }

      if (user.status !== UserStatus.ACTIVE) {
        throw new AuthenticationError('User account is inactive or suspended');
      }

      req.user = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        hostelId: user.hostelId,
        status: user.status,
      };

      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Dedicated middleware for Server-Sent Events (SSE) recognition event streams.
   * Accepts camera-scoped, short-lived stream token via ?streamToken= query param
   * or standard Bearer header.
   */
  const requireStreamAuth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const cameraId = (req.params.cameraId || req.query.cameraId) as string;
      if (!cameraId) {
        throw new AuthenticationError('Camera ID is required for stream authentication');
      }

      let token: string | undefined;
      let isStreamToken = false;

      if (typeof req.query.streamToken === 'string') {
        token = req.query.streamToken.trim();
        isStreamToken = true;
      } else if (req.headers.authorization?.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7).trim();
      }

      if (!token) {
        throw new AuthenticationError('Stream authentication token is required');
      }

      let userId: string;

      if (isStreamToken) {
        // Must be a valid stream token issued specifically for this camera
        const streamPayload = tokenService.verifyStreamToken(token, cameraId);
        userId = streamPayload.sub;
      } else {
        // Fallback: standard JWT Bearer header
        const standardPayload = tokenService.verifyToken(token);
        userId = standardPayload.sub;
      }

      const user = await db.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AuthenticationError('Authenticated user no longer exists');
      }

      if (user.status !== UserStatus.ACTIVE) {
        throw new AuthenticationError('User account is inactive or suspended');
      }

      req.user = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        hostelId: user.hostelId,
        status: user.status,
      };

      next();
    } catch (error) {
      next(error);
    }
  };

  const requireRole = (...allowedRoles: StaffRole[]) => {
    return (req: Request, _res: Response, next: NextFunction) => {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }
      if (!allowedRoles.includes(req.user.role)) {
        throw new PermissionDeniedError(
          `Access restricted to [${allowedRoles.join(', ')}]`,
          req.user.role
        );
      }
      next();
    };
  };

  const requirePermission = (action: ActionName) => {
    return (req: Request, _res: Response, next: NextFunction) => {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }
      assertPermission(req.user.role, action);
      next();
    };
  };

  return {
    requireAuth,
    requireStreamAuth,
    requireRole,
    requirePermission,
  };
}

export const { requireAuth, requireStreamAuth, requireRole, requirePermission } = createAuthMiddleware();
