import { Router } from 'express';
import { ReportFileController } from '../controllers/reportFile.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const fileRouter = Router();

fileRouter.use(authenticate);

// GET /files/:fileId/download
fileRouter.get(
  '/:fileId/download',
  authorize(['admin', 'manager', 'trainer']),
  ReportFileController.downloadFile
);

// DELETE /files/:fileId?confirm=true
fileRouter.delete(
  '/:fileId',
  authorize(['admin', 'trainer']),
  ReportFileController.deleteFile
);

