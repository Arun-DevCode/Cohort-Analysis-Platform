import { env } from '../../config/env.js';
import { S3StorageAdapter } from './s3Adapter.js';
import { MemoryStorageAdapter } from './memoryAdapter.js';
import { logger } from '../../utils/logger.js';

export interface StorageService {
  put(key: string, buffer: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  getPresignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

let activeStorage: StorageService | null = null;

export function getStorageService(forcedAdapter?: StorageService): StorageService {
  if (forcedAdapter) {
    activeStorage = forcedAdapter;
    return activeStorage;
  }

  if (activeStorage) {
    return activeStorage;
  }

  // Use S3 adapter if environment has S3 configured or standard AWS/Neon env vars, and not in isolated test
  const hasStorageConfig = Boolean(
    env.hasS3Config ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.NEON_STORAGE_ACCESS_KEY_ID ||
    process.env.AWS_ENDPOINT_URL ||
    process.env.AWS_ENDPOINT_URL_S3 ||
    process.env.NEON_STORAGE_ENDPOINT
  );

  if (hasStorageConfig && !env.isTest) {
    const bucket = process.env.NEON_STORAGE_BUCKET || process.env.AWS_S3_BUCKET || 'reports';
    logger.info({ bucket }, 'Initializing S3 Storage Adapter for Neon Object Storage');
    activeStorage = new S3StorageAdapter({
      endpoint: env.NEON_STORAGE_ENDPOINT || process.env.AWS_ENDPOINT_URL_S3 || process.env.AWS_ENDPOINT_URL,
      accessKeyId: env.NEON_STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.NEON_STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
      bucket,
    });
  } else {
    logger.info('Initializing Memory Storage Adapter');
    activeStorage = new MemoryStorageAdapter();
  }

  return activeStorage;
}

export function setStorageService(storage: StorageService | null): void {
  activeStorage = storage;
}

export { S3StorageAdapter, MemoryStorageAdapter };

