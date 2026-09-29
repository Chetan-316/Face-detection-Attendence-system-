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
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthenticationError('Authentication token is required');
      }

      const token = authHeader.substring(7).trim();
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
    requireRole,
    requirePermission,
  };
}

export const { requireAuth, requireRole, requirePermission } = createAuthMiddleware();
