import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db';
import { compareSnapshotsLocal } from '@/core/analytics/clientStrictCompare';

describe('Strict Compare Client Analytics Tests', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('rejects comparison if reports belong to different batches', async () => {
    await db.batches.bulkAdd([
      { id: 'batch-da', name: 'Data Analytics', createdAt: Date.now() },
      { id: 'batch-afsd', name: 'Full Stack Java', createdAt: Date.now() },
    ]);

    await db.snapshots.bulkAdd([
      {
        id: 'snap-1',
        batchId: 'batch-da',
        snapshotDate: '2026-10-20',
        fileName: 'da_1.xlsx',
        fileHash: 'hash-1',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-2',
        batchId: 'batch-afsd',
        snapshotDate: '2026-10-27',
        fileName: 'afsd_1.xlsx',
        fileHash: 'hash-2',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    const res = await compareSnapshotsLocal('batch-da', 'snap-1', 'snap-2');
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toContain('different cohort batches');
  });

  it('rejects comparison if dates are identical', async () => {
    await db.batches.add({ id: 'batch-da', name: 'Data Analytics', createdAt: Date.now() });

    await db.snapshots.bulkAdd([
      {
        id: 'snap-1',
        batchId: 'batch-da',
        snapshotDate: '2026-10-27',
        fileName: 'da_1.xlsx',
        fileHash: 'hash-1',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-2',
        batchId: 'batch-da',
        snapshotDate: '2026-10-27',
        fileName: 'da_2.xlsx',
        fileHash: 'hash-2',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    const res = await compareSnapshotsLocal('batch-da', 'snap-1', 'snap-2');
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toContain('Cannot compare a report to itself on the same date');
  });

  it('rejects comparison if learner set differs between reports', async () => {
    await db.batches.add({ id: 'batch-da', name: 'Data Analytics', createdAt: Date.now() });

    await db.snapshots.bulkAdd([
      {
        id: 'snap-1',
        batchId: 'batch-da',
        snapshotDate: '2026-10-20',
        fileName: 'da_1.xlsx',
        fileHash: 'hash-1',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-2',
        batchId: 'batch-da',
        snapshotDate: '2026-10-27',
        fileName: 'da_2.xlsx',
        fileHash: 'hash-2',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    // Student A in snap 1 & 2, Student B in snap 1 only, Student C in snap 2 only
    await db.students.bulkAdd([
      { id: 's1', externalStudentId: 'EXT1', name: 'Alice', phoneE164: '+919876543210' },
      { id: 's2', externalStudentId: 'EXT2', name: 'Bob', phoneE164: '+919876543211' },
      { id: 's3', externalStudentId: 'EXT3', name: 'Charlie', phoneE164: '+919876543212' },
    ]);

    const dummyMetrics = {
      totalConsumptionPct: 60,
      videoPct: 60,
      pdfPct: 60,
      quizSubmissionPct: 60,
      flashCardsPct: 60,
      aiContentPct: 60,
      assignmentSubmissionPct: 60,
      assignmentAggregateScorePct: 60,
      liveClassPct: 60,
      liveOrRecordingPct: 60,
      pdfTotal: 10,
      pdfConsumed: 6,
      videoTotal: 10,
      videoConsumed: 6,
      quizTotal: 10,
      quizAttended: 6,
      flashCardsTotal: 10,
      flashCardsConsumed: 6,
      aiContentTotal: 10,
      aiContentAttempted: 6,
      assignmentsTotal: 10,
      assignmentsSubmitted: 6,
      liveClassAttended: 6,
      liveClassTotal: 10,
      liveOrRecordingConsumed: 6,
    };

    await db.studentSnapshots.bulkAdd([
      { id: 'ss-1-1', snapshotId: 'snap-1', studentId: 's1', metrics: dummyMetrics, segment: 'Medium' },
      { id: 'ss-1-2', snapshotId: 'snap-1', studentId: 's2', metrics: dummyMetrics, segment: 'Medium' },
      { id: 'ss-2-1', snapshotId: 'snap-2', studentId: 's1', metrics: dummyMetrics, segment: 'Medium' },
      { id: 'ss-2-3', snapshotId: 'snap-2', studentId: 's3', metrics: dummyMetrics, segment: 'Medium' },
    ]);

    const res = await compareSnapshotsLocal('batch-da', 'snap-1', 'snap-2');
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toContain('Learner mismatch: 1 missing in current report, 1 extra in current report');
  });

  it('rejects comparison if baseline assignment is missing in current report', async () => {
    await db.batches.add({ id: 'batch-da', name: 'Data Analytics', createdAt: Date.now() });

    await db.snapshots.bulkAdd([
      {
        id: 'snap-1',
        batchId: 'batch-da',
        snapshotDate: '2026-10-20',
        fileName: 'da_1.xlsx',
        fileHash: 'hash-1',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-2',
        batchId: 'batch-da',
        snapshotDate: '2026-10-27',
        fileName: 'da_2.xlsx',
        fileHash: 'hash-2',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    await db.students.add({ id: 's1', externalStudentId: 'EXT1', name: 'Alice', phoneE164: '+919876543210' });

    const dummyMetrics = {
      totalConsumptionPct: 70,
      videoPct: 70,
      pdfPct: 70,
      quizSubmissionPct: 70,
      flashCardsPct: 70,
      aiContentPct: 70,
      assignmentSubmissionPct: 70,
      assignmentAggregateScorePct: 70,
      liveClassPct: 70,
      liveOrRecordingPct: 70,
      pdfTotal: 10,
      pdfConsumed: 7,
      videoTotal: 10,
      videoConsumed: 7,
      quizTotal: 10,
      quizAttended: 7,
      flashCardsTotal: 10,
      flashCardsConsumed: 7,
      aiContentTotal: 10,
      aiContentAttempted: 7,
      assignmentsTotal: 10,
      assignmentsSubmitted: 7,
      liveClassAttended: 7,
      liveClassTotal: 10,
      liveOrRecordingConsumed: 7,
    };

    await db.studentSnapshots.bulkAdd([
      { id: 'ss-1', snapshotId: 'snap-1', studentId: 's1', metrics: dummyMetrics, segment: 'Medium' },
      { id: 'ss-2', snapshotId: 'snap-2', studentId: 's1', metrics: dummyMetrics, segment: 'Medium' },
    ]);

    // snap-1 has Assignment A and B; snap-2 has Assignment B and C (missing A!)
    await db.assignmentResults.bulkAdd([
      { id: 'ar-1', snapshotId: 'snap-1', studentId: 's1', assignmentName: 'Assignment A', status: 'PASSED', score: 90, maxScore: 100 },
      { id: 'ar-2', snapshotId: 'snap-1', studentId: 's1', assignmentName: 'Assignment B', status: 'PASSED', score: 85, maxScore: 100 },
      { id: 'ar-3', snapshotId: 'snap-2', studentId: 's1', assignmentName: 'Assignment B', status: 'PASSED', score: 85, maxScore: 100 },
      { id: 'ar-4', snapshotId: 'snap-2', studentId: 's1', assignmentName: 'Assignment C', status: 'PASSED', score: 80, maxScore: 100 },
    ]);

    const res = await compareSnapshotsLocal('batch-da', 'snap-1', 'snap-2');
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toContain('Missing items in current report: assignment a');
  });

  it('allows extra items in current report and auto-sorts older on left, newer on right', async () => {
    await db.batches.add({ id: 'batch-da', name: 'Data Analytics', createdAt: Date.now() });

    await db.snapshots.bulkAdd([
      {
        id: 'snap-newer',
        batchId: 'batch-da',
        snapshotDate: '2026-10-27',
        fileName: 'da_27.xlsx',
        fileHash: 'hash-27',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-older',
        batchId: 'batch-da',
        snapshotDate: '2026-10-23',
        fileName: 'da_23.xlsx',
        fileHash: 'hash-23',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    await db.students.add({ id: 's1', externalStudentId: 'EXT1', name: 'Alice', phoneE164: '+919876543210' });

    const olderMetrics = {
      totalConsumptionPct: 50,
      videoPct: 50,
      pdfPct: 50,
      quizSubmissionPct: 50,
      flashCardsPct: 50,
      aiContentPct: 50,
      assignmentSubmissionPct: 50,
      assignmentAggregateScorePct: 50,
      liveClassPct: 50,
      liveOrRecordingPct: 50,
      pdfTotal: 10,
      pdfConsumed: 5,
      videoTotal: 10,
      videoConsumed: 5,
      quizTotal: 10,
      quizAttended: 5,
      flashCardsTotal: 10,
      flashCardsConsumed: 5,
      aiContentTotal: 10,
      aiContentAttempted: 5,
      assignmentsTotal: 10,
      assignmentsSubmitted: 5,
      liveClassAttended: 5,
      liveClassTotal: 10,
      liveOrRecordingConsumed: 5,
    };

    const newerMetrics = {
      totalConsumptionPct: 80,
      videoPct: 80,
      pdfPct: 80,
      quizSubmissionPct: 80,
      flashCardsPct: 80,
      aiContentPct: 80,
      assignmentSubmissionPct: 85,
      assignmentAggregateScorePct: 85,
      liveClassPct: 75,
      liveOrRecordingPct: 80,
      pdfTotal: 10,
      pdfConsumed: 8,
      videoTotal: 10,
      videoConsumed: 8,
      quizTotal: 10,
      quizAttended: 8,
      flashCardsTotal: 10,
      flashCardsConsumed: 8,
      aiContentTotal: 10,
      aiContentAttempted: 8,
      assignmentsTotal: 10,
      assignmentsSubmitted: 8,
      liveClassAttended: 8,
      liveClassTotal: 10,
      liveOrRecordingConsumed: 8,
    };

    await db.studentSnapshots.bulkAdd([
      { id: 'ss-old', snapshotId: 'snap-older', studentId: 's1', metrics: olderMetrics, segment: 'Medium' },
      { id: 'ss-new', snapshotId: 'snap-newer', studentId: 's1', metrics: newerMetrics, segment: 'High' },
    ]);

    // snap-older has Assignment A; snap-newer has Assignment A AND new Assignment B
    await db.assignmentResults.bulkAdd([
      { id: 'ar-1', snapshotId: 'snap-older', studentId: 's1', assignmentName: 'Assignment A', status: 'PASSED', score: 80, maxScore: 100 },
      { id: 'ar-2', snapshotId: 'snap-newer', studentId: 's1', assignmentName: 'Assignment A', status: 'PASSED', score: 85, maxScore: 100 },
      { id: 'ar-3', snapshotId: 'snap-newer', studentId: 's1', assignmentName: 'Assignment B (New)', status: 'PASSED', score: 90, maxScore: 100 },
    ]);

    // Request in reverse order: snap-newer first, snap-older second
    const res = await compareSnapshotsLocal('batch-da', 'snap-newer', 'snap-older');

    expect(res.isComparable).toBe(true);
    expect(res.fromSnapshotDate).toBe('2026-10-23'); // auto-sorted older to Left
    expect(res.toSnapshotDate).toBe('2026-10-27');   // auto-sorted newer to Right
    expect(res.daysGap).toBe(4);

    // Verify metrics delta: 85 - 50 = +35 pp
    expect(res.metrics?.assignmentSubmission.deltaPts).toBe(35);
    expect(res.metrics?.assignmentSubmission.status).toBe('Improved');

    // Verify extra assignment is flagged isNew: true
    const extraItem = res.assignmentComparison?.find((a) => a.name.includes('Assignment B'));
    expect(extraItem?.isNew).toBe(true);
    expect(extraItem?.status).toBe('NEW');

    // Verify segment matrix upgraded Medium -> High
    expect(res.segmentMatrix?.movedUp).toBe(1);
    expect(res.segmentMatrix?.matrix.Medium.High).toBe(1);
  });
});
