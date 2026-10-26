import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from '../validators/user.validator.js';

export const userRouter = Router();

userRouter.use(authenticate, authorize(['admin']));

userRouter.get('/', UserController.listUsers);
userRouter.post('/', validate({ body: createUserSchema }), UserController.createUser);
userRouter.patch('/:id', validate({ params: userIdParamSchema, body: updateUserSchema }), UserController.updateUser);
