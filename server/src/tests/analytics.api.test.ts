import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import { users, batches, batchTrainers } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, '../../tests/fixtures/Cumulative_Report_Batch_15748.xlsx');

describe('Analytics & Insights API Integration Tests', () => {
  let adminToken: string;
  let batchId: string;
  let snapshot1Id: string;
  let snapshot2Id: string;

  beforeAll(async () => {
    const db = await createTestDatabase();
    const passwordHash = await AuthService.hashPassword('AdminPass123');

    // Admin
    const [admin] = await db
      .insert(users)
      .values({ email: 'admin@analytics.com', passwordHash, role: 'admin' })
      .returning();
    adminToken = AuthService.generateTokens({
      userId: admin.id,
      email: admin.email,
      role: 'admin',
    }).accessToken;

    // Batch
    const [b] = await db
      .insert(batches)
      .values({ name: 'Batch 15748', externalBatchId: 'BATCH-15748' })
      .returning();
    batchId = b.id;

    // Upload 1st Snapshot (Date: 2026-10-21)
    const upload1 = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');
    snapshot1Id = upload1.body.snapshot.snapshotId;

    // Upload 2nd Snapshot (Date: 2026-10-28)
    const upload2 = await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-28');
    snapshot2Id = upload2.body.snapshot.snapshotId;
  });

  it('GET /api/v1/batches/:id/overview returns scorecards, deltas, trends, and top widgets', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchId}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.batchId).toBe(batchId);
    expect(res.body.snapshotId).toBe(snapshot2Id);
    expect(res.body.totalStudents).toBe(31);

    // Scorecards
    const sc = res.body.scorecards;
    expect(sc.assignment.currentValue).toBe(62.1);
    expect(sc.assignment.previousValue).toBe(62.1);
    expect(sc.assignment.deltaPts).toBe(0.0);
    expect(sc.consumption.currentValue).toBe(67.8);
    expect(sc.liveAttendance.currentValue).toBe(72.9);

    // Trend Series (2 snapshots)
    expect(res.body.trendSeries).toHaveLength(2);
    expect(res.body.trendSeries[0].snapshotDate).toBe('2026-10-21');
    expect(res.body.trendSeries[1].snapshotDate).toBe('2026-10-28');

    // Segment Distribution
    expect(res.body.segmentDistribution).toHaveLength(2);

    // Top widgets
    expect(res.body.topImprovers).toBeDefined();
    expect(res.body.needsAttention.length).toBeGreaterThan(0);
    expect(res.body.needsAttention[0].reasons.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/batches/:id/compare returns movement lists and 3x3 transition matrix', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchId}/compare?from=${snapshot1Id}&to=${snapshot2Id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.fromSnapshotId).toBe(snapshot1Id);
    expect(res.body.toSnapshotId).toBe(snapshot2Id);
    expect(res.body.comparisons).toHaveLength(31);

    // Since snapshots are identical in this test, movement should all be SAME
    expect(res.body.same).toHaveLength(31);
    expect(res.body.improved).toHaveLength(0);
    expect(res.body.declined).toHaveLength(0);

    // Transition matrix
    expect(res.body.matrix).toBeDefined();
    expect(res.body.matrix.high).toBeDefined();
    expect(res.body.matrix.medium).toBeDefined();
    expect(res.body.matrix.low).toBeDefined();
  });

  it('GET /api/v1/batches/:id/at-risk returns at-risk list with reason chips', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchId}/at-risk`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.students.length).toBeGreaterThan(0);

    const firstStudent = res.body.students[0];
    expect(firstStudent.studentId).toBeDefined();
    expect(firstStudent.name).toBeDefined();
    expect(firstStudent.reasons).toBeInstanceOf(Array);
    expect(firstStudent.reasons.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/batches/:id/at-risk?format=csv returns CSV file download', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchId}/at-risk?format=csv`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('text/csv');
    expect(res.text).toContain('Student ID,Student Name,Phone');
    expect(res.text).toContain('Low consumption');
  });

  it('GET /api/v1/batches/:id/assignments returns per-assignment stats and non-submitters', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(4);

    const a1 = res.body.assignments[0];
    expect(a1.total).toBe(31);
    expect(a1.submissionRate).toBeGreaterThan(0);
    expect(a1.averageScore).toBeGreaterThan(0);
    expect(a1.nonSubmitters).toBeInstanceOf(Array);
  });

  it('GET /api/v1/batches/:id/content returns 10 weeks of consumption breakdown', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchId}/content`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(10);
    expect(res.body.weeks[0].weekNo).toBe(1);
    expect(res.body.weeks[0].consumptionPct).toBeGreaterThan(0);
  });

  it('GET /api/v1/batches/:id/attendance returns 29 sessions and recording-only learners', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(29);
    expect(res.body.recordingOnlyLearners).toBeInstanceOf(Array);
  });
});
