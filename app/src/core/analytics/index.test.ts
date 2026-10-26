import { describe, it, expect } from 'vitest';
import {
  computeAverage,
  computeDelta,
  getTrendDirection,
  classifyMovement,
  identifyAtRiskStudents,
  compareSnapshots,
  computeSnapshotAggregate,
  computeBatchScorecards,
} from './index';
import type { StudentSnapshot, Student } from '@/types';

describe('analytics pure functions', () => {
  it('computes average and delta accurately', () => {
    expect(computeAverage([60, 70, 80])).toBe(70);
    expect(computeAverage([])).toBe(0);
    expect(computeDelta(65.5, 60.0)).toBe(5.5);
    expect(computeDelta(50.0, 52.3)).toBe(-2.3);
    expect(computeDelta(50.0, null)).toBeNull();
  });

  it('computes snapshot aggregate and batch scorecards correctly', () => {
    const snaps: StudentSnapshot[] = [
      {
        id: 's1',
        snapshotId: 'snap1',
        studentId: 'std1',
        segment: 'High',
        metrics: {
          totalConsumptionPct: 90,
          videoPct: 90,
          pdfPct: 90,
          quizSubmissionPct: 90,
          flashCardsPct: 0,
          aiContentPct: 0,
          assignmentSubmissionPct: 80,
          assignmentAggregateScorePct: 80,
          liveClassPct: 90,
          liveOrRecordingPct: 90,
          pdfTotal: 1,
          pdfConsumed: 1,
          videoTotal: 10,
          videoConsumed: 9,
          quizTotal: 10,
          quizAttended: 9,
          flashCardsTotal: 0,
          flashCardsConsumed: 0,
          aiContentTotal: 0,
          aiContentAttempted: 0,
          assignmentsTotal: 4,
          assignmentsSubmitted: 4,
          liveClassAttended: 9,
          liveClassTotal: 10,
          liveOrRecordingConsumed: 9,
        },
      },
    ];

    const agg1 = computeSnapshotAggregate('snap1', '2026-10-21', snaps);
    expect(agg1.assignmentAvg).toBe(80);
    expect(agg1.consumptionAvg).toBe(90);
    expect(agg1.highCount).toBe(1);

    const scorecards = computeBatchScorecards(agg1, null);
    expect(scorecards.assignment.currentValue).toBe(80);
    expect(scorecards.assignment.deltaPts).toBeNull();
  });

  it('determines trend direction', () => {
    expect(getTrendDirection(2.5)).toBe('up');
    expect(getTrendDirection(-1.8)).toBe('down');
    expect(getTrendDirection(0.02)).toBe('flat');
    expect(getTrendDirection(null)).toBeNull();
  });

  it('classifies student movement with configurable tolerance', () => {
    expect(classifyMovement(3.5, 2)).toBe('IMPROVED');
    expect(classifyMovement(2.0, 2)).toBe('IMPROVED');
    expect(classifyMovement(1.5, 2)).toBe('SAME');
    expect(classifyMovement(-1.9, 2)).toBe('SAME');
    expect(classifyMovement(-2.0, 2)).toBe('DECLINED');
    expect(classifyMovement(-5.0, 2)).toBe('DECLINED');
  });

  it('identifies at-risk students according to domain rules', () => {
    const studentDirectory = new Map<string, Student>([
      ['std_1', { id: 'std_1', externalStudentId: '1', name: 'John Doe', phoneE164: '+919876543210' }],
      ['std_2', { id: 'std_2', externalStudentId: '2', name: 'Jane Smith', phoneE164: '+919876543211' }],
    ]);

    const snapshots: StudentSnapshot[] = [
      {
        id: 'snap1_std1',
        snapshotId: 'snap1',
        studentId: 'std_1',
        segment: 'Low',
        metrics: {
          totalConsumptionPct: 35,
          videoPct: 20,
          pdfPct: 50,
          quizSubmissionPct: 0,
          flashCardsPct: 0,
          aiContentPct: 0,
          assignmentSubmissionPct: 0,
          assignmentAggregateScorePct: 0,
          liveClassPct: 20,
          liveOrRecordingPct: 75, // recording-only
          pdfTotal: 2,
          pdfConsumed: 1,
          videoTotal: 10,
          videoConsumed: 2,
          quizTotal: 5,
          quizAttended: 0,
          flashCardsTotal: 0,
          flashCardsConsumed: 0,
          aiContentTotal: 1,
          aiContentAttempted: 0,
          assignmentsTotal: 4,
          assignmentsSubmitted: 0, // 0 assignments
          liveClassAttended: 2,
          liveClassTotal: 10,
          liveOrRecordingConsumed: 8,
        },
      },
      {
        id: 'snap1_std2',
        snapshotId: 'snap1',
        studentId: 'std_2',
        segment: 'High',
        metrics: {
          totalConsumptionPct: 85,
          videoPct: 80,
          pdfPct: 90,
          quizSubmissionPct: 80,
          flashCardsPct: 0,
          aiContentPct: 0,
          assignmentSubmissionPct: 20, // attends but does not submit (< 25%)
          assignmentAggregateScorePct: 80,
          liveClassPct: 80, // live >= 70%
          liveOrRecordingPct: 80,
          pdfTotal: 2,
          pdfConsumed: 2,
          videoTotal: 10,
          videoConsumed: 8,
          quizTotal: 5,
          quizAttended: 4,
          flashCardsTotal: 0,
          flashCardsConsumed: 0,
          aiContentTotal: 1,
          aiContentAttempted: 1,
          assignmentsTotal: 4,
          assignmentsSubmitted: 1,
          liveClassAttended: 8,
          liveClassTotal: 10,
          liveOrRecordingConsumed: 8,
        },
      },
    ];

    const atRisk = identifyAtRiskStudents(snapshots, studentDirectory);
    expect(atRisk).toHaveLength(2);

    const s1 = atRisk.find((s) => s.studentId === 'std_1');
    expect(s1?.reasons).toContain('0 assignments submitted');
    expect(s1?.reasons).toContain('Low consumption (35%)');
    expect(s1?.reasons).toContain('Low attendance (20%)');
    expect(s1?.reasons).toContain('Recording-only learner');

    const s2 = atRisk.find((s) => s.studentId === 'std_2');
    expect(s2?.reasons).toContain('Attends but does not submit');
  });

  it('computes comparison between two snapshots and generates transition matrix', () => {
    const studentDirectory = new Map<string, Student>([
      ['std_1', { id: 'std_1', externalStudentId: '1', name: 'John Doe', phoneE164: '+919876543210' }],
    ]);

    const snapshotA: StudentSnapshot[] = [
      {
        id: 'snapA_std1',
        snapshotId: 'snapA',
        studentId: 'std_1',
        segment: 'Medium',
        metrics: {
          totalConsumptionPct: 55,
          videoPct: 50,
          pdfPct: 50,
          quizSubmissionPct: 50,
          flashCardsPct: 0,
          aiContentPct: 0,
          assignmentSubmissionPct: 50,
          assignmentAggregateScorePct: 50,
          liveClassPct: 60,
          liveOrRecordingPct: 60,
          pdfTotal: 2,
          pdfConsumed: 1,
          videoTotal: 10,
          videoConsumed: 5,
          quizTotal: 5,
          quizAttended: 2,
          flashCardsTotal: 0,
          flashCardsConsumed: 0,
          aiContentTotal: 1,
          aiContentAttempted: 0,
          assignmentsTotal: 4,
          assignmentsSubmitted: 2,
          liveClassAttended: 6,
          liveClassTotal: 10,
          liveOrRecordingConsumed: 6,
        },
      },
    ];

    const snapshotB: StudentSnapshot[] = [
      {
        id: 'snapB_std1',
        snapshotId: 'snapB',
        studentId: 'std_1',
        segment: 'High',
        metrics: {
          totalConsumptionPct: 85,
          videoPct: 80,
          pdfPct: 90,
          quizSubmissionPct: 80,
          flashCardsPct: 0,
          aiContentPct: 0,
          assignmentSubmissionPct: 75,
          assignmentAggregateScorePct: 80,
          liveClassPct: 90,
          liveOrRecordingPct: 90,
          pdfTotal: 2,
          pdfConsumed: 2,
          videoTotal: 10,
          videoConsumed: 8,
          quizTotal: 5,
          quizAttended: 4,
          flashCardsTotal: 0,
          flashCardsConsumed: 0,
          aiContentTotal: 1,
          aiContentAttempted: 1,
          assignmentsTotal: 4,
          assignmentsSubmitted: 3,
          liveClassAttended: 9,
          liveClassTotal: 10,
          liveOrRecordingConsumed: 9,
        },
      },
    ];

    const result = compareSnapshots(snapshotA, snapshotB, studentDirectory);
    expect(result.comparisons).toHaveLength(1);
    expect(result.improved).toHaveLength(1);
    expect(result.matrix.Medium.High).toBe(1);
  });
});
