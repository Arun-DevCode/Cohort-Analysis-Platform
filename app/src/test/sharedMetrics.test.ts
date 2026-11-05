import { describe, it, expect } from 'vitest';
import {
  calculateCohortComparison,
  generateComparisonCsvString,
  generateReportPdf,
  roundDisplay,
  formatSignedDelta,
  escapeCsvField,
} from '../core/analytics/sharedMetrics';
import type {
  Batch,
  Snapshot,
  Student,
  StudentSnapshot,
  AssignmentResult,
} from '@/types';

describe('Shared Metrics & Export Verification Tests', () => {
  const dummyBatch: Batch = {
    id: 'batch_afsd_b49',
    name: 'Batch AFSD',
    externalBatchId: 'B49',
    createdAt: Date.now(),
  };

  const baselineSnap: Snapshot = {
    id: 'snap_baseline',
    batchId: dummyBatch.id,
    snapshotDate: '2026-10-30',
    fileName: 'AFSD-30.xlsx',
    fileHash: 'hash_base',
    parserVersion: '1.0',
    uploadedAt: Date.now(),
  };

  const currentSnap: Snapshot = {
    id: 'snap_current',
    batchId: dummyBatch.id,
    snapshotDate: '2026-11-02',
    fileName: 'AFSD-Nov3.xlsx',
    fileHash: 'hash_curr',
    parserVersion: '1.0',
    uploadedAt: Date.now(),
  };

  const students: Student[] = [
    { id: 's1', externalStudentId: '1001', name: 'Alice Smith', phoneE164: '+919876543210' },
    { id: 's2', externalStudentId: '1002', name: 'Bob Jones', phoneE164: '+919876543211' },
    { id: 's3', externalStudentId: '1003', name: 'Charlie Brown', phoneE164: '+919876543212' },
  ];

  const baselineStudentSnaps: StudentSnapshot[] = [
    {
      id: 'ss_b1',
      snapshotId: baselineSnap.id,
      studentId: 's1',
      segment: 'High',
      metrics: {
        totalConsumptionPct: 90,
        videoPct: 90,
        pdfPct: 90,
        quizSubmissionPct: 90,
        flashCardsPct: 90,
        aiContentPct: 90,
        assignmentSubmissionPct: 100, // 4/4
        assignmentAggregateScorePct: 95,
        liveClassPct: 80,
        liveOrRecordingPct: 90,
        pdfTotal: 10,
        pdfConsumed: 9,
        videoTotal: 10,
        videoConsumed: 9,
        quizTotal: 10,
        quizAttended: 9,
        flashCardsTotal: 10,
        flashCardsConsumed: 9,
        aiContentTotal: 10,
        aiContentAttempted: 9,
        assignmentsTotal: 4,
        assignmentsSubmitted: 4,
        liveClassAttended: 8,
        liveClassTotal: 10,
        liveOrRecordingConsumed: 9,
      },
    },
    {
      id: 'ss_b2',
      snapshotId: baselineSnap.id,
      studentId: 's2',
      segment: 'Medium',
      metrics: {
        totalConsumptionPct: 60,
        videoPct: 60,
        pdfPct: 60,
        quizSubmissionPct: 50,
        flashCardsPct: 50,
        aiContentPct: 50,
        assignmentSubmissionPct: 50, // 2/4
        assignmentAggregateScorePct: 70,
        liveClassPct: 60,
        liveOrRecordingPct: 70,
        pdfTotal: 10,
        pdfConsumed: 6,
        videoTotal: 10,
        videoConsumed: 6,
        quizTotal: 10,
        quizAttended: 5,
        flashCardsTotal: 10,
        flashCardsConsumed: 5,
        aiContentTotal: 10,
        aiContentAttempted: 5,
        assignmentsTotal: 4,
        assignmentsSubmitted: 2,
        liveClassAttended: 6,
        liveClassTotal: 10,
        liveOrRecordingConsumed: 7,
      },
    },
    {
      id: 'ss_b3',
      snapshotId: baselineSnap.id,
      studentId: 's3',
      segment: 'Low',
      metrics: {
        totalConsumptionPct: 30,
        videoPct: 30,
        pdfPct: 30,
        quizSubmissionPct: 20,
        flashCardsPct: 20,
        aiContentPct: 20,
        assignmentSubmissionPct: 25, // 1/4
        assignmentAggregateScorePct: 50,
        liveClassPct: 30,
        liveOrRecordingPct: 40,
        pdfTotal: 10,
        pdfConsumed: 3,
        videoTotal: 10,
        videoConsumed: 3,
        quizTotal: 10,
        quizAttended: 2,
        flashCardsTotal: 10,
        flashCardsConsumed: 2,
        aiContentTotal: 10,
        aiContentAttempted: 2,
        assignmentsTotal: 4,
        assignmentsSubmitted: 1,
        liveClassAttended: 3,
        liveClassTotal: 10,
        liveOrRecordingConsumed: 4,
      },
    },
  ];

  // In current snapshot, 1 new assignment is added (total 5).
  // Alice submitted 4/5 (reported = 80%, down 20pp in reported, but 4/4 = 100% in same items)
  const currentStudentSnaps: StudentSnapshot[] = [
    {
      id: 'ss_c1',
      snapshotId: currentSnap.id,
      studentId: 's1',
      segment: 'High',
      metrics: {
        ...baselineStudentSnaps[0].metrics,
        assignmentSubmissionPct: 80, // 4/5 in reported
        assignmentsTotal: 5,
        assignmentsSubmitted: 4,
      },
    },
    {
      id: 'ss_c2',
      snapshotId: currentSnap.id,
      studentId: 's2',
      segment: 'Medium',
      metrics: {
        ...baselineStudentSnaps[1].metrics,
        assignmentSubmissionPct: 60, // 3/5
        assignmentsTotal: 5,
        assignmentsSubmitted: 3,
      },
    },
    {
      id: 'ss_c3',
      snapshotId: currentSnap.id,
      studentId: 's3',
      segment: 'Low',
      metrics: {
        ...baselineStudentSnaps[2].metrics,
        assignmentSubmissionPct: 20, // 1/5
        assignmentsTotal: 5,
        assignmentsSubmitted: 1,
      },
    },
  ];

  const baselineAssignments: AssignmentResult[] = [
    { id: 'a1', snapshotId: baselineSnap.id, studentId: 's1', assignmentName: 'Task 1', status: 'PASSED', score: 10, maxScore: 10 },
    { id: 'a2', snapshotId: baselineSnap.id, studentId: 's1', assignmentName: 'Task 2', status: 'PASSED', score: 10, maxScore: 10 },
    { id: 'a3', snapshotId: baselineSnap.id, studentId: 's1', assignmentName: 'Task 3', status: 'PASSED', score: 10, maxScore: 10 },
    { id: 'a4', snapshotId: baselineSnap.id, studentId: 's1', assignmentName: 'Task 4', status: 'PASSED', score: 10, maxScore: 10 },
  ];

  const currentAssignments: AssignmentResult[] = [
    ...baselineAssignments.map((a) => ({ ...a, id: `curr_${a.id}`, snapshotId: currentSnap.id })),
    { id: 'a5', snapshotId: currentSnap.id, studentId: 's1', assignmentName: 'Task 5 (New)', status: 'NOT_SUBMITTED', score: 0, maxScore: 10 },
  ];

  it('correctly calculates metrics in "Reported values" mode', () => {
    const res = calculateCohortComparison({
      batch: dummyBatch,
      baselineSnap,
      currentSnap,
      baselineStudentSnaps,
      currentStudentSnaps,
      students,
      baselineAssignments,
      currentAssignments,
      sameItemsOnly: false,
    });

    expect(res.metadata.modeLabel).toBe('Reported values');
    expect(res.metadata.sameItemsOnly).toBe(false);
    expect(res.learners).toHaveLength(3);

    // Alice's reported assignment submission dropped from 100% to 80%
    const alice = res.learners.find((l) => l.studentId === 's1')!;
    expect(alice.leftMetrics.assignmentSubmissionPct).toBe(100);
    expect(alice.rightMetrics.assignmentSubmissionPct).toBe(80);
    expect(alice.assignmentDelta).toBe(-20);
  });

  it('correctly recalculates metrics in "Same items only" mode', () => {
    const res = calculateCohortComparison({
      batch: dummyBatch,
      baselineSnap,
      currentSnap,
      baselineStudentSnaps,
      currentStudentSnaps,
      students,
      baselineAssignments,
      currentAssignments,
      sameItemsOnly: true,
    });

    expect(res.metadata.modeLabel).toBe('Same items only');
    expect(res.metadata.sameItemsOnly).toBe(true);

    // Under same items only, Task 5 is excluded. Alice has 4/4 common assignments = 100%
    const alice = res.learners.find((l) => l.studentId === 's1')!;
    expect(alice.leftMetrics.assignmentSubmissionPct).toBe(100);
    expect(alice.rightMetrics.assignmentSubmissionPct).toBe(100);
    expect(alice.assignmentDelta).toBe(0);
  });

  it('prevents "-0.0" and negative zero formatting', () => {
    expect(roundDisplay(-0.0001, 1)).toBe(0);
    expect(Object.is(roundDisplay(-0.0001, 1), -0)).toBe(false);
    expect(formatSignedDelta(0)).toBe('0.0 pp');
  });

  it('exports CSV with UTF-8 BOM, metadata header, formula escaping and round-trips cleanly', () => {
    const res = calculateCohortComparison({
      batch: dummyBatch,
      baselineSnap,
      currentSnap,
      baselineStudentSnaps,
      currentStudentSnaps,
      students,
      sameItemsOnly: false,
    });

    const csvStr = generateComparisonCsvString(res);

    // 1. Starts with UTF-8 BOM
    expect(csvStr.charCodeAt(0)).toBe(0xfeff);

    // 2. Metadata comments present
    expect(csvStr).toContain('# Cohort Comparison Report');
    expect(csvStr).toContain('# Batch: Batch AFSD (Code: B49)');
    expect(csvStr).toContain('# Baseline Report: AFSD-30.xlsx (2026-10-30)');
    expect(csvStr).toContain('# Current Report: AFSD-Nov3.xlsx (2026-11-02)');
    expect(csvStr).toContain('# Comparison Mode: Reported values');

    // 3. Round-trip parse: all learners match on-screen figures
    const contentLines = csvStr
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .filter((l) => l.trim() && !l.startsWith('#'));

    // Header + 3 learner rows = 4 rows
    expect(contentLines).toHaveLength(4);
    const header = contentLines[0];
    expect(header).toContain('Student ID');
    expect(header).toContain('Student Name');
    expect(header).toContain('Baseline Composite');
    expect(header).toContain('Composite Change (pp)');

    // Row 1 should be Alice
    const row1 = contentLines[1];
    expect(row1).toContain('"1001"');
    expect(row1).toContain('"Alice Smith"');
  });

  it('escapes cells starting with formula trigger characters (=, +, -, @)', () => {
    expect(escapeCsvField('=SUM(A1:A10)')).toBe(`"'=SUM(A1:A10)"`);
    expect(escapeCsvField('+12345')).toBe(`"'+12345"`);
    expect(escapeCsvField('-negative')).toBe(`"'-negative"`);
    expect(escapeCsvField('@cmd')).toBe(`"'@cmd"`);
    expect(escapeCsvField('Normal Name')).toBe(`"Normal Name"`);
  });

  it('generates a valid single-page A4 PDF with vector text and sharp sections', () => {
    const pdf = generateReportPdf({
      batchName: 'Batch AFSD',
      snapshotDate: '2026-11-02',
      previousSnapshotDate: '2026-10-30',
      studentCount: 31,
      scorecards: {
        assignment: { currentValue: 58.1, deltaPts: -4.0 },
        consumption: { currentValue: 66.4, deltaPts: -1.4 },
        liveAttendance: { currentValue: 70.1, deltaPts: -1.3 },
      },
      segmentation: {
        highCount: 15,
        mediumCount: 7,
        lowCount: 9,
      },
      atRiskStudents: [
        {
          studentName: 'Sathish Kumar',
          segment: 'Low',
          reasons: ['Content below 50%'],
          totalConsumptionPct: 26,
          assignmentSubmissionPct: 20,
        },
      ],
      takeaways: ['Engagement stayed within normal operational tolerance.'],
    });

    // Output must be exactly one A4 page
    expect(pdf.getNumberOfPages()).toBe(1);
  });

  it('handles edge cases: missing learners in one snapshot, zero denominators, long names', () => {
    // 1. One student present only in baseline, not current
    const incompleteCurrentSnaps = currentStudentSnaps.filter((s) => s.studentId !== 's3');
    const res = calculateCohortComparison({
      batch: dummyBatch,
      baselineSnap,
      currentSnap,
      baselineStudentSnaps,
      currentStudentSnaps: incompleteCurrentSnaps,
      students,
      sameItemsOnly: false,
    });
    // s3 is omitted from paired comparison cleanly
    expect(res.learners).toHaveLength(2);

    // 2. Zero denominators (no assignments at all)
    const zeroMetricsStudentSnaps: StudentSnapshot[] = [
      {
        ...baselineStudentSnaps[0],
        metrics: {
          ...baselineStudentSnaps[0].metrics,
          assignmentsTotal: 0,
          assignmentsSubmitted: 0,
          assignmentSubmissionPct: 0,
        },
      },
    ];
    const zeroRes = calculateCohortComparison({
      batch: dummyBatch,
      baselineSnap,
      currentSnap,
      baselineStudentSnaps: zeroMetricsStudentSnaps,
      currentStudentSnaps: zeroMetricsStudentSnaps,
      students,
      baselineAssignments: [],
      currentAssignments: [],
      sameItemsOnly: true,
    });
    expect(zeroRes.metrics.assignmentSubmission.deltaDisplay).toBe(0);
    expect(isNaN(zeroRes.metrics.assignmentSubmission.deltaDisplay)).toBe(false);

    // 3. Special characters & very long student names
    const longNameStudent: Student = {
      id: 's_special',
      externalStudentId: '99999',
      name: 'Dr. John "The Legend" O\'Connor-Smith =1+1 @Admin <script>alert(1)</script> Very Long Extended Academic Student Full Name Exceeding Normal Column Constraints',
      phoneE164: '+919999999999',
    };
    const longSnap: StudentSnapshot = {
      ...baselineStudentSnaps[0],
      studentId: longNameStudent.id,
    };

    const specialRes = calculateCohortComparison({
      batch: dummyBatch,
      baselineSnap,
      currentSnap,
      baselineStudentSnaps: [longSnap],
      currentStudentSnaps: [longSnap],
      students: [longNameStudent],
    });

    expect(specialRes.learners[0].name).toBe(longNameStudent.name);
    const specialCsv = generateComparisonCsvString(specialRes);
    // Formula trigger character escaped
    expect(specialCsv).toContain("Dr. John");
  });
});
