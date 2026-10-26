import { describe, it, expect } from 'vitest';
import { normalizePhone, normalizeName } from './phone';

describe('identity normalizers', () => {
  describe('normalizePhone', () => {
    it('normalizes 10 digit Indian numbers', () => {
      expect(normalizePhone('9952087613')).toBe('+919952087613');
      expect(normalizePhone('9952-087-613')).toBe('+919952087613');
    });

    it('retains valid E.164 numbers', () => {
      expect(normalizePhone('+918838399297')).toBe('+918838399297');
      expect(normalizePhone('+31611313744')).toBe('+31611313744');
    });

    it('handles numbers starting with 91 or 00', () => {
      expect(normalizePhone('918838399297')).toBe('+918838399297');
      expect(normalizePhone('0031611313744')).toBe('+31611313744');
    });

    it('handles empty and nulls', () => {
      expect(normalizePhone('')).toBe('');
      expect(normalizePhone(null)).toBe('');
      expect(normalizePhone(undefined)).toBe('');
    });
  });

  describe('normalizeName', () => {
    it('strips spaces, punctuation and lowercases', () => {
      expect(normalizeName('Naveen Kumar S')).toBe('naveenkumars');
      expect(normalizeName('Harina. S')).toBe('harinas');
      expect(normalizeName('  Ajay.A  ')).toBe('ajaya');
    });
  });
});
