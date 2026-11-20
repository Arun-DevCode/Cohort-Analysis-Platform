import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageService } from './index.js';
import { logger } from '../../utils/logger.js';

export interface S3AdapterConfig {
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
}

export class S3StorageAdapter implements StorageService {
  private client: S3Client;
  private bucket: string;

  constructor(config?: Partial<S3AdapterConfig>) {
    this.bucket =
      config?.bucket ||
      process.env.NEON_STORAGE_BUCKET ||
      process.env.AWS_S3_BUCKET ||
      'reports';

    const clientConfig: S3ClientConfig = {
      forcePathStyle: true, // Neon Object Storage requires path-style URLs
    };

    const endpoint =
      config?.endpoint ||
      process.env.NEON_STORAGE_ENDPOINT ||
      process.env.AWS_ENDPOINT_URL_S3 ||
      process.env.AWS_ENDPOINT_URL;

    if (endpoint) {
      clientConfig.endpoint = endpoint;
    }

    const region =
      config?.region ||
      process.env.AWS_REGION ||
      'auto';
    clientConfig.region = region;

    const accessKeyId =
      config?.accessKeyId ||
      process.env.NEON_STORAGE_ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY_ID;

    const secretAccessKey =
      config?.secretAccessKey ||
      process.env.NEON_STORAGE_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY;

    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  async put(key: string, buffer: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await this.client.send(cmd);
  }

  async get(key: string): Promise<Buffer> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const res = await this.client.send(cmd);
    if (!res.Body) {
      throw new Error(`Object ${key} empty body from storage`);
    }
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    const cmd = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(cmd);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const cmd = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(cmd);
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      logger.warn({ key, err: err.message }, 'Storage exists check encountered error');
      throw err;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const cmd: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const res: ListObjectsV2CommandOutput = await this.client.send(cmd);
      if (res.Contents) {
        for (const item of res.Contents) {
          if (item.Key) keys.push(item.Key);
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }
}
