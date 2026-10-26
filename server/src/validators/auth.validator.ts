import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().min(1, 'Full name is required').max(255),
  email: z.string().email('Valid email address is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['admin', 'manager', 'trainer']).default('trainer'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
