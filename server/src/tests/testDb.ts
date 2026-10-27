import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema/index.js';
import { setTestDb } from '../db/client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createTestDatabase() {
  const pglite = new PGlite();

  // Read and execute all migration SQL files in order
  const migrationsDir = path.join(__dirname, '../db/migrations');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await pglite.exec(statement);
    }
  }

  const testDb = drizzle(pglite, { schema });
  setTestDb(testDb as any);
  return testDb;
}
