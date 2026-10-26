import { Router } from 'express';
import { StudentController } from '../controllers/student.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const studentRouter = Router();

studentRouter.use(authenticate);
studentRouter.use(authorize(['admin', 'manager', 'trainer']));

// GET /api/v1/students/:id
studentRouter.get('/:id', StudentController.getProfile);
