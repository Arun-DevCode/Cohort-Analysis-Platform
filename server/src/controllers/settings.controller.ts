import { Request, Response, NextFunction } from 'express';
import { SettingsService } from '../services/settings.service.js';

export class SettingsController {
  static async getThresholds(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const thresholds = await SettingsService.getThresholds();
      res.status(200).json(thresholds);
    } catch (err) {
      next(err);
    }
  }

  static async updateThresholds(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const updated = await SettingsService.updateThresholds(req.body, req.user?.userId);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  }
}
