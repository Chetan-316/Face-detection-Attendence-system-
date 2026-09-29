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

  public verifyToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret) as TokenPayload;
      if (!decoded.sub || !decoded.role || !decoded.organizationId) {
        throw new AuthenticationError('Invalid token structure');
      }
      return decoded;
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        throw err;
      }
      throw new AuthenticationError('Invalid or expired authentication token');
    }
  }
}

export const tokenService = new TokenService();
