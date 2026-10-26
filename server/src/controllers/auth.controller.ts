import { Request, Response, NextFunction } from 'express';
import { UserModel } from '../models/user.model.js';
import { AuthService } from '../services/auth.service.js';
import { UserView } from '../views/user.view.js';
import { LoginInput, RegisterInput, RefreshInput } from '../validators/auth.validator.js';
import { AuditService } from '../services/audit.service.js';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, name, password, role } = req.body as RegisterInput;

      const existing = await UserModel.findByEmail(email);
      if (existing) {
        res.status(409).json({
          code: 'USER_EXISTS',
          message: 'An account with this email address already exists. Please log in.',
        });
        return;
      }

      const passwordHash = await AuthService.hashPassword(password);
      const user = await UserModel.create({
        name,
        email,
        passwordHash,
        role: role || 'trainer',
      });

      const tokens = AuthService.generateTokens({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });

      await AuditService.log({
        userId: user.id,
        action: 'register',
        entity: 'users',
        entityId: user.id,
        meta: { email: user.email, name: user.name, role: user.role },
      });

      res.status(201).json({
        user: UserView.render(user),
        tokens,
      });
    } catch (err) {
      next(err);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as LoginInput;

      const user = await UserModel.findByEmail(email);
      if (!user) {
        res.status(401).json({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        return;
      }

      const isValid = await AuthService.verifyPassword(user.passwordHash, password);
      if (!isValid) {
        res.status(401).json({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        return;
      }

      const tokens = AuthService.generateTokens({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });

      res.status(200).json({
        user: UserView.render(user),
        tokens,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
        return;
      }

      const user = await UserModel.findById(req.user.userId);
      if (!user) {
        res.status(404).json({ code: 'USER_NOT_FOUND', message: 'User not found' });
        return;
      }

      res.status(200).json({
        user: UserView.render(user),
      });
    } catch (err) {
      next(err);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as RefreshInput;

      let payload;
      try {
        payload = AuthService.verifyRefreshToken(refreshToken);
      } catch (err) {
        res.status(401).json({
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Refresh token is invalid or expired',
        });
        return;
      }

      const user = await UserModel.findById(payload.userId);
      if (!user) {
        res.status(401).json({
          code: 'USER_NOT_FOUND',
          message: 'User belonging to token no longer exists',
        });
        return;
      }

      const tokens = AuthService.generateTokens({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });

      res.status(200).json({
        tokens,
      });
    } catch (err) {
      next(err);
    }
  }

  static async logout(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      message: 'Logged out successfully',
    });
  }
}
