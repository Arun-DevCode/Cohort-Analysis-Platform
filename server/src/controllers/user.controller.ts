import { Request, Response, NextFunction } from 'express';
import { UserModel } from '../models/user.model.js';
import { AuthService } from '../services/auth.service.js';
import { UserView } from '../views/user.view.js';
import { CreateUserInput, UpdateUserInput } from '../validators/user.validator.js';

import { AuditService } from '../services/audit.service.js';

export class UserController {
  static async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const usersList = await UserModel.findAll();
      res.status(200).json({
        users: UserView.renderMany(usersList),
      });
    } catch (err) {
      next(err);
    }
  }

  static async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, role } = req.body as CreateUserInput;

      const existing = await UserModel.findByEmail(email);
      if (existing) {
        res.status(409).json({
          code: 'USER_EXISTS',
          message: 'A user with this email address already exists',
        });
        return;
      }

      const passwordHash = await AuthService.hashPassword(password);
      const user = await UserModel.create({
        email,
        passwordHash,
        role,
      });

      await AuditService.log({
        userId: req.user?.userId,
        action: 'create_user',
        entity: 'users',
        entityId: user.id,
        meta: { email: user.email, role: user.role },
      });

      res.status(201).json({
        user: UserView.render(user),
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { role, password } = req.body as UpdateUserInput;

      const user = await UserModel.findById(id);
      if (!user) {
        res.status(404).json({
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        });
        return;
      }

      const updateData: { role?: any; passwordHash?: string } = {};
      if (role) {
        updateData.role = role;
      }
      if (password) {
        updateData.passwordHash = await AuthService.hashPassword(password);
      }

      const updated = await UserModel.update(id, updateData);

      await AuditService.log({
        userId: req.user?.userId,
        action: 'update_user',
        entity: 'users',
        entityId: id,
        meta: { role: updateData.role, passwordChanged: !!updateData.passwordHash },
      });

      res.status(200).json({
        user: UserView.render(updated),
      });
    } catch (err) {
      next(err);
    }
  }
}
