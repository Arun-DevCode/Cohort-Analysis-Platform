import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export type UserRole = 'admin' | 'manager' | 'trainer';

export interface TokenPayload {
  id: string;
  userId: string;
  email: string;
  name?: string;
  role: UserRole;
}

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  static async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  static generateTokens(payload: { userId?: string; id?: string; email: string; name?: string; role: UserRole }): { accessToken: string; refreshToken: string } {
    const id = payload.id || payload.userId || '';
    const userId = payload.userId || payload.id || '';
    const accessToken = jwt.sign(
      { id, userId, email: payload.email, name: payload.name, role: payload.role },
      env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id, userId, email: payload.email, name: payload.name, role: payload.role },
      env.REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    return { accessToken, refreshToken };
  }

  static verifyAccessToken(token: string): TokenPayload {
    const decoded = jwt.verify(token, env.JWT_SECRET) as any;
    const userId = decoded.userId || decoded.id;
    return {
      ...decoded,
      id: userId,
      userId,
    };
  }

  static verifyRefreshToken(token: string): TokenPayload {
    const decoded = jwt.verify(token, env.REFRESH_SECRET) as any;
    const userId = decoded.userId || decoded.id;
    return {
      ...decoded,
      id: userId,
      userId,
    };
  }
}

