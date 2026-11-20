import { getDb, closeDb } from '../db/client.js';
import { batches, snapshots, uploads, reportFiles } from '../db/schema/index.js';

async function checkDb() {
  const db = getDb();
  const allBatches = await db.select().from(batches);
  console.log('Batches in DB:', allBatches);

  const allSnapshots = await db.select().from(snapshots);
  console.log('Snapshots in DB:', allSnapshots);

  const allReportFiles = await db.select().from(reportFiles);
  console.log('Report Files in DB:', allReportFiles);

  await closeDb();
}

checkDb();

