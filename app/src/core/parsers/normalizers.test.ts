import { describe, it, expect } from 'vitest';
import {
  parsePercentage,
  parseNumber,
  parseAssignmentCell,
  parseWeekCell,
  extractSessionDate,
} from './normalizers';

describe('normalizers', () => {
  describe('parsePercentage', () => {
    it('normalizes string percentage', () => {
      expect(parsePercentage('20.7%')).toBe(20.7);
      expect(parsePercentage(' 62.1% ')).toBe(62.1);
      expect(parsePercentage('100%')).toBe(100);
    });

    it('normalizes numeric percentage', () => {
      expect(parsePercentage(22.37)).toBe(22.37);
      expect(parsePercentage(0)).toBe(0);
      expect(parsePercentage(82.76000000000001)).toBe(82.76);
    });

    it('handles empty or invalid inputs', () => {
      expect(parsePercentage('')).toBe(0);
      expect(parsePercentage(null)).toBe(0);
      expect(parsePercentage(undefined)).toBe(0);
      expect(parsePercentage('invalid')).toBe(0);
    });
  });

  describe('parseNumber', () => {
    it('parses numbers and numeric strings', () => {
      expect(parseNumber('14')).toBe(14);
      expect(parseNumber(25)).toBe(25);
      expect(parseNumber('0')).toBe(0);
    });

    it('returns default value for empty or invalid', () => {
      expect(parseNumber('', 0)).toBe(0);
      expect(parseNumber(null, 5)).toBe(5);
      expect(parseNumber(undefined, 10)).toBe(10);
    });
  });

  describe('parseAssignmentCell', () => {
    it('splits status and score correctly', () => {
      expect(parseAssignmentCell('PASSED / 10')).toEqual({ status: 'PASSED', score: 10 });
      expect(parseAssignmentCell('SUBMISSION_PENDING / -')).toEqual({ status: 'SUBMISSION_PENDING', score: null });
      expect(parseAssignmentCell('DELAYED / 8.5')).toEqual({ status: 'DELAYED', score: 8.5 });
      expect(parseAssignmentCell('FAILED / 3')).toEqual({ status: 'FAILED', score: 3 });
    });

    it('handles null, empty or missing scores', () => {
      expect(parseAssignmentCell('')).toEqual({ status: 'NOT_SUBMITTED', score: null });
      expect(parseAssignmentCell(null)).toEqual({ status: 'NOT_SUBMITTED', score: null });
      expect(parseAssignmentCell('SUBMISSION_PENDING / NA')).toEqual({ status: 'SUBMISSION_PENDING', score: null });
    });
  });

  describe('parseWeekCell', () => {
    it('splits consumed and total', () => {
      expect(parseWeekCell('5/7')).toEqual({ consumed: 5, total: 7 });
      expect(parseWeekCell('0/10')).toEqual({ consumed: 0, total: 10 });
      expect(parseWeekCell('6/6')).toEqual({ consumed: 6, total: 6 });
    });

    it('handles single numbers or empty', () => {
      expect(parseWeekCell('5')).toEqual({ consumed: 5, total: 0 });
      expect(parseWeekCell('')).toEqual({ consumed: 0, total: 0 });
      expect(parseWeekCell(null)).toEqual({ consumed: 0, total: 0 });
    });
  });

  describe('extractSessionDate', () => {
    it('extracts date from column header', () => {
      expect(
        extractSessionDate('TN-AFSD-ANB49-21OCT-Phase 2 Reflection  Over-21-10-2026')
      ).toBe('2026-10-21');
      expect(
        extractSessionDate('TN-AFSD-ANB49-31AUG-Positioning , Media Queri-31-08-2026')
      ).toBe('2026-08-31');
      expect(
        extractSessionDate('Orientation - Pre Placement Pod1 Community TN-08-09-2026')
      ).toBe('2026-09-08');
    });

    it('returns null if no date pattern found', () => {
      expect(extractSessionDate('Attendance Percentage')).toBeNull();
      expect(extractSessionDate('Name')).toBeNull();
    });
  });
});
