import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import { users, batches, batchTrainers } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';

describe('RBAC & Batch Access Integration Tests', () => {
  let adminToken: string;
  let managerToken: string;
  let trainerToken: string;
  let trainerId: string;
  let batch1Id: string;
  let batch2Id: string;

  beforeEach(async () => {
    const db = await createTestDatabase();

    const passwordHash = await AuthService.hashPassword('Password123');

    // 1. Create Admin
    const [adminUser] = await db
      .insert(users)
      .values({ email: 'admin@example.com', passwordHash, role: 'admin' })
      .returning();
    adminToken = AuthService.generateTokens({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'admin',
    }).accessToken;

    // 2. Create Manager
    const [managerUser] = await db
      .insert(users)
      .values({ email: 'manager@example.com', passwordHash, role: 'manager' })
      .returning();
    managerToken = AuthService.generateTokens({
      userId: managerUser.id,
      email: managerUser.email,
      role: 'manager',
    }).accessToken;

    // 3. Create Trainer
    const [trainerUser] = await db
      .insert(users)
      .values({ email: 'trainer@example.com', passwordHash, role: 'trainer' })
      .returning();
    trainerId = trainerUser.id;
    trainerToken = AuthService.generateTokens({
      userId: trainerUser.id,
      email: trainerUser.email,
      role: 'trainer',
    }).accessToken;

    // 4. Create Two Batches
    const [b1] = await db
      .insert(batches)
      .values({ name: 'Batch Alpha', externalBatchId: 'ALPHA-001', createdBy: adminUser.id })
      .returning();
    batch1Id = b1.id;

    const [b2] = await db
      .insert(batches)
      .values({ name: 'Batch Beta', externalBatchId: 'BETA-002', createdBy: adminUser.id })
      .returning();
    batch2Id = b2.id;

    // 5. Assign Trainer to Batch 1 ONLY
    await db.insert(batchTrainers).values({
      batchId: batch1Id,
      userId: trainerId,
    });
  });

  describe('User Management RBAC (/api/v1/users)', () => {
    it('Admin can list users', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.users.length).toBe(3);
    });

    it('Trainer cannot list users (403)', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('Manager cannot create a user (403)', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          email: 'newtrainer@example.com',
          password: 'Password123',
          role: 'trainer',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('Admin can create a new user', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'newtrainer@example.com',
          password: 'Password123',
          role: 'trainer',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('newtrainer@example.com');
      expect(res.body.user.role).toBe('trainer');
    });

    it('Admin can update a user role', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${trainerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'manager' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('manager');
    });
  });

  describe('Batch Access & Trainer Assignment (/api/v1/batches)', () => {
    it('Trainer can access assigned batch', async () => {
      const res = await request(app)
        .get(`/api/v1/batches/${batch1Id}`)
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.batch.id).toBe(batch1Id);
    });

    it('Trainer is forbidden from accessing unassigned batch (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/batches/${batch2Id}`)
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('Trainer lists only assigned batches', async () => {
      const res = await request(app)
        .get('/api/v1/batches')
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.batches.length).toBe(1);
      expect(res.body.batches[0].id).toBe(batch1Id);
    });

    it('Manager can access any batch', async () => {
      const res1 = await request(app)
        .get(`/api/v1/batches/${batch1Id}`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get(`/api/v1/batches/${batch2Id}`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(res2.status).toBe(200);
    });

    it('Admin can create, assign trainers, update, and delete batch', async () => {
      // 1. Create
      const createRes = await request(app)
        .post('/api/v1/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Batch Gamma',
          externalBatchId: 'GAMMA-003',
          startDate: '2026-11-01',
        });
      expect(createRes.status).toBe(201);
      const newBatchId = createRes.body.batch.id;

      // 2. Assign Trainer
      const assignRes = await request(app)
        .post(`/api/v1/batches/${newBatchId}/trainers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userIds: [trainerId] });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.trainers.length).toBe(1);

      // 3. Update
      const updateRes = await request(app)
        .patch(`/api/v1/batches/${newBatchId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Batch Gamma Renamed' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.batch.name).toBe('Batch Gamma Renamed');

      // 4. Delete
      const deleteRes = await request(app)
        .delete(`/api/v1/batches/${newBatchId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteRes.status).toBe(200);
    });
  });
});
