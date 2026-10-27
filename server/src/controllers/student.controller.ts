import { Request, Response, NextFunction } from 'express';
import { StudentService } from '../services/student.service.js';

export class StudentController {
  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { id } = req.params;
      const batchId = req.query.batchId as string | undefined;
      const profile = await StudentService.getStudentProfile(id, user, batchId);
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  }
}
