import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './index';
import { saveSnapshotTransaction, checkExistingSnapshot } from './snapshotRepository';
import type { ParseResult } from '@/types';

describe('snapshotRepository', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  const mockParseResult: ParseResult = {
    success: true,
    fileHash: 'mock-hash-123',
    fileName: 'test.xlsx',
    detectedBatchName: 'Batch 101',
    sheetsFound: ['Cumulative Report', 'Assignments', 'Content Consumption', 'Live Attendance', 'Attendance (Live+Recording)'],
    totalStudents: 1,
    students: [
      {
        id: 'std_1',
        externalStudentId: '1',
        name: 'Student One',
        phoneE164: '+919876543210',
      },
    ],
    metrics: [
      {
        studentId: 'std_1',
        metrics: {
          totalConsumptionPct: 75,
          videoPct: 80,
          pdfPct: 70,
          quizSubmissionPct: 60,
          flashCardsPct: 0,
          aiContentPct: 0,
          assignmentSubmissionPct: 50,
          assignmentAggregateScorePct: 50,
          liveClassPct: 90,
          liveOrRecordingPct: 90,
          pdfTotal: 10,
          pdfConsumed: 7,
          videoTotal: 10,
          videoConsumed: 8,
          quizTotal: 10,
          quizAttended: 6,
          flashCardsTotal: 0,
          flashCardsConsumed: 0,
          aiContentTotal: 0,
          aiContentAttempted: 0,
          assignmentsTotal: 4,
          assignmentsSubmitted: 2,
          liveClassAttended: 9,
          liveClassTotal: 10,
          liveOrRecordingConsumed: 9,
        },
        segment: 'Medium',
      },
    ],
    assignmentResults: [
      {
        studentId: 'std_1',
        assignmentName: 'Project 1',
        status: 'PASSED',
        score: 10,
        maxScore: 10,
      },
    ],
    weeklyConsumption: [
      {
        studentId: 'std_1',
        weekNo: 1,
        consumed: 5,
        total: 7,
      },
    ],
    sessions: [
      {
        title: 'Session 1',
        sessionDate: '2026-10-21',
        originalColumn: 'Session 1-21-10-2026',
        orderIndex: 0,
      },
    ],
    attendance: [
      {
        sessionId: 'sess_0',
        studentId: 'std_1',
        liveStatus: 'PRESENT',
        liveOrRecStatus: 'PRESENT',
      },
    ],
    errors: [],
    warnings: [],
    unmatchedRows: [],
    averages: {
      assignmentSubmissionAvg: 50,
      totalConsumptionAvg: 75,
      liveAttendanceAvg: 90,
      liveOrRecAvg: 90,
    },
  };

  it('saves snapshot atomically into Dexie stores', async () => {
    const { snapshotId, replaced } = await saveSnapshotTransaction({
      batchId: 'batch_1',
      batchName: 'Batch 101',
      snapshotDate: '2026-10-25',
      parseResult: mockParseResult,
    });

    expect(snapshotId).toBeDefined();
    expect(replaced).toBe(false);

    const savedSnapshot = await db.snapshots.get(snapshotId);
    expect(savedSnapshot).toBeDefined();
    expect(savedSnapshot?.batchId).toBe('batch_1');

    const existingCheck = await checkExistingSnapshot('batch_1', '2026-10-25');
    expect(existingCheck?.id).toBe(snapshotId);

    const students = await db.students.toArray();
    expect(students).toHaveLength(1);

    const metrics = await db.studentSnapshots.where('snapshotId').equals(snapshotId).toArray();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].metrics.totalConsumptionPct).toBe(75);
  });

  it('prevents accidental duplicate snapshot date without overwrite flag', async () => {
    await saveSnapshotTransaction({
      batchId: 'batch_1',
      batchName: 'Batch 101',
      snapshotDate: '2026-10-25',
      parseResult: mockParseResult,
    });

    await expect(
      saveSnapshotTransaction({
        batchId: 'batch_1',
        batchName: 'Batch 101',
        snapshotDate: '2026-10-25',
        parseResult: mockParseResult,
        allowOverwrite: false,
      })
    ).rejects.toThrow(/already exists/);
  });

  it('replaces existing snapshot cleanly when allowOverwrite is true', async () => {
    const { snapshotId: firstId } = await saveSnapshotTransaction({
      batchId: 'batch_1',
      batchName: 'Batch 101',
      snapshotDate: '2026-10-25',
      parseResult: mockParseResult,
    });

    const updatedResult = {
      ...mockParseResult,
      metrics: [
        {
          ...mockParseResult.metrics[0],
          metrics: {
            ...mockParseResult.metrics[0].metrics,
            totalConsumptionPct: 95,
          },
          segment: 'High' as const,
        },
      ],
    };

    const { snapshotId: secondId, replaced } = await saveSnapshotTransaction({
      batchId: 'batch_1',
      batchName: 'Batch 101',
      snapshotDate: '2026-10-25',
      parseResult: updatedResult,
      allowOverwrite: true,
    });

    expect(replaced).toBe(true);
    expect(secondId).toBe(firstId);

    const updatedMetrics = await db.studentSnapshots.where('snapshotId').equals(secondId).toArray();
    expect(updatedMetrics[0].metrics.totalConsumptionPct).toBe(95);
    expect(updatedMetrics[0].segment).toBe('High');
  });

  it('persists batchCode (externalBatchId) and keeps it updated', async () => {
    await saveSnapshotTransaction({
      batchId: 'batch_test_code',
      batchName: 'Full Stack Web Dev',
      batchCode: 'FSWD-101',
      snapshotDate: '2026-10-26',
      parseResult: mockParseResult,
    });

    const batch = await db.batches.get('batch_test_code');
    expect(batch?.name).toBe('Full Stack Web Dev');
    expect(batch?.externalBatchId).toBe('FSWD-101');
  });
});
