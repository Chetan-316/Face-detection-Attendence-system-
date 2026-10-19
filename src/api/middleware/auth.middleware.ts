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
  tokenVersion: number;
}

export const SESSION_REVALIDATE_INTERVAL_MS = 15_000;

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
      req.user = await loadActiveUser(payload.sub, payload.tokenVersion ?? 0);
      next();
    } catch (error) {
      next(error);
    }
  };

  const loadActiveUser = async (userId: string, tokenVersion: number): Promise<AuthenticatedUser> => {
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AuthenticationError('Authenticated user no longer exists');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AuthenticationError('User account is inactive or suspended');
    }

    if (tokenVersion !== user.tokenVersion) {
      throw new AuthenticationError('Session has been revoked. Please sign in again');
    }

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      hostelId: user.hostelId,
      status: user.status,
      tokenVersion: user.tokenVersion,
    };
  };

  /**
   * Re-checks an authenticated long-lived connection (SSE, MJPEG) against the database.
   * Calls onRevoked once if the user is deactivated, the token version changes, or the
   * check fails. Returns a function that stops the watch.
   */
  const watchSessionRevocation = (user: AuthenticatedUser, onRevoked: () => void): (() => void) => {
    let stopped = false;
    const timer = setInterval(() => {
      loadActiveUser(user.id, user.tokenVersion).catch(() => {
        if (stopped) return;
        stop();
        onRevoked();
      });
    }, SESSION_REVALIDATE_INTERVAL_MS);
    const stop = () => {
      stopped = true;
      clearInterval(timer);
    };
    return stop;
  };

  /**
   * Dedicated middleware for Server-Sent Events (SSE) recognition event streams.
   * Accepts a recognition stream token only as ?streamToken= on the route whose
   * :cameraId matches the token, or a standard Bearer header.
   */
  const requireStreamAuth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const cameraId = req.params.cameraId as string;
      if (!cameraId) {
        throw new AuthenticationError('Camera ID is required for stream authentication');
      }

      if (typeof req.query.streamToken === 'string') {
        // Must be a valid stream token issued specifically for this camera
        const streamPayload = tokenService.verifyStreamToken(req.query.streamToken.trim(), cameraId);
        req.user = await loadActiveUser(streamPayload.sub, streamPayload.tokenVersion ?? 0);
      } else if (req.headers.authorization?.startsWith('Bearer ')) {
        const standardPayload = tokenService.verifyToken(req.headers.authorization.substring(7).trim());
        req.user = await loadActiveUser(standardPayload.sub, standardPayload.tokenVersion ?? 0);
      } else {
        throw new AuthenticationError('Stream authentication token is required');
      }

      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Camera preview (MJPEG) authentication. Accepts a camera-scoped stream token
   * via ?streamToken= (purpose 'camera_stream', matched to :id) or a Bearer header.
   * The session token is never accepted in the query string.
   */
  const requireCameraPreviewAuth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const cameraId = req.params.id as string;
      if (!cameraId) {
        throw new AuthenticationError('Camera ID is required for stream authentication');
      }

      if (typeof req.query.streamToken === 'string') {
        const streamPayload = tokenService.verifyCameraStreamToken(req.query.streamToken.trim(), cameraId);
        req.user = await loadActiveUser(streamPayload.sub, streamPayload.tokenVersion ?? 0);
      } else if (req.headers.authorization?.startsWith('Bearer ')) {
        const standardPayload = tokenService.verifyToken(req.headers.authorization.substring(7).trim());
        req.user = await loadActiveUser(standardPayload.sub, standardPayload.tokenVersion ?? 0);
      } else {
        throw new AuthenticationError('Authentication token is required for camera stream');
      }

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
    requireCameraPreviewAuth,
    requireRole,
    requirePermission,
    watchSessionRevocation,
  };
}

export const { requireAuth, requireStreamAuth, requireCameraPreviewAuth, requireRole, requirePermission } = createAuthMiddleware();
