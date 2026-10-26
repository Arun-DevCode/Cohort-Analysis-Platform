import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiClient } from '../core/api/client';

describe('Frontend API Client & Backend Connection Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    apiClient.clearAuth();
    vi.restoreAllMocks();
  });

  it('checks backend health endpoint successfully', async () => {
    const mockHealthResponse = { status: 'ok', database: 'connected' };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockHealthResponse,
    } as unknown as Response);

    const health = await apiClient.checkHealth();
    expect(health.status).toBe('ok');
    expect(health.database).toBe('connected');
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/health', expect.any(Object));
  });

  it('logs in, stores JWT tokens in localStorage, and tracks user', async () => {
    const mockLoginResponse = {
      user: {
        id: 'user-123',
        email: 'admin@example.com',
        role: 'admin' as const,
        createdAt: new Date().toISOString(),
      },
      tokens: {
        accessToken: 'mock.access.token',
        refreshToken: 'mock.refresh.token',
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockLoginResponse,
    } as unknown as Response);

    const res = await apiClient.login('admin@example.com', 'Admin@123456');

    expect(res.user.email).toBe('admin@example.com');
    expect(apiClient.isAuthenticated()).toBe(true);
    expect(apiClient.getUser()?.email).toBe('admin@example.com');
    expect(localStorage.getItem('spp_access_token')).toBe('mock.access.token');
    expect(localStorage.getItem('spp_refresh_token')).toBe('mock.refresh.token');
  });

  it('attaches Authorization Bearer header on authenticated requests', async () => {
    // Seed token
    localStorage.setItem('spp_access_token', 'my-auth-token');
    const client = new (apiClient.constructor as new () => typeof apiClient)();

    const mockBatches = [{ id: 'b1', name: 'Batch 15748', externalBatchId: 'B-15748' }];
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ batches: mockBatches }),
    } as unknown as Response);

    const batches = await client.listBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0].name).toBe('Batch 15748');

    const lastCallHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(lastCallHeaders['Authorization']).toBe('Bearer my-auth-token');
  });

  it('clears credentials from localStorage on logout', async () => {
    localStorage.setItem('spp_access_token', 'test-token');
    localStorage.setItem('spp_refresh_token', 'test-refresh');
    localStorage.setItem('spp_user', JSON.stringify({ email: 'admin@test.com' }));

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'Logged out successfully' }),
    } as unknown as Response);

    await apiClient.logout();

    expect(apiClient.isAuthenticated()).toBe(false);
    expect(apiClient.getUser()).toBeNull();
    expect(localStorage.getItem('spp_access_token')).toBeNull();
    expect(localStorage.getItem('spp_refresh_token')).toBeNull();
  });
});
