import { Router } from 'express';
import { SettingsController } from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { thresholdsSchema } from '../validators/settings.validator.js';

export const settingsRouter = Router();

settingsRouter.use(authenticate);

settingsRouter.get('/thresholds', SettingsController.getThresholds);

settingsRouter.put(
  '/thresholds',
  authorize(['admin']),
  validate({ body: thresholdsSchema }),
  SettingsController.updateThresholds
);
