import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('OpenAPI & Swagger Documentation Endpoints', () => {
  it('GET /api-docs.json returns valid OpenAPI 3.0 specification', async () => {
    const res = await request(app).get('/api-docs.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toContain('Student Progress Analytics Platform');
    expect(res.body.paths['/api/v1/health']).toBeDefined();
    expect(res.body.paths['/api/v1/auth/login']).toBeDefined();
    expect(res.body.paths['/api/v1/batches']).toBeDefined();
    expect(res.body.paths['/api/v1/batches/{id}/uploads']).toBeDefined();
    expect(res.body.paths['/api/v1/batches/{id}/overview']).toBeDefined();
    expect(res.body.paths['/api/v1/batches/{id}/compare']).toBeDefined();
    expect(res.body.paths['/api/v1/batches/{id}/at-risk']).toBeDefined();
    expect(res.body.paths['/api/v1/students/{id}']).toBeDefined();
    expect(res.body.paths['/api/v1/followups']).toBeDefined();
    expect(res.body.paths['/api/v1/settings/thresholds']).toBeDefined();
    expect(res.body.paths['/api/v1/batches/{id}/report']).toBeDefined();
  });

  it('GET /api-docs/ serves Swagger UI HTML', async () => {
    const res = await request(app).get('/api-docs/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Swagger UI');
  });
});
