import { Request, Response, NextFunction } from 'express';
import { FollowupService } from '../services/followup.service.js';

export class FollowupController {
  static async listFollowups(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const result = await FollowupService.listFollowups(req.query as any, user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  static async createFollowup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const created = await FollowupService.createFollowup(req.body, user);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }

  static async updateFollowup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const updated = await FollowupService.updateFollowup(id, req.body, user);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  }

  static async deleteFollowup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const result = await FollowupService.deleteFollowup(id, user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
