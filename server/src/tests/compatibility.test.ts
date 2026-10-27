import { describe, it, expect } from 'vitest';
import {
  extractBatchKey,
  normalizeSessionTitleWithoutDate,
  normalizeAssignmentName,
  checkCompatibility,
  SnapshotFingerprint,
} from '../services/analytics/compatibility.service.js';

describe('Compatibility Service Unit Tests', () => {
  it('extractBatchKey resolves case variants of batch code (ANb22, AnB22, ANB22) to the same batch_key', () => {
    const v1 = extractBatchKey('DA', ['TN-DA-ANB22-23Oct-Matplotlib-23-10-2026']);
    const v2 = extractBatchKey('DA', ['TN-DA-Anb22-23Oct-Matplotlib-23-10-2026']);
    const v3 = extractBatchKey('DA', ['TN-DA-anb22-23Oct-Matplotlib-23-10-2026']);
    const v4 = extractBatchKey('DA', ['DA-B22-23Oct-Matplotlib-23-10-2026']);

    expect(v1).toBe('DA-B22');
    expect(v2).toBe('DA-B22');
    expect(v3).toBe('DA-B22');
    expect(v4).toBe('DA-B22');
  });

  it('extractBatchKey resolves through session titles even if file is renamed', () => {
    const key = extractBatchKey('DA', ['TN-DA-ANB22-23Oct-Matplotlib-23-10-2026'], 'Random_Name_Report.xlsx');
    expect(key).toBe('DA-B22');
  });

  it('normalizeSessionTitleWithoutDate strips trailing dates and intermediate tokens', () => {
    const t1 = normalizeSessionTitleWithoutDate('TN-DA-ANB22-23Oct-Matplotlib-23-10-2026');
    const t2 = normalizeSessionTitleWithoutDate('TN-DA-Anb22-23Oct-Matplotlib-23-10-2026');
    expect(t1).toBe('tn-da-b22-matplotlib');
    expect(t2).toBe('tn-da-b22-matplotlib');
  });

  it('normalizeAssignmentName strips "(Status / Score)" suffix and trims', () => {
    expect(normalizeAssignmentName('EDA Mini Project (Status / Score)')).toBe('eda mini project');
    expect(normalizeAssignmentName('SQL Assignment 1 ')).toBe('sql assignment 1');
  });

  const baseFingerprint: SnapshotFingerprint = {
    version: 1,
    snapshotId: 'snap-left',
    batchId: 'batch-1',
    batchKey: 'DA-B22',
    reportDate: '2026-10-20',
    fileHash: 'hash-left',
    sheets: [
      'Cumulative Report',
      'Assignments',
      'Content Consumption',
      'Live Attendance',
      'Attendance (Live+Recording)',
    ],
    coreColumns: {
      'Cumulative Report': ['Student ID', 'Name', 'Phone'],
      Assignments: ['Student ID', 'Name', 'Phone'],
      'Content Consumption': ['Student ID', 'Name', 'Phone'],
      'Live Attendance': ['Name', 'Phone'],
      'Attendance (Live+Recording)': ['Name', 'Phone'],
    },
    assignmentNames: ['assignment 1', 'assignment 2'],
    sessionTitlesWithoutDates: ['tn-da-b22-python-intro', 'tn-da-b22-pandas'],
    weekNumbers: [1, 2, 3],
    learners: [
      { studentId: 'STD_01', phoneE164: '+919800000001', nameNormalized: 'alice', displayName: 'Alice' },
      { studentId: 'STD_02', phoneE164: '+919800000002', nameNormalized: 'bob', displayName: 'Bob' },
    ],
    createdAt: new Date().toISOString(),
  };

  it('checkCompatibility succeeds when right report has extra sessions and assignments', () => {
    const rightFingerprint: SnapshotFingerprint = {
      ...baseFingerprint,
      snapshotId: 'snap-right',
      reportDate: '2026-10-27',
      assignmentNames: ['assignment 1', 'assignment 2', 'assignment 3 (new)'],
      sessionTitlesWithoutDates: ['tn-da-b22-python-intro', 'tn-da-b22-pandas', 'tn-da-b22-matplotlib (new)'],
      weekNumbers: [1, 2, 3, 4],
    };

    const res = checkCompatibility(baseFingerprint, rightFingerprint);
    expect(res.isComparable).toBe(true);
    expect(res.checks.every((c) => c.passed)).toBe(true);
  });

  it('checkCompatibility fails if left report item is missing in right report', () => {
    const rightFingerprint: SnapshotFingerprint = {
      ...baseFingerprint,
      snapshotId: 'snap-right',
      reportDate: '2026-10-27',
      assignmentNames: ['assignment 1'], // assignment 2 missing!
    };

    const res = checkCompatibility(baseFingerprint, rightFingerprint);
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toMatch(/Course structure differs/i);
    const currCheck = res.checks.find((c) => c.name === 'curriculum_compatible');
    expect(currCheck?.passed).toBe(false);
  });

  it('checkCompatibility fails if report dates are identical', () => {
    const rightFingerprint: SnapshotFingerprint = {
      ...baseFingerprint,
      snapshotId: 'snap-right',
      reportDate: '2026-10-20', // Same date!
    };

    const res = checkCompatibility(baseFingerprint, rightFingerprint);
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toBe('Both reports have the same date. Choose reports with different dates.');
  });

  it('checkCompatibility fails if batch keys differ (e.g. B22 vs B15)', () => {
    const rightFingerprint: SnapshotFingerprint = {
      ...baseFingerprint,
      snapshotId: 'snap-right',
      batchKey: 'DA-B15',
      reportDate: '2026-10-27',
    };

    const res = checkCompatibility(baseFingerprint, rightFingerprint);
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toBe('These reports belong to different batches (DA-B22 and DA-B15).');
  });

  it('checkCompatibility fails if learners do not match 100%', () => {
    const rightFingerprint: SnapshotFingerprint = {
      ...baseFingerprint,
      snapshotId: 'snap-right',
      reportDate: '2026-10-27',
      learners: [
        { studentId: 'STD_01', phoneE164: '+919800000001', nameNormalized: 'alice', displayName: 'Alice' },
        { studentId: 'STD_03', phoneE164: '+919800000003', nameNormalized: 'charlie', displayName: 'Charlie' },
      ],
    };

    const res = checkCompatibility(baseFingerprint, rightFingerprint);
    expect(res.isComparable).toBe(false);
    expect(res.shortReason).toBe('Learners do not match: 1 only in the left report, 1 only in the right report.');
    const learnerCheck = res.checks.find((c) => c.name === 'learners_match_100');
    expect(learnerCheck?.passed).toBe(false);
    expect(learnerCheck?.metadata?.onlyInLeft).toContain('Bob');
    expect(learnerCheck?.metadata?.onlyInRight).toContain('Charlie');
  });
});
