import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { userRouter } from './user.routes.js';
import { batchRouter } from './batch.routes.js';
import { studentRouter } from './student.routes.js';
import { followupRouter } from './followup.routes.js';
import { settingsRouter } from './settings.routes.js';
import { auditRouter } from './audit.routes.js';
import { UploadController } from '../controllers/upload.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { getDb } from '../db/client.js';
import { sql } from 'drizzle-orm';

export const apiRouter = Router();

apiRouter.get('/health', async (req, res) => {
  let dbStatus = 'connected';
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
  } catch (err: any) {
    dbStatus = 'disconnected';
  }

  res.status(200).json({
    status: 'ok',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/batches', batchRouter);
apiRouter.use('/students', studentRouter);
apiRouter.use('/followups', followupRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/audit-logs', auditRouter);

// Uploads status endpoint
apiRouter.get(
  '/uploads/:id',
  authenticate,
  authorize(['admin', 'manager', 'trainer']),
  UploadController.getUploadStatus
);
