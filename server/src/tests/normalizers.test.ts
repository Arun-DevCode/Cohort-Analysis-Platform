import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  normalizeName,
  parsePercentage,
  parseNumber,
  parseAssignmentCell,
  parseWeekCell,
  extractSessionDate,
  computeFileHash,
} from '../utils/normalizers.js';

describe('Normalizers Unit Tests', () => {
  describe('normalizePhone', () => {
    it('normalizes 10-digit Indian numbers to E.164 (+91)', () => {
      expect(normalizePhone('8838399297')).toBe('+918838399297');
      expect(normalizePhone(8838399297)).toBe('+918838399297');
    });

    it('cleans formatted numbers with spaces, dashes, or brackets', () => {
      expect(normalizePhone('+91 88383-99297')).toBe('+918838399297');
      expect(normalizePhone('(0091) 8838399297')).toBe('+918838399297');
    });

    it('handles already valid E.164 numbers', () => {
      expect(normalizePhone('+918838399297')).toBe('+918838399297');
      expect(normalizePhone('+14155552671')).toBe('+14155552671');
    });

    it('returns empty string for null/undefined/empty', () => {
      expect(normalizePhone(null)).toBe('');
      expect(normalizePhone(undefined)).toBe('');
      expect(normalizePhone('')).toBe('');
    });
  });

  describe('normalizeName', () => {
    it('standardizes names to lowercase alphanumeric', () => {
      expect(normalizeName('Gowtham Raj')).toBe('gowthamraj');
      expect(normalizeName('  Dr. Jane-Doe  ')).toBe('drjanedoe');
    });
  });

  describe('parsePercentage', () => {
    it('parses numeric values and strings with %', () => {
      expect(parsePercentage(22.37)).toBe(22.37);
      expect(parsePercentage('20.7%')).toBe(20.7);
      expect(parsePercentage(' 85.5 % ')).toBe(85.5);
      expect(parsePercentage(0)).toBe(0);
      expect(parsePercentage(null)).toBe(0);
    });
  });

  describe('parseAssignmentCell', () => {
    it('splits status and score correctly', () => {
      expect(parseAssignmentCell('PASSED / 10')).toEqual({ status: 'PASSED', score: 10 });
      expect(parseAssignmentCell('SUBMISSION_PENDING / -')).toEqual({
        status: 'SUBMISSION_PENDING',
        score: null,
      });
      expect(parseAssignmentCell('FAILED / 4.5')).toEqual({ status: 'FAILED', score: 4.5 });
      expect(parseAssignmentCell('')).toEqual({ status: 'NOT_SUBMITTED', score: null });
    });
  });

  describe('parseWeekCell', () => {
    it('parses a/b format into consumed and total', () => {
      expect(parseWeekCell('5/7')).toEqual({ consumed: 5, total: 7 });
      expect(parseWeekCell(' 0 / 10 ')).toEqual({ consumed: 0, total: 10 });
      expect(parseWeekCell('')).toEqual({ consumed: 0, total: 0 });
    });
  });

  describe('extractSessionDate', () => {
    it('extracts DD-MM-YYYY and formats as YYYY-MM-DD', () => {
      const col = 'TN-AFSD-ANB49-21OCT-Phase 2 Reflection  Over-21-10-2026';
      expect(extractSessionDate(col)).toBe('2026-10-21');
    });

    it('returns null if date not found', () => {
      expect(extractSessionDate('General Attendance')).toBeNull();
    });
  });

  describe('computeFileHash', () => {
    it('computes 64-character SHA-256 hex digest', () => {
      const hash = computeFileHash(Buffer.from('test data'));
      expect(hash).toHaveLength(64);
    });
  });
});
