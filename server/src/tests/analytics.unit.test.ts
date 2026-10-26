import { describe, it, expect } from 'vitest';
import {
  computeAverage,
  computeDelta,
  getTrendDirection,
  classifyMovement,
} from '../services/analytics/metrics.js';
import {
  compareSnapshotStudents,
  StudentSnapshotFact,
} from '../services/analytics/segments.js';
import {
  identifyAtRiskStudents,
  exportAtRiskToCsv,
  AtRiskCandidate,
} from '../services/analytics/atRisk.js';

describe('Analytics Engine Unit Tests', () => {
  describe('Metrics & Deltas', () => {
    it('computes arithmetic average rounded to 1 decimal', () => {
      expect(computeAverage([60, 65, 70])).toBe(65.0);
      expect(computeAverage([62.15, 62.14])).toBe(62.1);
      expect(computeAverage([])).toBe(0);
    });

    it('computes delta in percentage points', () => {
      expect(computeDelta(65.5, 62.0)).toBe(3.5);
      expect(computeDelta(60.0, 65.5)).toBe(-5.5);
      expect(computeDelta(60.0, null)).toBeNull();
    });

    it('determines trend direction based on tolerance', () => {
      expect(getTrendDirection(2.5)).toBe('up');
      expect(getTrendDirection(-1.2)).toBe('down');
      expect(getTrendDirection(0.01)).toBe('flat');
      expect(getTrendDirection(null)).toBeNull();
    });

    it('classifies student movement as IMPROVED, SAME, or DECLINED', () => {
      expect(classifyMovement(2.5)).toBe('IMPROVED');
      expect(classifyMovement(2.0)).toBe('IMPROVED');
      expect(classifyMovement(1.9)).toBe('SAME');
      expect(classifyMovement(-1.9)).toBe('SAME');
      expect(classifyMovement(-2.0)).toBe('DECLINED');
      expect(classifyMovement(-5.0)).toBe('DECLINED');
    });
  });

  describe('Segment Comparison & Transition Matrix', () => {
    it('correctly populates 3x3 transition matrix and student movement lists', () => {
      const snapA: StudentSnapshotFact[] = [
        {
          studentId: 's1',
          externalStudentId: '101',
          name: 'Alice',
          phoneE164: '+919999999991',
          assignmentSubmissionPct: 50,
          totalConsumptionPct: 50,
          livePct: 50,
          liveOrRecPct: 50,
          segment: 'medium',
        },
        {
          studentId: 's2',
          externalStudentId: '102',
          name: 'Bob',
          phoneE164: '+919999999992',
          assignmentSubmissionPct: 85,
          totalConsumptionPct: 85,
          livePct: 85,
          liveOrRecPct: 85,
          segment: 'high',
        },
      ];

      const snapB: StudentSnapshotFact[] = [
        // Alice improved from medium (50) to high (85)
        {
          studentId: 's1',
          externalStudentId: '101',
          name: 'Alice',
          phoneE164: '+919999999991',
          assignmentSubmissionPct: 85,
          totalConsumptionPct: 85,
          livePct: 85,
          liveOrRecPct: 85,
          segment: 'high',
        },
        // Bob declined from high (85) to low (40)
        {
          studentId: 's2',
          externalStudentId: '102',
          name: 'Bob',
          phoneE164: '+919999999992',
          assignmentSubmissionPct: 40,
          totalConsumptionPct: 40,
          livePct: 40,
          liveOrRecPct: 40,
          segment: 'low',
        },
      ];

      const res = compareSnapshotStudents(snapA, snapB);

      expect(res.comparisons).toHaveLength(2);
      expect(res.improved).toHaveLength(1);
      expect(res.improved[0].name).toBe('Alice');
      expect(res.declined).toHaveLength(1);
      expect(res.declined[0].name).toBe('Bob');

      // Matrix transitions:
      // Alice: medium -> high
      expect(res.matrix.medium.high).toBe(1);
      // Bob: high -> low
      expect(res.matrix.high.low).toBe(1);
    });
  });

  describe('At-Risk Identification & CSV Export', () => {
    it('flags students with zero submissions, low consumption, and recording-only learner', () => {
      const candidates: AtRiskCandidate[] = [
        {
          studentId: 's1',
          externalStudentId: '101',
          name: 'Charlie',
          phoneE164: '+919999999993',
          assignmentSubmissionPct: 0,
          assignmentsSubmitted: 0,
          totalConsumptionPct: 35,
          livePct: 20,
          liveOrRecPct: 80, // recording-only learner: live < 30 and live+rec > 70
          segment: 'low',
        },
        {
          studentId: 's2',
          externalStudentId: '102',
          name: 'Diana',
          phoneE164: '+919999999994',
          assignmentSubmissionPct: 100,
          assignmentsSubmitted: 4,
          totalConsumptionPct: 90,
          livePct: 95,
          liveOrRecPct: 95,
          segment: 'high',
        },
      ];

      const atRisk = identifyAtRiskStudents(candidates);
      expect(atRisk).toHaveLength(1);
      expect(atRisk[0].name).toBe('Charlie');
      expect(atRisk[0].reasons).toContain('0 assignments submitted');
      expect(atRisk[0].reasons).toContain('Low consumption (35%)');
      expect(atRisk[0].reasons).toContain('Low attendance (20%)');
      expect(atRisk[0].reasons).toContain('Recording-only learner');

      // CSV export
      const csv = exportAtRiskToCsv(atRisk);
      expect(csv).toContain('Student ID,Student Name');
      expect(csv).toContain('Charlie');
      expect(csv).toContain('Recording-only learner');
    });
  });
});
