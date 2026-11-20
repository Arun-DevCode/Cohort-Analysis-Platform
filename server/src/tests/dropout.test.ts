import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import {
  users,
  batches,
  snapshots,
  assignmentSchedule,
  assignmentItems,
  assignmentResults,
  students,
  batchStudents,
  batchTrainers,
  batchDropoutSettings,
} from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';
import {
  computeDropoutAnalytics,
  DEFAULT_DROPOUT_SETTINGS,
  TREND_STABLE_BAND_PCT,
  DropoutAssignmentScheduleItem,
  DropoutSnapshotRecord,
} from '../services/analytics/dropoutEngine.js';
import { updateDropoutSettingsSchema } from '../validators/dropout.validator.js';

describe('Stage 3: Drop-out Risk Analytics Engine Tests', () => {
  const schedule4Due: DropoutAssignmentScheduleItem[] = [
    { lmsAssignmentName: 'Assignment 1', type: 'regular', dueDate: '2026-09-04' },
    { lmsAssignmentName: 'Module End 1', type: 'module_end', dueDate: '2026-09-21' },
    { lmsAssignmentName: 'Assignment 2', type: 'regular', dueDate: '2026-09-28' },
    { lmsAssignmentName: 'Assignment 3', type: 'regular', dueDate: '2026-10-14' },
    { lmsAssignmentName: 'Assignment 4', type: 'regular', dueDate: '2026-11-06' },
    { lmsAssignmentName: 'Assignment 5 (Future)', type: 'regular', dueDate: '2026-11-20' }, // Not due on 2026-11-09
  ];

  it('Streak and longest streak: calculates consecutive missed from latest due assignment', () => {
    const snap: DropoutSnapshotRecord = {
      id: 'snap-1',
      snapshotDate: '2026-11-09',
      assignments: [
        // Learner A: submitted A1, A2; missed A3, A4 -> current streak = 2, longest = 2
        { studentId: 's1', studentName: 'Learner A', phoneE164: '+919000000001', assignmentName: 'Assignment 1', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner A', phoneE164: '+919000000001', assignmentName: 'Assignment 2', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner A', phoneE164: '+919000000001', assignmentName: 'Assignment 3', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's1', studentName: 'Learner A', phoneE164: '+919000000001', assignmentName: 'Assignment 4', status: 'SUBMISSION_PENDING', score: null },

        // Learner B: submitted A1, missed A2, submitted A3, missed A4 -> current streak = 1, longest = 1
        { studentId: 's2', studentName: 'Learner B', phoneE164: '+919000000002', assignmentName: 'Assignment 1', status: 'PASSED', score: 10 },
        { studentId: 's2', studentName: 'Learner B', phoneE164: '+919000000002', assignmentName: 'Assignment 2', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's2', studentName: 'Learner B', phoneE164: '+919000000002', assignmentName: 'Assignment 3', status: 'PASSED', score: 10 },
        { studentId: 's2', studentName: 'Learner B', phoneE164: '+919000000002', assignmentName: 'Assignment 4', status: 'SUBMISSION_PENDING', score: null },

        // Learner C: missed A1, A2, submitted A3, A4 -> current streak = 0, longest = 2
        { studentId: 's3', studentName: 'Learner C', phoneE164: '+919000000003', assignmentName: 'Assignment 1', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's3', studentName: 'Learner C', phoneE164: '+919000000003', assignmentName: 'Assignment 2', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's3', studentName: 'Learner C', phoneE164: '+919000000003', assignmentName: 'Assignment 3', status: 'PASSED', score: 10 },
        { studentId: 's3', studentName: 'Learner C', phoneE164: '+919000000003', assignmentName: 'Assignment 4', status: 'PASSED', score: 10 },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-1',
      selectedSnapshotId: 'snap-1',
      allBatchSnapshots: [snap],
      schedule: schedule4Due,
    });

    const lA = res.learners.find((l) => l.studentId === 's1')!;
    const lB = res.learners.find((l) => l.studentId === 's2')!;
    const lC = res.learners.find((l) => l.studentId === 's3')!;

    expect(lA.currentStreak).toBe(2);
    expect(lA.longestStreak).toBe(2);
    expect(lA.tier).toBe('at_risk');

    expect(lB.currentStreak).toBe(1);
    expect(lB.longestStreak).toBe(1);
    expect(lB.tier).toBe('slipping');

    expect(lC.currentStreak).toBe(0);
    expect(lC.longestStreak).toBe(2);
    expect(lC.tier).toBe('active');
  });

  it('Tier boundaries: range checks top-down (>= dropout_at, >= at_risk_at, >= slipping_at) without gaps', () => {
    // Custom non-consecutive thresholds: slipping_at = 1, at_risk_at = 3, dropout_at = 5
    const customSettings = { slippingAt: 1, atRiskAt: 3, dropoutAt: 5, minDue: 3 };

    const schedule6: DropoutAssignmentScheduleItem[] = [
      { lmsAssignmentName: 'A1', type: 'regular', dueDate: '2026-09-01' },
      { lmsAssignmentName: 'A2', type: 'regular', dueDate: '2026-09-08' },
      { lmsAssignmentName: 'A3', type: 'regular', dueDate: '2026-09-15' },
      { lmsAssignmentName: 'A4', type: 'regular', dueDate: '2026-09-22' },
      { lmsAssignmentName: 'A5', type: 'regular', dueDate: '2026-09-29' },
      { lmsAssignmentName: 'A6', type: 'regular', dueDate: '2026-10-06' },
    ];

    const snap: DropoutSnapshotRecord = {
      id: 'snap-custom',
      snapshotDate: '2026-10-10',
      assignments: [
        // Streak 4 (between 3 and 5): should fall into at_risk with top-down range check
        { studentId: 's4', studentName: 'Learner 4-Missed', phoneE164: '+919000000004', assignmentName: 'A1', status: 'PASSED', score: 10 },
        { studentId: 's4', studentName: 'Learner 4-Missed', phoneE164: '+919000000004', assignmentName: 'A2', status: 'PASSED', score: 10 },
        { studentId: 's4', studentName: 'Learner 4-Missed', phoneE164: '+919000000004', assignmentName: 'A3', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's4', studentName: 'Learner 4-Missed', phoneE164: '+919000000004', assignmentName: 'A4', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's4', studentName: 'Learner 4-Missed', phoneE164: '+919000000004', assignmentName: 'A5', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's4', studentName: 'Learner 4-Missed', phoneE164: '+919000000004', assignmentName: 'A6', status: 'SUBMISSION_PENDING', score: null },

        // Streak 2 (between 1 and 3): should fall into slipping
        { studentId: 's2', studentName: 'Learner 2-Missed', phoneE164: '+919000000002', assignmentName: 'A1', status: 'PASSED', score: 10 },
        { studentId: 's2', studentName: 'Learner 2-Missed', phoneE164: '+919000000002', assignmentName: 'A2', status: 'PASSED', score: 10 },
        { studentId: 's2', studentName: 'Learner 2-Missed', phoneE164: '+919000000002', assignmentName: 'A3', status: 'PASSED', score: 10 },
        { studentId: 's2', studentName: 'Learner 2-Missed', phoneE164: '+919000000002', assignmentName: 'A4', status: 'PASSED', score: 10 },
        { studentId: 's2', studentName: 'Learner 2-Missed', phoneE164: '+919000000002', assignmentName: 'A5', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's2', studentName: 'Learner 2-Missed', phoneE164: '+919000000002', assignmentName: 'A6', status: 'SUBMISSION_PENDING', score: null },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-custom',
      selectedSnapshotId: 'snap-custom',
      allBatchSnapshots: [snap],
      schedule: schedule6,
      settings: customSettings,
    });

    const l4 = res.learners.find((l) => l.studentId === 's4')!;
    const l2 = res.learners.find((l) => l.studentId === 's2')!;

    expect(l4.currentStreak).toBe(4);
    expect(l4.tier).toBe('at_risk'); // 4 >= 3 (at_risk_at) and < 5 (dropout_at)

    expect(l2.currentStreak).toBe(2);
    expect(l2.tier).toBe('slipping'); // 2 >= 1 (slipping_at) and < 3 (at_risk_at)
  });

  it('Not-yet-due assignments and assignments without due dates are excluded from regular due count', () => {
    const snap: DropoutSnapshotRecord = {
      id: 'snap-due',
      snapshotDate: '2026-11-09',
      assignments: [
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 1', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 2', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 3', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 4', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 5 (Future)', status: 'SUBMISSION_PENDING', score: null },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-1',
      selectedSnapshotId: 'snap-due',
      allBatchSnapshots: [snap],
      schedule: schedule4Due,
    });

    const l1 = res.learners.find((l) => l.studentId === 's1')!;
    // Assignment 5 is due 2026-11-20 (> 2026-11-09), so regular dueCount must be exactly 4
    expect(l1.dueCount).toBe(4);
    expect(l1.submittedCount).toBe(4);
    expect(l1.submissionRate).toBe(100);
    expect(l1.currentStreak).toBe(0);
    expect(l1.tier).toBe('active');
  });

  it('Module-end assignments are tracked separately and never affect the risk tier', () => {
    const snap: DropoutSnapshotRecord = {
      id: 'snap-mod',
      snapshotDate: '2026-11-09',
      assignments: [
        // Submitted all 4 regular assignments, missed module-end
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 1', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 2', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 3', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 4', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Module End 1', status: 'SUBMISSION_PENDING', score: null },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-1',
      selectedSnapshotId: 'snap-mod',
      allBatchSnapshots: [snap],
      schedule: schedule4Due,
    });

    const l1 = res.learners.find((l) => l.studentId === 's1')!;
    expect(l1.moduleEndDue).toBe(1);
    expect(l1.moduleEndSubmitted).toBe(0);
    expect(l1.missedModuleEnd).toBe(true);
    // Even though module-end was missed, regular currentStreak = 0 -> tier remains Active!
    expect(l1.currentStreak).toBe(0);
    expect(l1.tier).toBe('active');
  });

  it('Too early guardrail: when fewer than min_due regular assignments are due, all learners are Too early', () => {
    const earlySchedule: DropoutAssignmentScheduleItem[] = [
      { lmsAssignmentName: 'Assignment 1', type: 'regular', dueDate: '2026-09-04' },
      { lmsAssignmentName: 'Assignment 2', type: 'regular', dueDate: '2026-09-11' },
      // Only 2 regular assignments due (< min_due: 3)
    ];

    const snap: DropoutSnapshotRecord = {
      id: 'snap-early',
      snapshotDate: '2026-09-12',
      assignments: [
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 1', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 2', status: 'SUBMISSION_PENDING', score: null },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-1',
      selectedSnapshotId: 'snap-early',
      allBatchSnapshots: [snap],
      schedule: earlySchedule,
    });

    expect(res.isTooEarly).toBe(true);
    expect(res.tierCounts.tooEarly).toBe(1);
    expect(res.tierCounts.active).toBe(0);
    expect(res.tierCounts.likelyDroppedOut).toBe(0);

    const l1 = res.learners[0];
    expect(l1.tier).toBe('too_early');
    expect(l1.tierLabel).toBe('Too early');
  });

  it('never_started flag is set for 0 submissions with >= 1 due, and classifies as Likely dropped out if due >= max(dropoutAt, minDue)', () => {
    const snap: DropoutSnapshotRecord = {
      id: 'snap-never',
      snapshotDate: '2026-11-09',
      assignments: [
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 1', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 2', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 3', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 4', status: 'SUBMISSION_PENDING', score: null },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-1',
      selectedSnapshotId: 'snap-never',
      allBatchSnapshots: [snap],
      schedule: schedule4Due,
    });

    const l1 = res.learners[0];
    expect(l1.neverStarted).toBe(true);
    expect(l1.submittedCount).toBe(0);
    expect(l1.dueCount).toBe(4);
    expect(l1.tier).toBe('likely_dropped_out');
    expect(l1.tierLabel).toBe('Likely dropped out');
  });

  it('Trend requires at least 4 regular assignments due; uses TREND_STABLE_BAND_PCT (5%)', () => {
    expect(TREND_STABLE_BAND_PCT).toBe(5.0);

    // 4 due assignments: earlier has A1 (1 assignment), last3 has A2, A3, A4 (3 assignments)
    const snap: DropoutSnapshotRecord = {
      id: 'snap-trend',
      snapshotDate: '2026-11-09',
      assignments: [
        // Learner 1: missed A1 (0%), submitted A2, A3, A4 (100%) -> diff = +100% -> improving
        { studentId: 's1', studentName: 'Learner Imp', phoneE164: '+919000000001', assignmentName: 'Assignment 1', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's1', studentName: 'Learner Imp', phoneE164: '+919000000001', assignmentName: 'Assignment 2', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner Imp', phoneE164: '+919000000001', assignmentName: 'Assignment 3', status: 'PASSED', score: 10 },
        { studentId: 's1', studentName: 'Learner Imp', phoneE164: '+919000000001', assignmentName: 'Assignment 4', status: 'PASSED', score: 10 },

        // Learner 2: submitted A1 (100%), missed A2, A3, A4 (0%) -> diff = -100% -> declining
        { studentId: 's2', studentName: 'Learner Dec', phoneE164: '+919000000002', assignmentName: 'Assignment 1', status: 'PASSED', score: 10 },
        { studentId: 's2', studentName: 'Learner Dec', phoneE164: '+919000000002', assignmentName: 'Assignment 2', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's2', studentName: 'Learner Dec', phoneE164: '+919000000002', assignmentName: 'Assignment 3', status: 'SUBMISSION_PENDING', score: null },
        { studentId: 's2', studentName: 'Learner Dec', phoneE164: '+919000000002', assignmentName: 'Assignment 4', status: 'SUBMISSION_PENDING', score: null },

        // Learner 3: submitted A1 (100%), submitted A2, A3, A4 (100%) -> diff = 0% -> stable
        { studentId: 's3', studentName: 'Learner Stb', phoneE164: '+919000000003', assignmentName: 'Assignment 1', status: 'PASSED', score: 10 },
        { studentId: 's3', studentName: 'Learner Stb', phoneE164: '+919000000003', assignmentName: 'Assignment 2', status: 'PASSED', score: 10 },
        { studentId: 's3', studentName: 'Learner Stb', phoneE164: '+919000000003', assignmentName: 'Assignment 3', status: 'PASSED', score: 10 },
        { studentId: 's3', studentName: 'Learner Stb', phoneE164: '+919000000003', assignmentName: 'Assignment 4', status: 'PASSED', score: 10 },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-1',
      selectedSnapshotId: 'snap-trend',
      allBatchSnapshots: [snap],
      schedule: schedule4Due,
    });

    const l1 = res.learners.find((l) => l.studentId === 's1')!;
    const l2 = res.learners.find((l) => l.studentId === 's2')!;
    const l3 = res.learners.find((l) => l.studentId === 's3')!;

    expect(l1.trend.direction).toBe('improving');
    expect(l1.trend.diffPct).toBe(100);

    expect(l2.trend.direction).toBe('declining');
    expect(l2.trend.diffPct).toBe(-100);

    expect(l3.trend.direction).toBe('stable');
    expect(l3.trend.diffPct).toBe(0);
  });

  it('No due dates banner: when schedule has no due dates, hasDueDates is false and all learners are too_early', () => {
    const noDueSchedule: DropoutAssignmentScheduleItem[] = [
      { lmsAssignmentName: 'Assignment 1', type: 'regular', dueDate: null },
      { lmsAssignmentName: 'Assignment 2', type: 'regular', dueDate: null },
    ];

    const snap: DropoutSnapshotRecord = {
      id: 'snap-nodue',
      snapshotDate: '2026-11-09',
      assignments: [
        { studentId: 's1', studentName: 'Learner 1', phoneE164: '+919000000001', assignmentName: 'Assignment 1', status: 'PASSED', score: 10 },
      ],
    };

    const res = computeDropoutAnalytics({
      batchId: 'b-nodue',
      selectedSnapshotId: 'snap-nodue',
      allBatchSnapshots: [snap],
      schedule: noDueSchedule,
    });

    expect(res.hasDueDates).toBe(false);
    expect(res.funnel).toHaveLength(0);
    expect(res.learners[0].tier).toBe('too_early');
  });

  it('Threshold validation: validates strictly ascending integers (slipping < at_risk < dropout) and min_due >= 1', () => {
    // Valid configuration
    const valid = updateDropoutSettingsSchema.safeParse({
      slippingAt: 1,
      atRiskAt: 2,
      dropoutAt: 3,
      minDue: 3,
    });
    expect(valid.success).toBe(true);

    // Invalid: slippingAt >= atRiskAt
    const invalid1 = updateDropoutSettingsSchema.safeParse({
      slippingAt: 2,
      atRiskAt: 2,
      dropoutAt: 3,
      minDue: 3,
    });
    expect(invalid1.success).toBe(false);

    // Invalid: atRiskAt >= dropoutAt
    const invalid2 = updateDropoutSettingsSchema.safeParse({
      slippingAt: 1,
      atRiskAt: 4,
      dropoutAt: 3,
      minDue: 3,
    });
    expect(invalid2.success).toBe(false);

    // Invalid: minDue < 1
    const invalid3 = updateDropoutSettingsSchema.safeParse({
      slippingAt: 1,
      atRiskAt: 2,
      dropoutAt: 3,
      minDue: 0,
    });
    expect(invalid3.success).toBe(false);
  });

  describe('Golden Test: Anonymized AFSD Cohort Evaluation', () => {
    const afsdSchedule: DropoutAssignmentScheduleItem[] = [
      { lmsAssignmentName: 'Build a Restaurant Menu Page', type: 'regular', dueDate: '2026-09-04' },
      { lmsAssignmentName: 'M1 - ShopNest Static Website - HTML and CSS Module End', type: 'module_end', dueDate: '2026-09-21' },
      { lmsAssignmentName: '2 - Price and Discount Calculator - JavaScript  Fundamentals', type: 'regular', dueDate: '2026-09-28' },
      { lmsAssignmentName: '3 - Build an Interactive JavaScript Quiz App', type: 'regular', dueDate: '2026-10-14' },
      { lmsAssignmentName: 'M2 - ShopNest Interactive App - JavaScript Module End', type: 'module_end', dueDate: '2026-11-02' },
      { lmsAssignmentName: '4 - Build a Movie Watchlist App with React', type: 'regular', dueDate: '2026-11-06' },
    ];

    it('accurately verifies five distinct hand-counted learners across all tier levels and flags', () => {
      const snap: DropoutSnapshotRecord = {
        id: 'afsd-2026-11-09',
        snapshotDate: '2026-11-09',
        assignments: [
          // Learner 1 (Consistent Submitter): submitted all 4 regular + 2 module ends
          { studentId: 'stu-1', studentName: 'Learner One (Top)', phoneE164: '+919876543201', assignmentName: 'Build a Restaurant Menu Page', status: 'PASSED', score: 10 },
          { studentId: 'stu-1', studentName: 'Learner One (Top)', phoneE164: '+919876543201', assignmentName: 'M1 - ShopNest Static Website - HTML and CSS Module End', status: 'PASSED', score: 25 },
          { studentId: 'stu-1', studentName: 'Learner One (Top)', phoneE164: '+919876543201', assignmentName: '2 - Price and Discount Calculator - JavaScript  Fundamentals', status: 'PASSED', score: 10 },
          { studentId: 'stu-1', studentName: 'Learner One (Top)', phoneE164: '+919876543201', assignmentName: '3 - Build an Interactive JavaScript Quiz App', status: 'PASSED', score: 10 },
          { studentId: 'stu-1', studentName: 'Learner One (Top)', phoneE164: '+919876543201', assignmentName: 'M2 - ShopNest Interactive App - JavaScript Module End', status: 'PASSED', score: 24.5 },
          { studentId: 'stu-1', studentName: 'Learner One (Top)', phoneE164: '+919876543201', assignmentName: '4 - Build a Movie Watchlist App with React', status: 'PASSED', score: 9 },

          // Learner 2 (Slipping): submitted A1, A2, A3, but missed most recent A4
          { studentId: 'stu-2', studentName: 'Learner Two (Slip)', phoneE164: '+919876543202', assignmentName: 'Build a Restaurant Menu Page', status: 'PASSED', score: 10 },
          { studentId: 'stu-2', studentName: 'Learner Two (Slip)', phoneE164: '+919876543202', assignmentName: 'M1 - ShopNest Static Website - HTML and CSS Module End', status: 'PASSED', score: 25 },
          { studentId: 'stu-2', studentName: 'Learner Two (Slip)', phoneE164: '+919876543202', assignmentName: '2 - Price and Discount Calculator - JavaScript  Fundamentals', status: 'PASSED', score: 10 },
          { studentId: 'stu-2', studentName: 'Learner Two (Slip)', phoneE164: '+919876543202', assignmentName: '3 - Build an Interactive JavaScript Quiz App', status: 'PASSED', score: 9.5 },
          { studentId: 'stu-2', studentName: 'Learner Two (Slip)', phoneE164: '+919876543202', assignmentName: 'M2 - ShopNest Interactive App - JavaScript Module End', status: 'PASSED', score: 24 },
          { studentId: 'stu-2', studentName: 'Learner Two (Slip)', phoneE164: '+919876543202', assignmentName: '4 - Build a Movie Watchlist App with React', status: 'SUBMISSION_PENDING', score: null },

          // Learner 3 (At Risk): submitted A1, A2, but missed A3 and A4 (consecutive streak 2)
          { studentId: 'stu-3', studentName: 'Learner Three (Risk)', phoneE164: '+919876543203', assignmentName: 'Build a Restaurant Menu Page', status: 'PASSED', score: 10 },
          { studentId: 'stu-3', studentName: 'Learner Three (Risk)', phoneE164: '+919876543203', assignmentName: 'M1 - ShopNest Static Website - HTML and CSS Module End', status: 'PASSED', score: 25 },
          { studentId: 'stu-3', studentName: 'Learner Three (Risk)', phoneE164: '+919876543203', assignmentName: '2 - Price and Discount Calculator - JavaScript  Fundamentals', status: 'PASSED', score: 10 },
          { studentId: 'stu-3', studentName: 'Learner Three (Risk)', phoneE164: '+919876543203', assignmentName: '3 - Build an Interactive JavaScript Quiz App', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-3', studentName: 'Learner Three (Risk)', phoneE164: '+919876543203', assignmentName: 'M2 - ShopNest Interactive App - JavaScript Module End', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-3', studentName: 'Learner Three (Risk)', phoneE164: '+919876543203', assignmentName: '4 - Build a Movie Watchlist App with React', status: 'SUBMISSION_PENDING', score: null },

          // Learner 4 (Likely Dropped Out): submitted only A1, missed A2, A3, A4 (consecutive streak 3)
          { studentId: 'stu-4', studentName: 'Learner Four (Drop)', phoneE164: '+919876543204', assignmentName: 'Build a Restaurant Menu Page', status: 'PASSED', score: 9 },
          { studentId: 'stu-4', studentName: 'Learner Four (Drop)', phoneE164: '+919876543204', assignmentName: 'M1 - ShopNest Static Website - HTML and CSS Module End', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-4', studentName: 'Learner Four (Drop)', phoneE164: '+919876543204', assignmentName: '2 - Price and Discount Calculator - JavaScript  Fundamentals', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-4', studentName: 'Learner Four (Drop)', phoneE164: '+919876543204', assignmentName: '3 - Build an Interactive JavaScript Quiz App', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-4', studentName: 'Learner Four (Drop)', phoneE164: '+919876543204', assignmentName: 'M2 - ShopNest Interactive App - JavaScript Module End', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-4', studentName: 'Learner Four (Drop)', phoneE164: '+919876543204', assignmentName: '4 - Build a Movie Watchlist App with React', status: 'SUBMISSION_PENDING', score: null },

          // Learner 5 (Never Started): 0 submissions across all 4 due assignments
          { studentId: 'stu-5', studentName: 'Learner Five (Never)', phoneE164: '+919876543205', assignmentName: 'Build a Restaurant Menu Page', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-5', studentName: 'Learner Five (Never)', phoneE164: '+919876543205', assignmentName: 'M1 - ShopNest Static Website - HTML and CSS Module End', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-5', studentName: 'Learner Five (Never)', phoneE164: '+919876543205', assignmentName: '2 - Price and Discount Calculator - JavaScript  Fundamentals', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-5', studentName: 'Learner Five (Never)', phoneE164: '+919876543205', assignmentName: '3 - Build an Interactive JavaScript Quiz App', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-5', studentName: 'Learner Five (Never)', phoneE164: '+919876543205', assignmentName: 'M2 - ShopNest Interactive App - JavaScript Module End', status: 'SUBMISSION_PENDING', score: null },
          { studentId: 'stu-5', studentName: 'Learner Five (Never)', phoneE164: '+919876543205', assignmentName: '4 - Build a Movie Watchlist App with React', status: 'SUBMISSION_PENDING', score: null },
        ],
      };

      const res = computeDropoutAnalytics({
        batchId: 'afsd-cohort',
        selectedSnapshotId: 'afsd-2026-11-09',
        allBatchSnapshots: [snap],
        schedule: afsdSchedule,
      });

      expect(res.hasDueDates).toBe(true);
      expect(res.isTooEarly).toBe(false);
      expect(res.funnel).toHaveLength(6);

      // Verify hand-counts for each of the 5 learners:
      const l1 = res.learners.find((l) => l.studentId === 'stu-1')!;
      expect(l1.dueCount).toBe(4);
      expect(l1.submittedCount).toBe(4);
      expect(l1.submissionRate).toBe(100);
      expect(l1.currentStreak).toBe(0);
      expect(l1.tier).toBe('active');
      expect(l1.neverStarted).toBe(false);
      expect(l1.missedModuleEnd).toBe(false);

      const l2 = res.learners.find((l) => l.studentId === 'stu-2')!;
      expect(l2.dueCount).toBe(4);
      expect(l2.submittedCount).toBe(3);
      expect(l2.submissionRate).toBe(75);
      expect(l2.currentStreak).toBe(1);
      expect(l2.tier).toBe('slipping');
      expect(l2.neverStarted).toBe(false);
      expect(l2.lastSubmittedAssignment?.name).toBe('3 - Build an Interactive JavaScript Quiz App');

      const l3 = res.learners.find((l) => l.studentId === 'stu-3')!;
      expect(l3.dueCount).toBe(4);
      expect(l3.submittedCount).toBe(2);
      expect(l3.submissionRate).toBe(50);
      expect(l3.currentStreak).toBe(2);
      expect(l3.tier).toBe('at_risk');
      expect(l3.neverStarted).toBe(false);
      expect(l3.missedModuleEnd).toBe(true);

      const l4 = res.learners.find((l) => l.studentId === 'stu-4')!;
      expect(l4.dueCount).toBe(4);
      expect(l4.submittedCount).toBe(1);
      expect(l4.submissionRate).toBe(25);
      expect(l4.currentStreak).toBe(3);
      expect(l4.tier).toBe('likely_dropped_out');
      expect(l4.neverStarted).toBe(false);
      expect(l4.lastSubmittedAssignment?.name).toBe('Build a Restaurant Menu Page');

      const l5 = res.learners.find((l) => l.studentId === 'stu-5')!;
      expect(l5.dueCount).toBe(4);
      expect(l5.submittedCount).toBe(0);
      expect(l5.submissionRate).toBe(0);
      expect(l5.currentStreak).toBe(4);
      expect(l5.tier).toBe('likely_dropped_out');
      expect(l5.neverStarted).toBe(true);
      expect(l5.lastSubmittedAssignment).toBeNull();

      // Funnel verification:
      // Regular assignments are solid, module-end outlined
      const fMenu = res.funnel.find((f) => f.assignmentName.includes('Restaurant Menu'))!;
      expect(fMenu.type).toBe('regular');
      expect(fMenu.submittedCount).toBe(4); // 4 out of 5 submitted

      const fMod1 = res.funnel.find((f) => f.assignmentName.includes('ShopNest Static Website'))!;
      expect(fMod1.type).toBe('module_end');
      expect(fMod1.submittedCount).toBe(3); // stu-1, stu-2, stu-3 submitted

      const fReact = res.funnel.find((f) => f.assignmentName.includes('Movie Watchlist'))!;
      expect(fReact.type).toBe('regular');
      expect(fReact.submittedCount).toBe(1); // only stu-1 submitted
    });
  });

  describe('Stage 3: Drop-out API Integration & Isolation Tests', () => {
    let adminToken: string;
    let trainerAToken: string;
    let trainerBToken: string;
    let batchAId: string;
    let batchBId: string;
    let snapshotAId: string;
    let snapshotBId: string;

    beforeAll(async () => {
      const db = await createTestDatabase();
      const passwordHash = await AuthService.hashPassword('Pass1234!');

      // Create Admin
      const [admin] = await db
        .insert(users)
        .values({ email: 'admin@dropout.test', passwordHash, role: 'admin' })
        .returning();
      adminToken = AuthService.generateTokens({
        userId: admin.id,
        email: admin.email,
        role: 'admin',
      }).accessToken;

      // Create Trainer A
      const [trainerA] = await db
        .insert(users)
        .values({ email: 'trainerA@dropout.test', passwordHash, role: 'trainer' })
        .returning();
      trainerAToken = AuthService.generateTokens({
        userId: trainerA.id,
        email: trainerA.email,
        role: 'trainer',
      }).accessToken;

      // Create Trainer B
      const [trainerB] = await db
        .insert(users)
        .values({ email: 'trainerB@dropout.test', passwordHash, role: 'trainer' })
        .returning();
      trainerBToken = AuthService.generateTokens({
        userId: trainerB.id,
        email: trainerB.email,
        role: 'trainer',
      }).accessToken;

      // Create Batch A owned by Trainer A
      const [bA] = await db
        .insert(batches)
        .values({ name: 'Batch Alpha', externalBatchId: 'BATCH-ALPHA', createdBy: trainerA.id })
        .returning();
      batchAId = bA.id;
      await db.insert(batchTrainers).values({ batchId: batchAId, userId: trainerA.id });

      // Create Batch B owned by Trainer B
      const [bB] = await db
        .insert(batches)
        .values({ name: 'Batch Beta', externalBatchId: 'BATCH-BETA', createdBy: trainerB.id })
        .returning();
      batchBId = bB.id;
      await db.insert(batchTrainers).values({ batchId: batchBId, userId: trainerB.id });

      // Snapshots for Batch A and Batch B
      const [snapA] = await db
        .insert(snapshots)
        .values({ batchId: batchAId, snapshotDate: '2026-11-09', recordCount: 1 })
        .returning();
      snapshotAId = snapA.id;

      const [snapB] = await db
        .insert(snapshots)
        .values({ batchId: batchBId, snapshotDate: '2026-11-09', recordCount: 1 })
        .returning();
      snapshotBId = snapB.id;

      // Create assignment item & result in Batch A
      const [assignA] = await db
        .insert(assignmentItems)
        .values({ snapshotId: snapshotAId, name: 'Alpha Assignment 1' })
        .returning();

      const [stuA] = await db
        .insert(students)
        .values({
          createdBy: trainerA.id,
          externalStudentId: 'STU-ALPHA-1',
          name: 'Student Alpha',
          phoneE164: '+919999900010',
        })
        .returning();

      await db.insert(batchStudents).values({ batchId: batchAId, studentId: stuA.id });

      await db.insert(assignmentResults).values({
        assignmentItemId: assignA.id,
        studentId: stuA.id,
        status: 'PASSED',
        score: '10',
      });

      // Schedule for Batch A
      await db.insert(assignmentSchedule).values({
        batchId: batchAId,
        lmsAssignmentName: 'Alpha Assignment 1',
        type: 'regular',
        dueDate: '2026-11-01',
      });
    });

    it('Cross-user isolation: Trainer B cannot access Batch A dropout analytics (403/404)', async () => {
      const res = await request(app)
        .get(`/api/v1/batches/${batchAId}/dropout?snapshotId=${snapshotAId}`)
        .set('Authorization', `Bearer ${trainerBToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it('Cross-batch isolation & snapshot-batch mismatch: querying Batch A with Batch B snapshot returns 404', async () => {
      const res = await request(app)
        .get(`/api/v1/batches/${batchAId}/dropout?snapshotId=${snapshotBId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Snapshot does not belong to this batch/i);
    });

    it('Defaults when no row: uses default thresholds (1, 2, 3, 3) when batch has no settings row', async () => {
      const res = await request(app)
        .get(`/api/v1/batches/${batchAId}/dropout?snapshotId=${snapshotAId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        slippingAt: 1,
        atRiskAt: 2,
        dropoutAt: 3,
        minDue: 3,
      });
      expect(res.body.tierCounts).toBeDefined();
    });

    it('Settings validation: PUT /batches/:id/dropout/settings rejects non-ascending integers', async () => {
      // slippingAt >= atRiskAt
      const res1 = await request(app)
        .put(`/api/v1/batches/${batchAId}/dropout/settings`)
        .set('Authorization', `Bearer ${trainerAToken}`)
        .send({ slippingAt: 2, atRiskAt: 2, dropoutAt: 3, minDue: 3 });

      expect(res1.status).toBe(400);

      // atRiskAt >= dropoutAt
      const res2 = await request(app)
        .put(`/api/v1/batches/${batchAId}/dropout/settings`)
        .set('Authorization', `Bearer ${trainerAToken}`)
        .send({ slippingAt: 1, atRiskAt: 4, dropoutAt: 3, minDue: 3 });

      expect(res2.status).toBe(400);

      // minDue < 1
      const res3 = await request(app)
        .put(`/api/v1/batches/${batchAId}/dropout/settings`)
        .set('Authorization', `Bearer ${trainerAToken}`)
        .send({ slippingAt: 1, atRiskAt: 2, dropoutAt: 3, minDue: 0 });

      expect(res3.status).toBe(400);
    });

    it('Owner-only permission: Non-owner Trainer cannot update batch dropout settings (403)', async () => {
      const res = await request(app)
        .put(`/api/v1/batches/${batchAId}/dropout/settings`)
        .set('Authorization', `Bearer ${trainerBToken}`)
        .send({ slippingAt: 2, atRiskAt: 3, dropoutAt: 4, minDue: 3 });

      expect([403, 404]).toContain(res.status);
    });

    it('PUT upserts settings and GET immediately uses the updated thresholds', async () => {
      const putRes = await request(app)
        .put(`/api/v1/batches/${batchAId}/dropout/settings`)
        .set('Authorization', `Bearer ${trainerAToken}`)
        .send({ slippingAt: 2, atRiskAt: 4, dropoutAt: 6, minDue: 4 });

      expect(putRes.status).toBe(200);
      expect(putRes.body.settings).toEqual({
        slippingAt: 2,
        atRiskAt: 4,
        dropoutAt: 6,
        minDue: 4,
      });

      const getRes = await request(app)
        .get(`/api/v1/batches/${batchAId}/dropout?snapshotId=${snapshotAId}`)
        .set('Authorization', `Bearer ${trainerAToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.settings).toEqual({
        slippingAt: 2,
        atRiskAt: 4,
        dropoutAt: 6,
        minDue: 4,
      });
    });
  });
});
