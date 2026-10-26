import { Router } from 'express';
import { FollowupController } from '../controllers/followup.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createFollowupSchema,
  queryFollowupsSchema,
  updateFollowupSchema,
} from '../validators/followup.validator.js';

export const followupRouter = Router();

followupRouter.use(authenticate);

// GET /api/v1/followups
followupRouter.get(
  '/',
  authorize(['admin', 'trainer', 'manager']),
  validate({ query: queryFollowupsSchema }),
  FollowupController.listFollowups
);

// POST /api/v1/followups
followupRouter.post(
  '/',
  authorize(['admin', 'trainer']),
  validate({ body: createFollowupSchema }),
  FollowupController.createFollowup
);

// PATCH /api/v1/followups/:id
followupRouter.patch(
  '/:id',
  authorize(['admin', 'trainer']),
  validate({ body: updateFollowupSchema }),
  FollowupController.updateFollowup
);

// DELETE /api/v1/followups/:id
followupRouter.delete(
  '/:id',
  authorize(['admin', 'trainer']),
  FollowupController.deleteFollowup
);
