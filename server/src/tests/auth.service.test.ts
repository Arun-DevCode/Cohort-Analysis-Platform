import { describe, it, expect } from 'vitest';
import { AuthService } from '../services/auth.service.js';

describe('AuthService Unit Tests', () => {
  it('hashes passwords with argon2id and verifies correctly', async () => {
    const password = 'SuperSecretPassword123!';
    const hash = await AuthService.hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).toContain('$argon2id$');

    const isValid = await AuthService.verifyPassword(hash, password);
    expect(isValid).toBe(true);

    const isInvalid = await AuthService.verifyPassword(hash, 'WrongPassword');
    expect(isInvalid).toBe(false);
  });

  it('generates valid JWT access and refresh tokens', () => {
    const payload = {
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'trainer@example.com',
      role: 'trainer' as const,
    };

    const tokens = AuthService.generateTokens(payload);
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();

    const decodedAccess = AuthService.verifyAccessToken(tokens.accessToken);
    expect(decodedAccess.userId).toBe(payload.userId);
    expect(decodedAccess.email).toBe(payload.email);
    expect(decodedAccess.role).toBe(payload.role);

    const decodedRefresh = AuthService.verifyRefreshToken(tokens.refreshToken);
    expect(decodedRefresh.userId).toBe(payload.userId);
    expect(decodedRefresh.email).toBe(payload.email);
    expect(decodedRefresh.role).toBe(payload.role);
  });

  it('throws when verifying an invalid or tampered token', () => {
    expect(() => AuthService.verifyAccessToken('invalid.token.here')).toThrow();
    expect(() => AuthService.verifyRefreshToken('invalid.token.here')).toThrow();
  });
});
