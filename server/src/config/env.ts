import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../server/.env') });
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').default('postgres://postgres:postgres@localhost:5432/student_progress'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default('development_jwt_secret_super_secure_32_chars_minimum'),
  REFRESH_SECRET: z.string().min(16, 'REFRESH_SECRET must be at least 16 characters').default('development_refresh_secret_super_secure_32_chars_min'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  INITIAL_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  INITIAL_ADMIN_PASSWORD: z.string().min(6).default('Admin@123456'),
  NEON_STORAGE_ENDPOINT: z.string().optional(),
  NEON_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  NEON_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  NEON_STORAGE_BUCKET: z.string().default('reports'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`❌ Invalid environment variables detected:\n${issues}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
  hasS3Config: Boolean(
    parsed.data.NEON_STORAGE_ENDPOINT &&
    parsed.data.NEON_STORAGE_ACCESS_KEY_ID &&
    parsed.data.NEON_STORAGE_SECRET_ACCESS_KEY &&
    parsed.data.NEON_STORAGE_BUCKET
  ),
};

export type Env = typeof env;
