import jwt from 'jsonwebtoken';
import { StaffRole } from '@prisma/client';
import { config } from '../../config';
import { AuthenticationError } from '../../common/errors';

export interface TokenPayload {
  sub: string;
  role: StaffRole;
  organizationId: string;
  hostelId: string | null;
}

export interface StreamTokenPayload {
  sub: string;
  type: 'RECOGNITION_STREAM';
  cameraId: string;
  organizationId: string;
  hostelId: string | null;
  role: StaffRole;
}

export class TokenService {
  private readonly secret: string;
  private readonly expiresInSeconds: number = 8 * 60 * 60; // 8 hours

  constructor(secret: string = config.jwtSecret) {
    this.secret = secret;
  }

  public generateToken(payload: TokenPayload): { token: string; expiresIn: number } {
    const token = jwt.sign(payload, this.secret, {
      expiresIn: this.expiresInSeconds,
    });
    return { token, expiresIn: this.expiresInSeconds };
  }

  public generateStreamToken(
    payload: Omit<StreamTokenPayload, 'type'>,
    expiresInSeconds: number = 60
  ): { streamToken: string; expiresIn: number } {
    const streamToken = jwt.sign(
      { ...payload, type: 'RECOGNITION_STREAM' },
      this.secret,
      { expiresIn: expiresInSeconds }
    );
    return { streamToken, expiresIn: expiresInSeconds };
  }

  public verifyToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret) as any;
      if (decoded.type === 'RECOGNITION_STREAM') {
        throw new AuthenticationError('Stream token cannot be used for standard API authentication');
      }
      if (!decoded.sub || !decoded.role || !decoded.organizationId) {
        throw new AuthenticationError('Invalid token structure');
      }
      return decoded as TokenPayload;
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        throw err;
      }
      throw new AuthenticationError('Invalid or expired authentication token');
    }
  }

  public verifyStreamToken(token: string, expectedCameraId: string): StreamTokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret) as any;
      if (decoded.type !== 'RECOGNITION_STREAM') {
        throw new AuthenticationError('Token is not a recognition stream token');
      }
      if (decoded.cameraId !== expectedCameraId) {
        throw new AuthenticationError('Stream token was issued for a different camera');
      }
      if (!decoded.sub || !decoded.organizationId) {
        throw new AuthenticationError('Invalid stream token structure');
      }
      return decoded as StreamTokenPayload;
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        throw err;
      }
      throw new AuthenticationError('Invalid or expired stream token');
    }
  }
}

export const tokenService = new TokenService();
