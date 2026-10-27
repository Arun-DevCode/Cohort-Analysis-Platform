import { Router } from 'express';
import { BatchController } from '../controllers/batch.controller.js';
import { UploadController } from '../controllers/upload.controller.js';
import { SnapshotController } from '../controllers/snapshot.controller.js';
import { AnalyticsController } from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize, requireBatchAccess } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { uploadSingleFile } from '../middleware/upload.js';
import {
  createBatchSchema,
  updateBatchSchema,
  assignTrainersSchema,
  batchIdParamSchema,
} from '../validators/batch.validator.js';

export const batchRouter = Router();

batchRouter.use(authenticate);

// List batches (all authenticated roles, trainers filtered to assigned)
batchRouter.get('/', authorize(['admin', 'manager', 'trainer']), BatchController.listBatches);

// Create batch (admin and trainer)
batchRouter.post(
  '/',
  authorize(['admin', 'trainer']),
  validate({ body: createBatchSchema }),
  BatchController.createBatch
);

// Get batch detail (all roles with batch access)
batchRouter.get(
  '/:id',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess('batch'),
  validate({ params: batchIdParamSchema }),
  BatchController.getBatch
);

// Update batch (admin only, verified batch access)
batchRouter.patch(
  '/:id',
  authorize(['admin']),
  requireBatchAccess('batch'),
  validate({ params: batchIdParamSchema, body: updateBatchSchema }),
  BatchController.updateBatch
);

// Delete batch (admin only, verified batch access)
batchRouter.delete(
  '/:id',
  authorize(['admin']),
  requireBatchAccess('batch'),
  validate({ params: batchIdParamSchema }),
  BatchController.deleteBatch
);

// Assign trainers (admin only, verified batch access)
batchRouter.post(
  '/:id/trainers',
  authorize(['admin']),
  requireBatchAccess('batch'),
  validate({ params: batchIdParamSchema, body: assignTrainersSchema }),
  BatchController.assignTrainers
);

// Upload report (admin or trainer with batch access)
batchRouter.post(
  '/:id/uploads',
  uploadSingleFile,
  authorize(['admin', 'trainer']),
  requireBatchAccess(),
  UploadController.uploadReport
);

// List snapshots (all roles with batch access)
batchRouter.get(
  '/:id/snapshots',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess(),
  SnapshotController.listSnapshots
);

// B7: Overview (Scorecards, trend series, segments, top improvers, needs attention)
batchRouter.get(
  '/:id/overview',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess(),
  AnalyticsController.getOverview
);

// B8: Compare two snapshots (movement lists, transition matrix)
batchRouter.get(
  '/:id/compare',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess(),
  AnalyticsController.compare
);

// B9: At-Risk learners list (supports format=csv)
batchRouter.get(
  '/:id/at-risk',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess(),
  AnalyticsController.getAtRisk
);

// B10: Per-assignment stats & non-submitters
batchRouter.get(
  '/:id/assignments',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess(),
  AnalyticsController.getAssignments
);

// B10: Week-wise content consumption matrix
batchRouter.get(
  '/:id/content',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess(),
  AnalyticsController.getContent
);

// B10: Session-wise attendance stats & recording-only learners
batchRouter.get(
  '/:id/attendance',
  authorize(['admin', 'manager', 'trainer']),
  requireBatchAccess(),
  AnalyticsController.getAttendance
);
import { ReportController } from '../controllers/report.controller.js';

// B13: Report Export (exceljs workbook)
batchRouter.get(
  '/:id/report',
  authorize(['admin', 'manager']),
  requireBatchAccess(),
  validate({ params: batchIdParamSchema }),
  ReportController.exportBatchReport
);
