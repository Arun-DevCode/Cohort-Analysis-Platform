import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closeDb } from './client.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  logger.info('Running database migrations...');
  const db = getDb();
  const migrationsFolder = path.join(__dirname, 'migrations');
  
  await migrate(db, { migrationsFolder });
  logger.info('Database migrations applied successfully.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Migration failed');
      await closeDb();
      process.exit(1);
    });
}
