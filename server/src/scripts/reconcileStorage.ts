import { getDb, closeDb } from '../db/client.js';
import { reportFiles } from '../db/schema/index.js';
import { getStorageService } from '../services/storage/index.js';
import { logger } from '../utils/logger.js';

export async function reconcileStorage() {
  console.log('🔍 Starting storage reconciliation check...');
  const db = getDb();
  const storage = getStorageService();

  // 1. Fetch all DB rows
  const dbRows = await db
    .select({
      id: reportFiles.id,
      originalName: reportFiles.originalName,
      objectKey: reportFiles.objectKey,
      kind: reportFiles.kind,
      version: reportFiles.version,
    })
    .from(reportFiles);

  const dbKeysMap = new Map<string, typeof dbRows[0]>();
  for (const row of dbRows) {
    dbKeysMap.set(row.objectKey, row);
  }

  // 2. List all storage keys
  const storageKeys = await storage.list();
  const storageKeySet = new Set(storageKeys);

  // 3. Find rows without objects in storage
  const rowsWithoutObjects: Array<{ id: string; objectKey: string; originalName: string }> = [];
  for (const row of dbRows) {
    if (!storageKeySet.has(row.objectKey)) {
      rowsWithoutObjects.push({
        id: row.id,
        objectKey: row.objectKey,
        originalName: row.originalName,
      });
    }
  }

  // 4. Find objects in storage without corresponding DB rows
  const objectsWithoutRows: string[] = [];
  for (const key of storageKeys) {
    if (!dbKeysMap.has(key)) {
      objectsWithoutRows.push(key);
    }
  }

  // 5. Output report
  console.log('\n======================================================');
  console.log('       STORAGE RECONCILIATION AUDIT REPORT            ');
  console.log('======================================================');
  console.log(`Total database report records: ${dbRows.length}`);
  console.log(`Total storage objects found:   ${storageKeys.length}`);
  console.log('------------------------------------------------------');

  if (rowsWithoutObjects.length === 0 && objectsWithoutRows.length === 0) {
    console.log('✅ PERFECT MATCH: All database records have matching storage objects, and no orphaned storage objects exist.');
  } else {
    if (rowsWithoutObjects.length > 0) {
      console.warn(`\n⚠️  WARNING: ${rowsWithoutObjects.length} Database row(s) missing from Storage:`);
      for (const r of rowsWithoutObjects) {
        console.warn(`   - ID: ${r.id} | File: ${r.originalName} | Missing Key: ${r.objectKey}`);
      }
    }

    if (objectsWithoutRows.length > 0) {
      console.warn(`\n⚠️  WARNING: ${objectsWithoutRows.length} Storage object(s) without Database rows:`);
      for (const k of objectsWithoutRows) {
        console.warn(`   - Orphaned Key: ${k}`);
      }
    }
  }
  console.log('======================================================\n');

  return {
    totalDbRows: dbRows.length,
    totalStorageObjects: storageKeys.length,
    rowsWithoutObjects,
    objectsWithoutRows,
  };
}

if (process.argv[1]?.includes('reconcileStorage')) {
  reconcileStorage()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Storage reconciliation failed:', err);
      await closeDb();
      process.exit(1);
    });
}

