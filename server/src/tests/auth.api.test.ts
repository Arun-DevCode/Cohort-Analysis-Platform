import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import { users } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';

describe('Auth API Integration Tests', () => {
  beforeEach(async () => {
    const db = await createTestDatabase();

    // Seed test admin user
    const passwordHash = await AuthService.hashPassword('AdminPassword123');
    await db.insert(users).values({
      email: 'admin@example.com',
      passwordHash,
      role: 'admin',
    });
  });

  it('POST /api/v1/auth/login succeeds with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassword123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('admin@example.com');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.tokens).toBeDefined();
    expect(res.body.tokens.accessToken).toBeDefined();
    expect(res.body.tokens.refreshToken).toBeDefined();
  });

  it('POST /api/v1/auth/login returns 401 with invalid password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('POST /api/v1/auth/login returns 400 with invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'any' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/v1/auth/refresh refreshes tokens successfully', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassword123' });

    const refreshToken = loginRes.body.tokens.refreshToken;

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.tokens).toBeDefined();
    expect(res.body.tokens.accessToken).toBeDefined();
    expect(res.body.tokens.refreshToken).toBeDefined();
  });

  it('POST /api/v1/auth/refresh returns 401 for corrupted refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid.token.here' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('POST /api/v1/auth/register registers a new user successfully', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'Password123!',
        role: 'trainer',
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.name).toBe('Jane Doe');
    expect(res.body.user.email).toBe('jane@example.com');
    expect(res.body.user.role).toBe('trainer');
    expect(res.body.tokens.accessToken).toBeDefined();
  });

  it('POST /api/v1/auth/register returns 409 if email already exists', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Admin Clone',
        email: 'admin@example.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('USER_EXISTS');
  });

  it('GET /api/v1/auth/me returns current authenticated user profile', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassword123' });

    const token = loginRes.body.tokens.accessToken;

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('admin@example.com');
  });

  it('POST /api/v1/auth/logout returns 200', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Logged out');
  });
});
