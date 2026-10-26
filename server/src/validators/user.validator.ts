import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['admin', 'manager', 'trainer']),
});

export const updateUserSchema = z.object({
  role: z.enum(['admin', 'manager', 'trainer']).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
