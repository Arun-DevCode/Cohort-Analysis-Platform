import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export type AppDatabase = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let dbInstance: AppDatabase | null = null;

export function getDb(): AppDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle pg client');
  });

  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

export function setTestDb(mockDb: AppDatabase) {
  dbInstance = mockDb;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}
