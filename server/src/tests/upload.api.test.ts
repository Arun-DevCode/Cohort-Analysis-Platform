import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import { users, batches, batchTrainers, snapshots, studentSnapshots } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, '../../tests/fixtures/Cumulative_Report_Batch_15748.xlsx');

describe('Upload & Snapshot Ingestion API Integration Tests', () => {
  let adminToken: string;
  let trainerToken: string;
  let managerToken: string;
  let batchId: string;
  let unassignedBatchId: string;

  beforeEach(async () => {
    const db = await createTestDatabase();

    const passwordHash = await AuthService.hashPassword('Pass1234');

    // Admin
    const [admin] = await db
      .insert(users)
      .values({ email: 'admin@test.com', passwordHash, role: 'admin' })
      .returning();
    adminToken = AuthService.generateTokens({
      userId: admin.id,
      email: admin.email,
      role: 'admin',
    }).accessToken;

    // Manager
    const [manager] = await db
      .insert(users)
      .values({ email: 'manager@test.com', passwordHash, role: 'manager' })
      .returning();
    managerToken = AuthService.generateTokens({
      userId: manager.id,
      email: manager.email,
      role: 'manager',
    }).accessToken;

    // Trainer
    const [trainer] = await db
      .insert(users)
      .values({ email: 'trainer@test.com', passwordHash, role: 'trainer' })
      .returning();
    trainerToken = AuthService.generateTokens({
      userId: trainer.id,
      email: trainer.email,
      role: 'trainer',
    }).accessToken;

    // Batches
    const [b1] = await db
      .insert(batches)
      .values({ name: 'Batch 15748', externalBatchId: 'BATCH-15748', createdBy: admin.id })
      .returning();
    batchId = b1.id;

    const [b2] = await db
      .insert(batches)
      .values({ name: 'Batch Unassigned', externalBatchId: 'BATCH-99999', createdBy: admin.id })
      .returning();
    unassignedBatchId = b2.id;

    // Assign Trainer to batch 1
    await db.insert(batchTrainers).values({
      batchId,
      userId: trainer.id,
    });
  });

  it('Admin can upload LMS Excel export and create dated snapshot', async () => {
    const res = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    expect(res.status).toBe(201);
    expect(res.body.uploadId).toBeDefined();
    expect(res.body.snapshot).toBeDefined();
    expect(res.body.snapshot.totalStudents).toBe(31);
    expect(res.body.snapshot.averages.assignmentSubmissionAvg).toBe(62.1);
    expect(res.body.snapshot.averages.totalConsumptionAvg).toBe(67.8);
    expect(res.body.snapshot.averages.liveAttendanceAvg).toBe(72.9);

    const uploadId = res.body.uploadId;

    // Verify GET /uploads/:id
    const statusRes = await request(app)
      .get(`/api/v1/uploads/${uploadId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.upload.status).toBe('done');

    // Verify GET /batches/:id/snapshots
    const snapListRes = await request(app)
      .get(`/api/v1/batches/${batchId}/snapshots`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(snapListRes.status).toBe(200);
    expect(snapListRes.body.snapshots.length).toBe(1);
    expect(snapListRes.body.snapshots[0].snapshotDate).toBe('2026-10-21');
  });

  it('Duplicate date upload returns 409 Conflict without replace=true', async () => {
    // 1st Upload
    await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    // 2nd Upload same date
    const dupRes = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    expect(dupRes.status).toBe(409);
    expect(dupRes.body.code).toBe('SNAPSHOT_EXISTS');
  });

  it('Duplicate date upload succeeds when replace=true is provided', async () => {
    // 1st Upload
    await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    // Re-upload with replace=true
    const replaceRes = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21')
      .field('replace', 'true');

    expect(replaceRes.status).toBe(201);
    expect(replaceRes.body.snapshot.totalStudents).toBe(31);
  });

  it('Trainer can upload to assigned batch', async () => {
    const res = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    expect(res.status).toBe(201);
  });

  it('Trainer is forbidden from uploading to unassigned batch (404)', async () => {
    const res = await request(app)
      .post(`/api/v1/batches/${unassignedBatchId}/uploads`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    expect(res.status).toBe(404);
  });

  it('Manager cannot upload files (403)', async () => {
    const res = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    expect(res.status).toBe(403);
  });

  it('Rejects non-xlsx file with 400', async () => {
    const res = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('plain text file'), 'report.txt');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE_TYPE');
  });
});
