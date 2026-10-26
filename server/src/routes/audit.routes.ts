import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const auditRouter = Router();

auditRouter.use(authenticate);
auditRouter.use(authorize(['admin']));

auditRouter.get('/', AuditController.listLogs);
