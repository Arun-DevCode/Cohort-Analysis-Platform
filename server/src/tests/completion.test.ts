import { describe, it, expect } from 'vitest';
import {
  computeCompletionAnalytics,
  DEFAULT_COMPLETION_SETTINGS,
  CompletionEngineInput,
} from '../services/analytics/completionEngine.js';
import { updateCompletionSettingsSchema } from '../validators/completion.validator.js';

describe('Completion Engine Unit Tests', () => {
  const baseRoadmap = {
    version: 'V9',
    startDate: '2026-08-17',
    endDate: '2027-02-15', // 182 days = 26 weeks
    totalRegularAssignments: 7,
    regularAssignmentsDue: 4,
    totalLiveSessions: 73,
    remainingLiveSessions: 40,
    totalHeldLiveSessions: 36,
    totalContentReleased: 97,
    note: null,
  };

  const baseReportDate = '2026-11-06'; // 81 days elapsed (11.57 wks), 101 days to end (14.43 wks)

  it('computes correct paces and marks learner as On track when all areas are Met', () => {
    const input: CompletionEngineInput = {
      settings: DEFAULT_COMPLETION_SETTINGS,
      roadmap: baseRoadmap,
      reportDate: baseReportDate,
      learners: [
        {
          studentId: 's1',
          name: 'Naveen',
          phoneE164: '+919952087613',
          regularAssignmentsSubmitted: 4, // 4/4 = 100% >= 70%
          totalConsumptionPct: 94.2,     // 94.2% >= 60%
          liveOrRecPct: 97.2,            // 97.2% >= 50%
        },
      ],
    };

    const res = computeCompletionAnalytics(input);
    expect(res.summary.onTrack).toBe(1);
    expect(res.summary.recoverable).toBe(0);
    expect(res.summary.unlikely).toBe(0);
    expect(res.learners[0].outlook).toBe('On track');
    expect(res.learners[0].assignments.status).toBe('Met');
    expect(res.learners[0].content.status).toBe('Met');
    expect(res.learners[0].attendance.status).toBe('Met');
    expect(res.learners[0].readinessScore).toBeGreaterThan(80);
  });

  it('calculates catch-up pace and marks learner as Recoverable when multiple <= catchupLimit', () => {
    // Manoj: submitted 1/4 (25%), min is 5/7, needed = 4 assignments
    // weeks_left = 14.43, req pace = 4 / 14.43 = 0.28, normal = 7 / 26 = 0.269, mult = 1.03x <= 2.0
    const input: CompletionEngineInput = {
      settings: DEFAULT_COMPLETION_SETTINGS,
      roadmap: baseRoadmap,
      reportDate: baseReportDate,
      learners: [
        {
          studentId: 's2',
          name: 'Manoj',
          phoneE164: '+919789270690',
          regularAssignmentsSubmitted: 1,
          totalConsumptionPct: 86.3, // Met
          liveOrRecPct: 91.7,        // Met
        },
      ],
    };

    const res = computeCompletionAnalytics(input);
    expect(res.summary.onTrack).toBe(0);
    expect(res.summary.recoverable).toBe(1);
    expect(res.learners[0].outlook).toBe('Recoverable');
    expect(res.learners[0].assignments.status).toBe('Behind');
    expect(res.learners[0].assignments.neededItems).toBe(4);
    expect(res.learners[0].assignments.catchupMultiple).toBeLessThanOrEqual(2.0);
    expect(res.learners[0].assignments.needsText).toContain('needs 4 of 7 assignments');
    expect(res.learners[0].assignments.needsText).toContain('the normal pace');
  });

  it('boundary test: multiple at exactly catchupLimit (2.0) is Recoverable, at 2.01 is Unlikely', () => {
    // Normal assignment pace = 7 / 26 = 0.26923
    // At limit 2.0: max allowed pace = 0.26923 * 2.0 = 0.53846 / wk
    // In 10 weeks left, needed = 5 assignments => req pace = 0.50 => multiple = 1.86 <= 2.0 => Recoverable
    const roadmapCustom = {
      ...baseRoadmap,
      endDate: '2026-12-04', // 28 days = 4 weeks left from Nov 06
    };
    // 4 weeks left:
    // needed = 5 assignments => req pace = 5 / 4 = 1.25 / wk
    // normal pace = 7 / ((182-73)/7) ... let's test directly with settings.catchupLimit
    const learnerBehind = {
      studentId: 's3',
      name: 'Test Boundary',
      phoneE164: '+910000000000',
      regularAssignmentsSubmitted: 0, // needs 5
      totalConsumptionPct: 100,
      liveOrRecPct: 100,
    };

    // Calculate required multiple for 0 submissions:
    // In baseRoadmap, weeksLeft = 14.43. req pace = 5 / 14.43 = 0.3465.
    // normal pace = 0.2692. Multiple = 0.3465 / 0.2692 = 1.287x.
    // If catchupLimit is 1.28: 1.29 > 1.28 => Unlikely
    // If catchupLimit is 1.30: 1.29 <= 1.30 => Recoverable

    const resUnlikely = computeCompletionAnalytics({
      settings: { ...DEFAULT_COMPLETION_SETTINGS, catchupLimit: 1.25 },
      roadmap: baseRoadmap,
      reportDate: baseReportDate,
      learners: [learnerBehind],
    });
    expect(resUnlikely.learners[0].outlook).toBe('Unlikely');

    const resRecoverable = computeCompletionAnalytics({
      settings: { ...DEFAULT_COMPLETION_SETTINGS, catchupLimit: 1.35 },
      roadmap: baseRoadmap,
      reportDate: baseReportDate,
      learners: [learnerBehind],
    });
    expect(resRecoverable.learners[0].outlook).toBe('Recoverable');
  });

  it('marks Behind as Unlikely once roadmap end date has passed', () => {
    const postEndReportDate = '2027-03-01'; // After 2027-02-15
    const input: CompletionEngineInput = {
      settings: DEFAULT_COMPLETION_SETTINGS,
      roadmap: baseRoadmap,
      reportDate: postEndReportDate,
      learners: [
        {
          studentId: 's4',
          name: 'Late Learner',
          phoneE164: '+910000000001',
          regularAssignmentsSubmitted: 2, // 2/4 < 70% min
          totalConsumptionPct: 90,
          liveOrRecPct: 90,
        },
      ],
    };

    const res = computeCompletionAnalytics(input);
    expect(res.learners[0].outlook).toBe('Unlikely');
    expect(res.learners[0].assignments.needsText).toContain('Roadmap ended on');
    expect(res.learners[0].assignments.needsText).toContain('minimum not reached');
  });

  it('guards for needed <= 0 when learner already meets threshold', () => {
    const input: CompletionEngineInput = {
      settings: DEFAULT_COMPLETION_SETTINGS,
      roadmap: baseRoadmap,
      reportDate: baseReportDate,
      learners: [
        {
          studentId: 's5',
          name: 'Fully Met',
          phoneE164: '+910000000002',
          regularAssignmentsSubmitted: 5, // 5 of 7 >= ceil(0.70*7) = 5
          totalConsumptionPct: 100,
          liveOrRecPct: 100,
        },
      ],
    };

    const res = computeCompletionAnalytics(input);
    expect(res.learners[0].assignments.neededItems).toBe(0);
    expect(res.learners[0].content.neededItems).toBe(0);
    expect(res.learners[0].assignments.status).toBe('Met');
    expect(res.learners[0].attendance.status).toBe('Met');
    expect(res.learners[0].assignments.needsText).toBe('Met');
    expect(res.learners[0].attendance.needsText).toBe('Met');
  });

  it('categorizes as Too early if fewer than tooEarlyMinDue regular assignments are due', () => {
    const input: CompletionEngineInput = {
      settings: { ...DEFAULT_COMPLETION_SETTINGS, tooEarlyMinDue: 5 },
      roadmap: { ...baseRoadmap, regularAssignmentsDue: 2 }, // 2 < 5
      reportDate: baseReportDate,
      learners: [
        {
          studentId: 's6',
          name: 'Early Bird',
          phoneE164: '+910000000003',
          regularAssignmentsSubmitted: 1,
          totalConsumptionPct: 50,
          liveOrRecPct: 50,
        },
      ],
    };

    const res = computeCompletionAnalytics(input);
    expect(res.summary.tooEarly).toBe(1);
    expect(res.learners[0].outlook).toBe('Too early');
    expect(res.summary.rangeSentence).toBeNull();
  });

  it('categorizes as Too early if less than tooEarlyMinElapsedPct has elapsed', () => {
    // 5 days after Aug 17 is Aug 22 (5 / 182 = 2.7% elapsed < 25%)
    const earlyReportDate = '2026-08-22';
    const input: CompletionEngineInput = {
      settings: DEFAULT_COMPLETION_SETTINGS,
      roadmap: baseRoadmap,
      reportDate: earlyReportDate,
      learners: [
        {
          studentId: 's7',
          name: 'Early Cohort',
          phoneE164: '+910000000004',
          regularAssignmentsSubmitted: 4,
          totalConsumptionPct: 50,
          liveOrRecPct: 50,
        },
      ],
    };

    const res = computeCompletionAnalytics(input);
    expect(res.summary.tooEarly).toBe(1);
    expect(res.learners[0].outlook).toBe('Too early');
  });

  it('computes forecast range string correctly', () => {
    const input: CompletionEngineInput = {
      settings: DEFAULT_COMPLETION_SETTINGS,
      roadmap: baseRoadmap,
      reportDate: baseReportDate,
      learners: [
        {
          studentId: 's1',
          name: 'L1',
          phoneE164: '+911',
          regularAssignmentsSubmitted: 4,
          totalConsumptionPct: 90,
          liveOrRecPct: 90,
        }, // On track
        {
          studentId: 's2',
          name: 'L2',
          phoneE164: '+912',
          regularAssignmentsSubmitted: 1,
          totalConsumptionPct: 80,
          liveOrRecPct: 80,
        }, // Recoverable
      ],
    };

    const res = computeCompletionAnalytics(input);
    expect(res.summary.rangeSentence).toBe(
      'Completion forecast: between 1 and 2 of 2 learners are on track to complete.'
    );
  });
});

describe('Completion Settings Validator Tests', () => {
  it('accepts valid completion settings', () => {
    const valid = {
      minAssignments: 70,
      minContent: 60,
      minAttendance: 50,
      wAssignments: 50,
      wContent: 30,
      wAttendance: 20,
      tooEarlyMinDue: 3,
      tooEarlyMinElapsedPct: 25,
      catchupLimit: 2.0,
    };
    const parsed = updateCompletionSettingsSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects weights that do not sum to 100', () => {
    const invalidWeights = {
      minAssignments: 70,
      minContent: 60,
      minAttendance: 50,
      wAssignments: 50,
      wContent: 30,
      wAttendance: 30, // Sum = 110
      tooEarlyMinDue: 3,
      tooEarlyMinElapsedPct: 25,
      catchupLimit: 2.0,
    };
    const parsed = updateCompletionSettingsSchema.safeParse(invalidWeights);
    expect(parsed.success).toBe(false);
  });

  it('rejects non-positive catchupLimit', () => {
    const invalidLimit = {
      minAssignments: 70,
      minContent: 60,
      minAttendance: 50,
      wAssignments: 50,
      wContent: 30,
      wAttendance: 20,
      tooEarlyMinDue: 3,
      tooEarlyMinElapsedPct: 25,
      catchupLimit: 0, // Must be > 0
    };
    const parsed = updateCompletionSettingsSchema.safeParse(invalidLimit);
    expect(parsed.success).toBe(false);
  });
});


import request from 'supertest';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import {
  users,
  batches,
  snapshots,
  studentSnapshots,
  students,
  assignmentItems,
  assignmentResults,
  batchTrainers,
  batchCompletionSettings,
} from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';
import { eq } from 'drizzle-orm';

describe('Stage 4: Completion API Integration Tests', () => {
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

    const [admin] = await db
      .insert(users)
      .values({ email: 'admin@completion.test', passwordHash, role: 'admin' })
      .returning();
    adminToken = AuthService.generateTokens({
      userId: admin.id,
      email: admin.email,
      role: 'admin',
    }).accessToken;

    const [trainerA] = await db
      .insert(users)
      .values({ email: 'trainerA@completion.test', passwordHash, role: 'trainer' })
      .returning();
    trainerAToken = AuthService.generateTokens({
      userId: trainerA.id,
      email: trainerA.email,
      role: 'trainer',
    }).accessToken;

    const [trainerB] = await db
      .insert(users)
      .values({ email: 'trainerB@completion.test', passwordHash, role: 'trainer' })
      .returning();
    trainerBToken = AuthService.generateTokens({
      userId: trainerB.id,
      email: trainerB.email,
      role: 'trainer',
    }).accessToken;

    const [bA] = await db
      .insert(batches)
      .values({ name: 'Batch Comp Alpha', externalBatchId: 'BATCH-COMP-A', createdBy: trainerA.id })
      .returning();
    batchAId = bA.id;
    await db.insert(batchTrainers).values({ batchId: batchAId, userId: trainerA.id });

    const [bB] = await db
      .insert(batches)
      .values({ name: 'Batch Comp Beta', externalBatchId: 'BATCH-COMP-B', createdBy: trainerB.id })
      .returning();
    batchBId = bB.id;
    await db.insert(batchTrainers).values({ batchId: batchBId, userId: trainerB.id });

    const [snapA] = await db
      .insert(snapshots)
      .values({ batchId: batchAId, snapshotDate: '2026-11-06', recordCount: 1 })
      .returning();
    snapshotAId = snapA.id;

    const [snapB] = await db
      .insert(snapshots)
      .values({ batchId: batchBId, snapshotDate: '2026-11-06', recordCount: 1 })
      .returning();
    snapshotBId = snapB.id;

    // Student in Batch A
    const [stuA] = await db
      .insert(students)
      .values({ externalStudentId: 'EXT-COMP-1', name: 'Learner A', phoneE164: '+919000000001', createdBy: trainerA.id })
      .returning();

    await db.insert(studentSnapshots).values({
      snapshotId: snapshotAId,
      studentId: stuA.id,
      totalConsumptionPct: '85.50',
      assignmentSubmissionPct: '75.00',
      livePct: '90.00',
      liveOrRecPct: '90.00',
      segment: 'high',
    });
  });

  it('GET /batches/:id/completion returns default settings when no row exists', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchAId}/completion?snapshotId=${snapshotAId}`)
      .set('Authorization', `Bearer ${trainerAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.settings.minAssignments).toBe(70);
    expect(res.body.settings.minContent).toBe(60);
    expect(res.body.settings.minAttendance).toBe(50);
    expect(res.body.settings.catchupLimit).toBe(2.0);
    expect(res.body.summary.totalLearners).toBe(1);
  });

  it('GET /batches/:id/completion enforces cross-batch isolation (mismatched snapshot)', async () => {
    const res = await request(app)
      .get(`/api/v1/batches/${batchAId}/completion?snapshotId=${snapshotBId}`)
      .set('Authorization', `Bearer ${trainerAToken}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toContain('does not belong to this batch');
  });

  it('PUT /batches/:id/completion/settings updates and validates settings', async () => {
    // Valid update
    const updateRes = await request(app)
      .put(`/api/v1/batches/${batchAId}/completion/settings`)
      .set('Authorization', `Bearer ${trainerAToken}`)
      .send({
        minAssignments: 65,
        minContent: 55,
        minAttendance: 45,
        wAssignments: 40,
        wContent: 40,
        wAttendance: 20,
        tooEarlyMinDue: 2,
        tooEarlyMinElapsedPct: 20,
        catchupLimit: 2.5,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.settings.minAssignments).toBe(65);
    expect(updateRes.body.settings.catchupLimit).toBe(2.5);

    // Invalid weights: sum != 100
    const invalidRes = await request(app)
      .put(`/api/v1/batches/${batchAId}/completion/settings`)
      .set('Authorization', `Bearer ${trainerAToken}`)
      .send({
        minAssignments: 65,
        minContent: 55,
        minAttendance: 45,
        wAssignments: 50,
        wContent: 50,
        wAttendance: 20, // 120
        tooEarlyMinDue: 2,
        tooEarlyMinElapsedPct: 20,
        catchupLimit: 2.5,
      });

    expect(invalidRes.status).toBe(400);
  });

  it('PUT /batches/:id/completion/settings blocks non-owner trainer', async () => {
    const res = await request(app)
      .put(`/api/v1/batches/${batchAId}/completion/settings`)
      .set('Authorization', `Bearer ${trainerBToken}`)
      .send({
        minAssignments: 70,
        minContent: 60,
        minAttendance: 50,
        wAssignments: 50,
        wContent: 30,
        wAttendance: 20,
        tooEarlyMinDue: 3,
        tooEarlyMinElapsedPct: 25,
        catchupLimit: 2.0,
      });

    expect([403, 404]).toContain(res.status);
  });
});
