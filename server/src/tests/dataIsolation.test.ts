import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import { users, batches, batchTrainers, students } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, '../../tests/fixtures/Cumulative_Report_Batch_15748.xlsx');

describe('Data Isolation & Multi-Tenant Authorization Tests', () => {
  let userAToken: string;
  let userBToken: string;
  let adminToken: string;
  let managerToken: string;
  let assignedTrainerToken: string;

  let userAId: string;
  let userBId: string;
  let adminId: string;
  let managerId: string;
  let assignedTrainerId: string;

  let batchAId: string;
  let uploadAId: string;
  let studentAId: string;
  let snapshotAId: string;
  let activeDb: any;

  beforeEach(async () => {
    activeDb = await createTestDatabase();
    const db = activeDb;
    const passwordHash = await AuthService.hashPassword('Secret123!');

    // 1. Create User A (Trainer)
    const [userA] = await db
      .insert(users)
      .values({ email: 'userA@platform.test', passwordHash, role: 'trainer', name: 'User A' })
      .returning();
    userAId = userA.id;
    userAToken = AuthService.generateTokens({
      userId: userA.id,
      email: userA.email,
      role: 'trainer',
      name: userA.name,
    }).accessToken;

    // 2. Create User B (Trainer)
    const [userB] = await db
      .insert(users)
      .values({ email: 'userB@platform.test', passwordHash, role: 'trainer', name: 'User B' })
      .returning();
    userBId = userB.id;
    userBToken = AuthService.generateTokens({
      userId: userB.id,
      email: userB.email,
      role: 'trainer',
      name: userB.name,
    }).accessToken;

    // 3. Create Admin
    const [admin] = await db
      .insert(users)
      .values({ email: 'admin@platform.test', passwordHash, role: 'admin', name: 'Admin' })
      .returning();
    adminId = admin.id;
    adminToken = AuthService.generateTokens({
      userId: admin.id,
      email: admin.email,
      role: 'admin',
      name: admin.name,
    }).accessToken;

    // 4. Create Manager
    const [manager] = await db
      .insert(users)
      .values({ email: 'manager@platform.test', passwordHash, role: 'manager', name: 'Manager' })
      .returning();
    managerId = manager.id;
    managerToken = AuthService.generateTokens({
      userId: manager.id,
      email: manager.email,
      role: 'manager',
      name: manager.name,
    }).accessToken;

    // 5. Create Assigned Trainer (assigned to Batch A)
    const [assignedTrainer] = await db
      .insert(users)
      .values({ email: 'assigned@platform.test', passwordHash, role: 'trainer', name: 'Assigned Trainer' })
      .returning();
    assignedTrainerId = assignedTrainer.id;
    assignedTrainerToken = AuthService.generateTokens({
      userId: assignedTrainer.id,
      email: assignedTrainer.email,
      role: 'trainer',
      name: assignedTrainer.name,
    }).accessToken;

    // 6. User A creates Batch A and uploads report fixture
    const createBatchRes = await request(app)
      .post('/api/v1/batches')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: "User A's Cohort",
        externalBatchId: 'BATCH-A-100',
        startDate: '2026-10-21',
      });
    expect(createBatchRes.status).toBe(201);
    batchAId = createBatchRes.body.batch.id;

    // User A uploads report to Batch A
    const uploadRes = await request(app)
      .post(`/api/v1/batches/${batchAId}/uploads`)
      .set('Authorization', `Bearer ${userAToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');
    expect(uploadRes.status).toBe(201);

    uploadAId = uploadRes.body.uploadId;
    snapshotAId = uploadRes.body.snapshot.snapshotId;

    // Assign 'assignedTrainer' to Batch A via batchTrainers
    await db.insert(batchTrainers).values({
      batchId: batchAId,
      userId: assignedTrainerId,
    });

    // Grab one student ID from the uploaded batch
    const anyStudent = await db.query.students.findFirst();
    expect(anyStudent).toBeDefined();
    studentAId = anyStudent!.id;
  });

  // TEST 1: User A uploads a report. User B logs in and calls GET /batches: empty list.
  it('1. User B logs in and calls GET /batches: returns empty list', async () => {
    const res = await request(app)
      .get('/api/v1/batches')
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.batches)).toBe(true);
    expect(res.body.batches.length).toBe(0);
  });

  // TEST 2: User B calls GET /batches/:A_batch/overview, /compare, /at-risk, /assignments, /content, /attendance: all return 404
  it('2. User B calls overview, compare, at-risk, assignments, content, attendance for Batch A: all return 404', async () => {
    const endpoints = [
      `/api/v1/batches/${batchAId}`,
      `/api/v1/batches/${batchAId}/snapshots`,
      `/api/v1/batches/${batchAId}/overview`,
      `/api/v1/batches/${batchAId}/compare?from=${snapshotAId}&to=${snapshotAId}`,
      `/api/v1/batches/${batchAId}/at-risk`,
      `/api/v1/batches/${batchAId}/assignments`,
      `/api/v1/batches/${batchAId}/content`,
      `/api/v1/batches/${batchAId}/attendance`,
    ];

    for (const endpoint of endpoints) {
      const res = await request(app)
        .get(endpoint)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status, `Endpoint ${endpoint} should return 404`).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });

  // TEST 3: User B calls GET /students/:A_student_id and GET /uploads/:A_upload_id: 404
  it('3. User B calls GET /students/:A_student_id and GET /uploads/:A_upload_id: both return 404', async () => {
    const studentRes = await request(app)
      .get(`/api/v1/students/${studentAId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(studentRes.status).toBe(404);
    expect(studentRes.body.code).toBe('NOT_FOUND');

    const uploadRes = await request(app)
      .get(`/api/v1/uploads/${uploadAId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(uploadRes.status).toBe(404);
    expect(uploadRes.body.code).toBe('NOT_FOUND');
  });

  // TEST 4: User B cannot upload into A's batch (404) and cannot pass createdBy in the body to change the owner
  it("4. User B cannot upload into A's batch (404) and cannot pass createdBy in body to change owner", async () => {
    // Attempt to upload into Batch A
    const uploadRes = await request(app)
      .post(`/api/v1/batches/${batchAId}/uploads`)
      .set('Authorization', `Bearer ${userBToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-28');

    expect(uploadRes.status).toBe(404);
    expect(uploadRes.body.code).toBe('NOT_FOUND');

    // Attempt to create batch passing createdBy = userAId
    const createRes = await request(app)
      .post('/api/v1/batches')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: "User B's Hijack Attempt",
        externalBatchId: 'HIJACK-001',
        createdBy: userAId, // Spoofed field
      });

    expect(createRes.status).toBe(201);
    const createdBatchId = createRes.body.batch.id;

    // Verify in database that created_by is strictly User B's ID, NOT User A's ID
    const insertedBatch = await activeDb.query.batches.findFirst({
      where: eq(batches.id, createdBatchId),
    });
    expect(insertedBatch).toBeDefined();
    expect(insertedBatch!.createdBy).toBe(userBId);
    expect(insertedBatch!.createdBy).not.toBe(userAId);
  });

  // TEST 5: Admin can read both; manager can read but not upload; trainer assigned through batch_trainers can read only assigned batch
  it('5. Admin reads all, Manager reads but cannot upload, Trainer assigned reads only assigned batch', async () => {
    // User B creates Batch B
    const createBatchBRes = await request(app)
      .post('/api/v1/batches')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: "User B's Cohort",
        externalBatchId: 'BATCH-B-200',
        startDate: '2026-10-21',
      });
    expect(createBatchBRes.status).toBe(201);
    const batchBId = createBatchBRes.body.batch.id;

    // Admin can read Batch A and Batch B
    const adminReadA = await request(app)
      .get(`/api/v1/batches/${batchAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminReadA.status).toBe(200);

    const adminReadB = await request(app)
      .get(`/api/v1/batches/${batchBId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminReadB.status).toBe(200);

    // Manager can read Batch A and Batch B
    const managerReadA = await request(app)
      .get(`/api/v1/batches/${batchAId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerReadA.status).toBe(200);

    const managerReadB = await request(app)
      .get(`/api/v1/batches/${batchBId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerReadB.status).toBe(200);

    // Manager CANNOT upload (returns 403)
    const managerUpload = await request(app)
      .post(`/api/v1/batches/${batchAId}/uploads`)
      .set('Authorization', `Bearer ${managerToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-28');
    expect(managerUpload.status).toBe(403);

    // Trainer assigned through batch_trainers can read Batch A (200)
    const assignedReadA = await request(app)
      .get(`/api/v1/batches/${batchAId}`)
      .set('Authorization', `Bearer ${assignedTrainerToken}`);
    expect(assignedReadA.status).toBe(200);

    // Trainer assigned through batch_trainers CANNOT read Batch B (404 NOT_FOUND)
    const assignedReadB = await request(app)
      .get(`/api/v1/batches/${batchBId}`)
      .set('Authorization', `Bearer ${assignedTrainerToken}`);
    expect(assignedReadB.status).toBe(404);
    expect(assignedReadB.body.code).toBe('NOT_FOUND');
  });

  // TEST 6: A request without a token returns 401
  it('6. Request without a token returns 401 Unauthorized', async () => {
    const unauthBatches = await request(app).get('/api/v1/batches');
    expect(unauthBatches.status).toBe(401);
    expect(unauthBatches.body.code).toBe('UNAUTHORIZED');

    const unauthBatchA = await request(app).get(`/api/v1/batches/${batchAId}`);
    expect(unauthBatchA.status).toBe(401);
    expect(unauthBatchA.body.code).toBe('UNAUTHORIZED');

    const unauthStudent = await request(app).get(`/api/v1/students/${studentAId}`);
    expect(unauthStudent.status).toBe(401);
    expect(unauthStudent.body.code).toBe('UNAUTHORIZED');
  });

  // TEST 7: Phase 2 - Multi-tenant Student Scoping (Colliding Student IDs across Users A & B)
  it('7. Users A and B upload files with the same student ID/phone: both succeed, two separate rows exist per owner, no cross-user leaks, and re-upload updates without duplicate', async () => {
    // 1. User B creates their own Batch B
    const createBRes = await request(app)
      .post('/api/v1/batches')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: "User B's Cohort",
        externalBatchId: 'BATCH-B-UNIQUE-777',
        startDate: '2026-10-21',
      });
    expect(createBRes.status).toBe(201);
    const userBBatchId = createBRes.body.batch.id;

    // 2. User B uploads the exact same fixture (identical student IDs and phones as User A's batch)
    const uploadBRes = await request(app)
      .post(`/api/v1/batches/${userBBatchId}/uploads`)
      .set('Authorization', `Bearer ${userBToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21');
    expect(uploadBRes.status).toBe(201);

    // Grab student A's external ID
    const studentARow = await activeDb.query.students.findFirst({
      where: eq(students.id, studentAId),
    });
    expect(studentARow).toBeDefined();
    const commonExternalId = studentARow!.externalStudentId;

    // Condition (2): The database holds two separate student rows for the same externalStudentId, one per owner
    const matchingStudents = await activeDb
      .select()
      .from(students)
      .where(eq(students.externalStudentId, commonExternalId));

    expect(matchingStudents).toHaveLength(2);
    const studentForA = matchingStudents.find((s) => s.createdBy === userAId);
    const studentForB = matchingStudents.find((s) => s.createdBy === userBId);
    expect(studentForA).toBeDefined();
    expect(studentForB).toBeDefined();
    expect(studentForA!.id).not.toBe(studentForB!.id);

    const studentBId = studentForB!.id;

    // Condition (1):
    // - User B gets 404 on GET /students/:A_student_id
    const bGetsAStudent = await request(app)
      .get(`/api/v1/students/${studentAId}`)
      .set('Authorization', `Bearer ${userBToken}`);
    expect(bGetsAStudent.status).toBe(404);
    expect(bGetsAStudent.body.code).toBe('NOT_FOUND');

    // - User A gets 404 on GET /students/:B_student_id
    const aGetsBStudent = await request(app)
      .get(`/api/v1/students/${studentBId}`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect(aGetsBStudent.status).toBe(404);
    expect(aGetsBStudent.body.code).toBe('NOT_FOUND');

    // - A creates a followup on student A
    const aFollowupRes = await request(app)
      .post('/api/v1/followups')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        studentId: studentAId,
        note: "User A's private student note",
      });
    expect(aFollowupRes.status).toBe(201);

    // - B lists followups: A's followup is not present
    const bFollowupList = await request(app)
      .get('/api/v1/followups')
      .set('Authorization', `Bearer ${userBToken}`);
    expect(bFollowupList.status).toBe(200);
    expect(bFollowupList.body.data.some((f: any) => f.note && f.note.includes("User A's private student note"))).toBe(false);

    // - At-Risk check: A's at-risk list only includes A's students, B's at-risk list only includes B's students
    const aAtRisk = await request(app)
      .get(`/api/v1/batches/${batchAId}/at-risk`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect(aAtRisk.status).toBe(200);
    expect(aAtRisk.body.students.every((s: any) => s.studentId !== studentBId)).toBe(true);

    const bAtRisk = await request(app)
      .get(`/api/v1/batches/${userBBatchId}/at-risk`)
      .set('Authorization', `Bearer ${userBToken}`);
    expect(bAtRisk.status).toBe(200);
    expect(bAtRisk.body.students.every((s: any) => s.studentId !== studentAId)).toBe(true);

    // Condition (3): Re-uploading the same file as user A updates A's row and does not create a duplicate
    const reuploadRes = await request(app)
      .post(`/api/v1/batches/${batchAId}/uploads`)
      .set('Authorization', `Bearer ${userAToken}`)
      .attach('file', fixturePath)
      .field('snapshotDate', '2026-10-21')
      .field('replace', 'true');
    expect(reuploadRes.status).toBe(201);

    // Verify still exactly 1 row for User A for that student
    const studentsAfterReupload = await activeDb
      .select()
      .from(students)
      .where(and(eq(students.createdBy, userAId), eq(students.externalStudentId, commonExternalId)));
    expect(studentsAfterReupload).toHaveLength(1);
    expect(studentsAfterReupload[0].id).toBe(studentAId);
  });
});
