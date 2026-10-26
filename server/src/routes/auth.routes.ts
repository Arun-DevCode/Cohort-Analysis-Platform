import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, registerSchema, refreshSchema } from '../validators/auth.validator.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { authenticate } from '../middleware/authenticate.js';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), AuthController.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), AuthController.login);
authRouter.get('/me', authenticate, AuthController.getMe);
authRouter.post('/refresh', validate({ body: refreshSchema }), AuthController.refresh);
authRouter.post('/logout', AuthController.logout);
