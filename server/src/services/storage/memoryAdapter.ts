import type { StorageService } from './index.js';

export class MemoryStorageAdapter implements StorageService {
  private store: Map<string, { buffer: Buffer; contentType: string }> = new Map();

  async put(key: string, buffer: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    this.store.set(key, { buffer: Buffer.from(buffer), contentType });
  }

  async get(key: string): Promise<Buffer> {
    const item = this.store.get(key);
    if (!item) {
      throw new Error(`NoSuchKey: ${key} not found in memory storage`);
    }
    return Buffer.from(item.buffer);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());
    if (!prefix) return allKeys;
    return allKeys.filter((k) => k.startsWith(prefix));
  }

  async getPresignedUrl(key: string): Promise<string> {
    return `/api/v1/files/download/${encodeURIComponent(key)}`;
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

