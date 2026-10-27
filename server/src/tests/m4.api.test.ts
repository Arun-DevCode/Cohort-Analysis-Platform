import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import { users, batches, batchTrainers, students } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, '../../tests/fixtures/Cumulative_Report_Batch_15748.xlsx');

describe('Milestone 4: Student Profile, Follow-ups, Exports, Audit Log, Thresholds', () => {
  let adminToken: string;
  let trainerToken: string;
  let unassignedTrainerToken: string;
  let batchId: string;
  let testStudentId: string;
  let followupId: string;

  beforeAll(async () => {
    const db = await createTestDatabase();
    const passwordHash = await AuthService.hashPassword('Password123');

    // Admin
    const [admin] = await db
      .insert(users)
      .values({ email: 'admin@m4.com', passwordHash, role: 'admin' })
      .returning();
    adminToken = AuthService.generateTokens({
      userId: admin.id,
      email: admin.email,
      role: 'admin',
    }).accessToken;

    // Assigned Trainer
    const [trainer] = await db
      .insert(users)
      .values({ email: 'trainer@m4.com', passwordHash, role: 'trainer' })
      .returning();
    trainerToken = AuthService.generateTokens({
      userId: trainer.id,
      email: trainer.email,
      role: 'trainer',
    }).accessToken;

    // Unassigned Trainer
    const [unassignedTrainer] = await db
      .insert(users)
      .values({ email: 'unassigned@m4.com', passwordHash, role: 'trainer' })
      .returning();
    unassignedTrainerToken = AuthService.generateTokens({
      userId: unassignedTrainer.id,
      email: unassignedTrainer.email,
      role: 'trainer',
    }).accessToken;

    // Batch
    const [b] = await db
      .insert(batches)
      .values({ name: 'Batch 15748 M4', externalBatchId: 'BATCH-15748-M4', createdBy: admin.id })
      .returning();
    batchId = b.id;

    // Assign trainer to batch
    await db.insert(batchTrainers).values({
      batchId,
      userId: trainer.id,
    });

    // Upload snapshot fixture
    await request(app)
      .post(`/api/v1/batches/${batchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');

    // Fetch an ingested student
    const [firstStudent] = await db.select().from(students).limit(1);
    testStudentId = firstStudent.id;
  });

  describe('Student Profile (/api/v1/students/:id)', () => {
    it('Admin can view student profile with trajectory and details', async () => {
      const res = await request(app)
        .get(`/api/v1/students/${testStudentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.student).toBeDefined();
      expect(res.body.student.id).toBe(testStudentId);
      expect(res.body.latestMetrics).toBeDefined();
      expect(Array.isArray(res.body.history)).toBe(true);
      expect(Array.isArray(res.body.assignments)).toBe(true);
      expect(Array.isArray(res.body.weeklyConsumption)).toBe(true);
      expect(Array.isArray(res.body.attendance)).toBe(true);
    });

    it('Assigned trainer can view student profile', async () => {
      const res = await request(app)
        .get(`/api/v1/students/${testStudentId}`)
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(testStudentId);
    });

    it('Unassigned trainer is forbidden from viewing student profile (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/students/${testStudentId}`)
        .set('Authorization', `Bearer ${unassignedTrainerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('Follow-ups CRUD (/api/v1/followups)', () => {
    it('Trainer can create a follow-up note for an assigned student', async () => {
      const res = await request(app)
        .post('/api/v1/followups')
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({
          studentId: testStudentId,
          note: 'Discussed assignment delay with student. Agreed to submit by Friday.',
          status: 'in_progress',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.note).toContain('Discussed assignment delay');
      expect(res.body.status).toBe('in_progress');
      followupId = res.body.id;
    });

    it('Trainer can list follow-up notes with student and author info', async () => {
      const res = await request(app)
        .get('/api/v1/followups')
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const note = res.body.data.find((f: any) => f.id === followupId);
      expect(note).toBeDefined();
      expect(note.studentName).toBeDefined();
      expect(note.ownerEmail).toBe('trainer@m4.com');
    });

    it('Trainer can update their own follow-up note', async () => {
      const res = await request(app)
        .patch(`/api/v1/followups/${followupId}`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({
          status: 'done',
          note: 'Assignment received and graded.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
      expect(res.body.note).toBe('Assignment received and graded.');
    });

    it('Unassigned trainer cannot update another trainer follow-up note (404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/followups/${followupId}`)
        .set('Authorization', `Bearer ${unassignedTrainerToken}`)
        .send({ status: 'open' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('Admin can delete a follow-up note', async () => {
      const res = await request(app)
        .delete(`/api/v1/followups/${followupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });

  describe('Settings & Thresholds (/api/v1/settings/thresholds)', () => {
    it('Authenticated user can retrieve default thresholds', async () => {
      const res = await request(app)
        .get('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.assignmentSubmissionAtRisk).toBe(60);
      expect(res.body.consumptionAtRisk).toBe(50);
      expect(res.body.liveAttendanceAtRisk).toBe(60);
    });

    it('Admin can update configuration thresholds', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          assignmentSubmissionAtRisk: 65,
          consumptionAtRisk: 55,
          liveAttendanceAtRisk: 65,
          highSegmentMin: 85,
          mediumSegmentMin: 55,
        });

      expect(res.status).toBe(200);
      expect(res.body.assignmentSubmissionAtRisk).toBe(65);
      expect(res.body.highSegmentMin).toBe(85);
    });

    it('Trainer cannot update configuration thresholds (403)', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({
          assignmentSubmissionAtRisk: 70,
        });

      expect(res.status).toBe(403);
    });
  });

  describe('Audit Logs (/api/v1/audit-logs)', () => {
    it('Admin can list audit log entries', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const actions = res.body.data.map((log: any) => log.action);
      expect(actions).toContain('create_snapshot');
    });

    it('Trainer cannot access audit logs (403)', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Executive Report Export (/api/v1/batches/:id/report?format=xlsx)', () => {
    it('Admin can export formatted Excel report workbook', async () => {
      const res = await request(app)
        .get(`/api/v1/batches/${batchId}/report?format=xlsx`)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: any[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(1000);
    });

    it('Trainer is forbidden from exporting executive report (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/batches/${batchId}/report?format=xlsx`)
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(403);
    });
  });
});
