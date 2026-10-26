import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/student_progress'),
  JWT_SECRET: z.string().min(16).default('development_jwt_secret_super_secure_32_chars_minimum'),
  REFRESH_SECRET: z.string().min(16).default('development_refresh_secret_super_secure_32_chars_min'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  INITIAL_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  INITIAL_ADMIN_PASSWORD: z.string().min(6).default('Admin@123456'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
