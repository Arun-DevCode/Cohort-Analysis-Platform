import { db } from '../db';
import type { Session, AttendanceRecord, WeeklyConsumption, AssignmentResult } from '@/types';
import {
  calculateCohortComparison,
  computeAverage,
  type CohortComparisonData,
} from './sharedMetrics';

export interface CompatibilityCheckItem {
  name: string;
  passed: boolean;
  detail: string;
}

export interface MetricComparisonItem {
  leftValue: number;
  rightValue: number;
  deltaPts: number;
  status: 'Improved' | 'Same' | 'Declined';
  arrow: string;
  leftAvg: number;
  rightAvg: number;
  leftMedian: number;
  rightMedian: number;
}

export interface StrictCompareResult {
  isComparable: boolean;
  shortReason?: string;
  checks: CompatibilityCheckItem[];
  batchId?: string;
  batchName?: string;
  batchKey?: string;
  fromSnapshotId?: string;
  toSnapshotId?: string;
  fromSnapshotDate?: string;
  toSnapshotDate?: string;
  daysGap?: number;
  sameItemsOnly?: boolean;
  fairComparisonNote?: string | null;
  sharedData?: CohortComparisonData;
  metrics?: Record<string, MetricComparisonItem>;
  headlineMetrics?: string[];
  learnerComparisons?: Array<{
    studentId: string;
    externalStudentId: string;
    name: string;
    phoneE164: string;
    leftSegment: string;
    rightSegment: string;
    leftComposite: number;
    rightComposite: number;
    compositeChange: number;
    status: 'Improved' | 'Same' | 'Declined';
    assignmentDelta: number;
    contentDelta: number;
    liveOrRecDelta: number;
    isFirstTimeSubmitter: boolean;
    isStoppedAttending: boolean;
    leftMetrics: Record<string, number>;
    rightMetrics: Record<string, number>;
  }>;
  topImprovers?: Array<{
    studentId: string;
    name: string;
    phoneE164: string;
    deltaPts: number;
    segment: string;
  }>;
  topDecliners?: Array<{
    studentId: string;
    name: string;
    phoneE164: string;
    deltaPts: number;
    segment: string;
  }>;
  firstTimeSubmitters?: Array<{
    studentId: string;
    name: string;
    phoneE164: string;
  }>;
  stoppedAttending?: Array<{
    studentId: string;
    name: string;
    phoneE164: string;
  }>;
  segmentMatrix?: {
    matrix: Record<string, Record<string, number>>;
    movedUp: number;
    movedDown: number;
    unchanged: number;
  };
  atRiskMovement?: {
    newlyAtRisk: Array<{ studentId: string; name: string; phoneE164: string; reasons: string[] }>;
    recovered: Array<{ studentId: string; name: string; phoneE164: string; reasons: string[] }>;
    stillAtRisk: Array<{ studentId: string; name: string; phoneE164: string; reasons: string[] }>;
    flags: {
      leftAttendsNoSubmit: number;
      rightAttendsNoSubmit: number;
      leftRecordingOnly: number;
      rightRecordingOnly: number;
    };
  };
  assignmentComparison?: Array<{
    name: string;
    status: 'SAME' | 'NEW';
    isNew: boolean;
    leftSubmissionRate: number | null;
    rightSubmissionRate: number;
    deltaPts: number | null;
    leftPassed: number;
    rightPassed: number;
    leftDelayed: number;
    rightDelayed: number;
    leftNotSubmitted: number;
    rightNotSubmitted: number;
    leftAvgScore: number | null;
    rightAvgScore: number | null;
  }>;
  contentComparison?: Array<{
    weekNo: number;
    isNew: boolean;
    status: 'SAME' | 'NEW';
    leftConsumedPct: number | null;
    rightConsumedPct: number;
    deltaPts: number | null;
  }>;
  sessionComparison?: Array<{
    title: string;
    date: string | null;
    isNew: boolean;
    status: 'SAME' | 'NEW';
    leftLiveRate: number | null;
    rightLiveRate: number;
    leftLiveRecRate: number | null;
    rightLiveRecRate: number;
    liveDeltaPts: number | null;
    liveRecDeltaPts: number | null;
  }>;
  insights?: {
    positives: string[];
    concerns: string[];
  };
}

function normalizeTitle(t: string): string {
  return t
    .replace(/[-_/\s]*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*$/i, '')
    .toLowerCase()
    .trim();
}

export async function compareSnapshotsLocal(
  batchId: string,
  idA: string,
  idB: string,
  options: { tolerance?: number; sameItems?: boolean } = {}
): Promise<StrictCompareResult> {
  const tolerance = options.tolerance ?? 2;
  const sameItems = options.sameItems === true;

  const batch = await db.batches.get(batchId);
  const snapA = await db.snapshots.get(idA);
  const snapB = await db.snapshots.get(idB);

  if (!batch || !snapA || !snapB) {
    throw new Error('Report or batch not found');
  }

  // Auto-sort chronologically: older is Left, newer is Right
  const [leftSnap, rightSnap] =
    snapA.snapshotDate.localeCompare(snapB.snapshotDate) <= 0 ? [snapA, snapB] : [snapB, snapA];

  const checks: CompatibilityCheckItem[] = [];

  // 1. Same Batch check
  const sameBatch = leftSnap.batchId === batchId && rightSnap.batchId === batchId;
  checks.push({
    name: 'Same Cohort Batch',
    passed: sameBatch,
    detail: sameBatch
      ? `Both reports belong to batch '${batch.name}'`
      : 'Reports belong to different cohort batches',
  });

  // 2. Different Dates check
  const diffDates = leftSnap.snapshotDate !== rightSnap.snapshotDate;
  checks.push({
    name: 'Different Report Dates',
    passed: diffDates,
    detail: diffDates
      ? `Baseline (${leftSnap.snapshotDate}) and Current (${rightSnap.snapshotDate}) are different dates`
      : `Cannot compare a report to itself on the same date (${leftSnap.snapshotDate})`,
  });

  // Load students for both
  const leftStudentSnaps = await db.studentSnapshots.where('snapshotId').equals(leftSnap.id).toArray();
  const rightStudentSnaps = await db.studentSnapshots.where('snapshotId').equals(rightSnap.id).toArray();
  const allStudents = await db.students.toArray();

  // 3. Learners Match 100% check
  const leftKeys = new Set(leftStudentSnaps.map((s) => s.studentId));
  const rightKeys = new Set(rightStudentSnaps.map((s) => s.studentId));
  const missingInRight = Array.from(leftKeys).filter((k) => !rightKeys.has(k));
  const extraInRight = Array.from(rightKeys).filter((k) => !leftKeys.has(k));
  const learnersMatch = missingInRight.length === 0 && extraInRight.length === 0 && leftKeys.size > 0;

  checks.push({
    name: 'Learners Match 100%',
    passed: learnersMatch,
    detail: learnersMatch
      ? `All ${leftKeys.size} learners match exactly across both reports`
      : `Learner mismatch: ${missingInRight.length} missing in current report, ${extraInRight.length} extra in current report`,
  });

  // 4. Curriculum Compatibility: Every assignment and session in left must be in right
  const leftAssigns: AssignmentResult[] = await db.assignmentResults.where('snapshotId').equals(leftSnap.id).toArray();
  const rightAssigns: AssignmentResult[] = await db.assignmentResults.where('snapshotId').equals(rightSnap.id).toArray();
  const leftAssignNames = new Set(leftAssigns.map((a) => a.assignmentName.toLowerCase().trim()));
  const rightAssignNames = new Set(rightAssigns.map((a) => a.assignmentName.toLowerCase().trim()));
  const missingAssigns = Array.from(leftAssignNames).filter((name) => !rightAssignNames.has(name));

  const leftSessions: Session[] = await db.sessions.where('snapshotId').equals(leftSnap.id).toArray();
  const rightSessions: Session[] = await db.sessions.where('snapshotId').equals(rightSnap.id).toArray();
  const leftSessionTitles = new Set(leftSessions.map((s) => normalizeTitle(s.title)));
  const rightSessionTitles = new Set(rightSessions.map((s) => normalizeTitle(s.title)));
  const missingSessions = Array.from(leftSessionTitles).filter((title) => !rightSessionTitles.has(title));

  const curriculumPassed = missingAssigns.length === 0 && missingSessions.length === 0;
  checks.push({
    name: 'Curriculum Continuity',
    passed: curriculumPassed,
    detail: curriculumPassed
      ? 'All baseline assignments and sessions exist in the current report'
      : `Missing items in current report: ${[...missingAssigns, ...missingSessions].slice(0, 3).join(', ')}`,
  });

  const isComparable = checks.every((c) => c.passed);
  if (!isComparable) {
    const failed = checks.find((c) => !c.passed);
    return {
      isComparable: false,
      shortReason: failed ? failed.detail : 'Reports are not comparable',
      checks,
    };
  }

  // Days gap
  const daysGap = Math.round(
    (new Date(rightSnap.snapshotDate).getTime() - new Date(leftSnap.snapshotDate).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  // Extra items in right
  const extraAssignNames = Array.from(rightAssignNames).filter((n) => !leftAssignNames.has(n));
  const extraSessionTitles = Array.from(rightSessionTitles).filter((t) => !leftSessionTitles.has(t));
  const hasExtraItems = extraAssignNames.length > 0 || extraSessionTitles.length > 0;

  // Attendance records for session comparison
  const allAttRecords: AttendanceRecord[] = await db.attendance.toArray();

  // Unified Cohort Comparison Calculation via Shared Metrics Module
  const sharedData = calculateCohortComparison({
    batch,
    baselineSnap: leftSnap,
    currentSnap: rightSnap,
    baselineStudentSnaps: leftStudentSnaps,
    currentStudentSnaps: rightStudentSnaps,
    students: allStudents,
    baselineAssignments: leftAssigns,
    currentAssignments: rightAssigns,
    baselineSessions: leftSessions,
    currentSessions: rightSessions,
    attendanceRecords: allAttRecords,
    sameItemsOnly: sameItems,
    tolerance,
  });

  const learnerComparisons = sharedData.learners;
  const topImprovers = sharedData.topImprovers;
  const topDecliners = sharedData.topDecliners;
  const matrix = sharedData.segmentMatrix.matrix;
  const movedUp = sharedData.segmentMatrix.movedUp;
  const movedDown = sharedData.segmentMatrix.movedDown;
  const unchanged = sharedData.segmentMatrix.unchanged;

  const newlyAtRisk = sharedData.atRiskMovement.newlyAtRisk;
  const recovered = sharedData.atRiskMovement.recovered;
  const stillAtRisk = sharedData.atRiskMovement.stillAtRisk;

  const firstTimeSubmitters = learnerComparisons
    .filter((l) => l.isFirstTimeSubmitter)
    .map((l) => ({ studentId: l.studentId, name: l.name, phoneE164: l.phoneE164 }));

  const stoppedAttending = learnerComparisons
    .filter((l) => l.isStoppedAttending)
    .map((l) => ({ studentId: l.studentId, name: l.name, phoneE164: l.phoneE164 }));

  const metrics: Record<string, MetricComparisonItem> = {
    assignmentSubmission: {
      leftValue: sharedData.metrics.assignmentSubmission.baselineDisplay,
      rightValue: sharedData.metrics.assignmentSubmission.currentDisplay,
      deltaPts: sharedData.metrics.assignmentSubmission.deltaDisplay,
      status: sharedData.metrics.assignmentSubmission.status,
      arrow: sharedData.metrics.assignmentSubmission.deltaDisplay > 0 ? '↑' : sharedData.metrics.assignmentSubmission.deltaDisplay < 0 ? '↓' : '→',
      leftAvg: sharedData.metrics.assignmentSubmission.baselineDisplay,
      rightAvg: sharedData.metrics.assignmentSubmission.currentDisplay,
      leftMedian: sharedData.metrics.assignmentSubmission.baselineMedian,
      rightMedian: sharedData.metrics.assignmentSubmission.currentMedian,
    },
    contentConsumption: {
      leftValue: sharedData.metrics.contentConsumption.baselineDisplay,
      rightValue: sharedData.metrics.contentConsumption.currentDisplay,
      deltaPts: sharedData.metrics.contentConsumption.deltaDisplay,
      status: sharedData.metrics.contentConsumption.status,
      arrow: sharedData.metrics.contentConsumption.deltaDisplay > 0 ? '↑' : sharedData.metrics.contentConsumption.deltaDisplay < 0 ? '↓' : '→',
      leftAvg: sharedData.metrics.contentConsumption.baselineDisplay,
      rightAvg: sharedData.metrics.contentConsumption.currentDisplay,
      leftMedian: sharedData.metrics.contentConsumption.baselineMedian,
      rightMedian: sharedData.metrics.contentConsumption.currentMedian,
    },
    liveAttendance: {
      leftValue: sharedData.metrics.liveAttendance.baselineDisplay,
      rightValue: sharedData.metrics.liveAttendance.currentDisplay,
      deltaPts: sharedData.metrics.liveAttendance.deltaDisplay,
      status: sharedData.metrics.liveAttendance.status,
      arrow: sharedData.metrics.liveAttendance.deltaDisplay > 0 ? '↑' : sharedData.metrics.liveAttendance.deltaDisplay < 0 ? '↓' : '→',
      leftAvg: sharedData.metrics.liveAttendance.baselineDisplay,
      rightAvg: sharedData.metrics.liveAttendance.currentDisplay,
      leftMedian: sharedData.metrics.liveAttendance.baselineMedian,
      rightMedian: sharedData.metrics.liveAttendance.currentMedian,
    },
    attendance: {
      leftValue: sharedData.metrics.attendance.baselineDisplay,
      rightValue: sharedData.metrics.attendance.currentDisplay,
      deltaPts: sharedData.metrics.attendance.deltaDisplay,
      status: sharedData.metrics.attendance.status,
      arrow: sharedData.metrics.attendance.deltaDisplay > 0 ? '↑' : sharedData.metrics.attendance.deltaDisplay < 0 ? '↓' : '→',
      leftAvg: sharedData.metrics.attendance.baselineDisplay,
      rightAvg: sharedData.metrics.attendance.currentDisplay,
      leftMedian: sharedData.metrics.attendance.baselineMedian,
      rightMedian: sharedData.metrics.attendance.currentMedian,
    },
  };

  // Assignment Comparison list
  const rightAssignByClean = new Map<string, AssignmentResult[]>();
  for (const a of rightAssigns) {
    const clean = a.assignmentName.toLowerCase().trim();
    const existing = rightAssignByClean.get(clean) || [];
    existing.push(a);
    rightAssignByClean.set(clean, existing);
  }

  const leftAssignByClean = new Map<string, AssignmentResult[]>();
  for (const a of leftAssigns) {
    const clean = a.assignmentName.toLowerCase().trim();
    const existing = leftAssignByClean.get(clean) || [];
    existing.push(a);
    leftAssignByClean.set(clean, existing);
  }

  const allAssignNames = Array.from(new Set([...rightAssignByClean.keys()]));
  const assignmentComparison = allAssignNames.map((name) => {
    const leftRows = leftAssignByClean.get(name) || [];
    const rightRows = rightAssignByClean.get(name) || [];
    const isNew = leftRows.length === 0;

    const rPassed = rightRows.filter((r) => r.status === 'PASSED' || r.status === 'DELAYED' || r.status === 'Pass' || r.status === 'Pass (Delayed)').length;
    const rDelayed = rightRows.filter((r) => r.status === 'DELAYED' || r.status === 'Pass (Delayed)').length;
    const rNotSub = rightRows.filter((r) => r.status === 'NOT_SUBMITTED' || r.status === 'Not Submitted').length;
    const rTotal = rightRows.length || 1;
    const rightRate = Number(((rPassed / rTotal) * 100).toFixed(1));

    let leftRate: number | null = null;
    let lPassed = 0;
    let lDelayed = 0;
    let lNotSub = 0;

    if (!isNew) {
      lPassed = leftRows.filter((r) => r.status === 'PASSED' || r.status === 'DELAYED' || r.status === 'Pass' || r.status === 'Pass (Delayed)').length;
      lDelayed = leftRows.filter((r) => r.status === 'DELAYED' || r.status === 'Pass (Delayed)').length;
      lNotSub = leftRows.filter((r) => r.status === 'NOT_SUBMITTED' || r.status === 'Not Submitted').length;
      leftRate = Number(((lPassed / (leftRows.length || 1)) * 100).toFixed(1));
    }

    const deltaPts = leftRate !== null ? Number((rightRate - leftRate).toFixed(1)) : null;
    const displayName = rightRows[0]?.assignmentName || name;

    return {
      name: displayName,
      status: (isNew ? 'NEW' : 'SAME') as 'NEW' | 'SAME',
      isNew,
      leftSubmissionRate: leftRate,
      rightSubmissionRate: rightRate,
      deltaPts,
      leftPassed: lPassed,
      rightPassed: rPassed,
      leftDelayed: lDelayed,
      rightDelayed: rDelayed,
      leftNotSubmitted: lNotSub,
      rightNotSubmitted: rNotSub,
      leftAvgScore: null,
      rightAvgScore: null,
    };
  });

  // Session Comparison list with AttendanceRecords
  const leftSessionMap = new Map<string, Session>();
  for (const s of leftSessions) {
    leftSessionMap.set(normalizeTitle(s.title), s);
  }

  const sessionComparison = rightSessions.map((rSess) => {
    const cleanTitle = normalizeTitle(rSess.title);
    const lSess = leftSessionMap.get(cleanTitle);
    const isNew = !lSess;

    const rLiveAtt = allAttRecords.filter((a) => a.sessionId === rSess.id && a.liveStatus === 'PRESENT').length;
    const rLiveRecAtt = allAttRecords.filter(
      (a) => a.sessionId === rSess.id && (a.liveStatus === 'PRESENT' || a.liveOrRecStatus === 'PRESENT')
    ).length;
    const rTotalStuds = rightStudentSnaps.length || 1;
    const rightLiveRate = Number(((rLiveAtt / rTotalStuds) * 100).toFixed(1));
    const rightLiveRecRate = Number(((rLiveRecAtt / rTotalStuds) * 100).toFixed(1));

    let leftLiveRate: number | null = null;
    let leftLiveRecRate: number | null = null;

    if (lSess) {
      const lLiveAtt = allAttRecords.filter((a) => a.sessionId === lSess.id && a.liveStatus === 'PRESENT').length;
      const lLiveRecAtt = allAttRecords.filter(
        (a) => a.sessionId === lSess.id && (a.liveStatus === 'PRESENT' || a.liveOrRecStatus === 'PRESENT')
      ).length;
      const lTotalStuds = leftStudentSnaps.length || 1;
      leftLiveRate = Number(((lLiveAtt / lTotalStuds) * 100).toFixed(1));
      leftLiveRecRate = Number(((lLiveRecAtt / lTotalStuds) * 100).toFixed(1));
    }

    const liveDeltaPts = leftLiveRate !== null ? Number((rightLiveRate - leftLiveRate).toFixed(1)) : null;
    const liveRecDeltaPts = leftLiveRecRate !== null ? Number((rightLiveRecRate - leftLiveRecRate).toFixed(1)) : null;

    return {
      title: rSess.title,
      date: rSess.sessionDate || null,
      isNew,
      status: (isNew ? 'NEW' : 'SAME') as 'NEW' | 'SAME',
      leftLiveRate,
      rightLiveRate,
      leftLiveRecRate,
      rightLiveRecRate,
      liveDeltaPts,
      liveRecDeltaPts,
    };
  });

  // Weekly content comparison
  const leftContent: WeeklyConsumption[] = await db.weeklyConsumption.where('snapshotId').equals(leftSnap.id).toArray();
  const rightContent: WeeklyConsumption[] = await db.weeklyConsumption.where('snapshotId').equals(rightSnap.id).toArray();

  const contentComparison: StrictCompareResult['contentComparison'] = [];
  const weekSet = new Set<number>([
    ...leftContent.map((c) => c.weekNo),
    ...rightContent.map((c) => c.weekNo),
  ]);
  const sortedWeeks = Array.from(weekSet).sort((a, b) => a - b);

  for (const w of sortedWeeks) {
    const lRows = leftContent.filter((c) => c.weekNo === w);
    const rRows = rightContent.filter((c) => c.weekNo === w);
    const isNew = lRows.length === 0;

    const rAvg = rRows.length > 0 ? computeAverage(rRows.map((r) => (r.total > 0 ? (r.consumed / r.total) * 100 : 0))) : 0;
    const lAvg = lRows.length > 0 ? computeAverage(lRows.map((r) => (r.total > 0 ? (r.consumed / r.total) * 100 : 0))) : null;
    const deltaPts = lAvg !== null ? Number((rAvg - lAvg).toFixed(1)) : null;

    contentComparison.push({
      weekNo: w,
      isNew,
      status: isNew ? 'NEW' : 'SAME',
      leftConsumedPct: lAvg,
      rightConsumedPct: rAvg,
      deltaPts,
    });
  }

  // Deterministic Insights
  const positives: string[] = [];
  const concerns: string[] = [];

  const assignDelta = metrics.assignmentSubmission.deltaPts;
  if (assignDelta >= tolerance) {
    positives.push(
      `Assignment submissions improved by +${assignDelta} pp across the cohort (${leftSnap.snapshotDate} → ${rightSnap.snapshotDate}).`
    );
  } else if (assignDelta <= -tolerance) {
    concerns.push(
      `Assignment submissions dropped by ${assignDelta} pp; review delayed and unsubmitted assignments.`
    );
  }

  const liveDelta = metrics.liveAttendance.deltaPts;
  if (liveDelta >= tolerance) {
    positives.push(`Live class attendance grew by +${liveDelta} pp over ${daysGap} days.`);
  } else if (liveDelta <= -tolerance) {
    concerns.push(`Live session attendance fell by ${liveDelta} pp; ${stoppedAttending.length} learners stopped attending live.`);
  }

  if (firstTimeSubmitters.length > 0) {
    positives.push(
      `${firstTimeSubmitters.length} previously inactive student(s) submitted their first assignment tasks.`
    );
  }

  if (newlyAtRisk.length > 0) {
    concerns.push(
      `${newlyAtRisk.length} student(s) newly transitioned into the at-risk segment requiring direct follow-up.`
    );
  }

  if (positives.length === 0) {
    positives.push('Cohort engagement remained steady within normal operational tolerance thresholds.');
  }

  return {
    isComparable: true,
    checks,
    batchId,
    batchName: batch.name,
    batchKey: batch.externalBatchId || batch.name,
    fromSnapshotId: leftSnap.id,
    toSnapshotId: rightSnap.id,
    fromSnapshotDate: leftSnap.snapshotDate,
    toSnapshotDate: rightSnap.snapshotDate,
    daysGap,
    sameItemsOnly: sameItems,
    fairComparisonNote: hasExtraItems
      ? `${extraAssignNames.length} new assignments and ${extraSessionTitles.length} new sessions in current report`
      : null,
    sharedData,
    metrics,
    headlineMetrics: [
      `Assignments: ${metrics.assignmentSubmission.arrow} ${metrics.assignmentSubmission.deltaPts >= 0 ? '+' : ''}${metrics.assignmentSubmission.deltaPts} pp`,
      `Consumption: ${metrics.contentConsumption.arrow} ${metrics.contentConsumption.deltaPts >= 0 ? '+' : ''}${metrics.contentConsumption.deltaPts} pp`,
      `Live Attendance: ${metrics.liveAttendance.arrow} ${metrics.liveAttendance.deltaPts >= 0 ? '+' : ''}${metrics.liveAttendance.deltaPts} pp`,
    ],
    learnerComparisons,
    topImprovers,
    topDecliners,
    firstTimeSubmitters,
    stoppedAttending,
    segmentMatrix: {
      matrix,
      movedUp,
      movedDown,
      unchanged,
    },
    atRiskMovement: {
      newlyAtRisk,
      recovered,
      stillAtRisk,
      flags: {
        leftAttendsNoSubmit: 0,
        rightAttendsNoSubmit: 0,
        leftRecordingOnly: 0,
        rightRecordingOnly: 0,
      },
    },
    assignmentComparison,
    sessionComparison,
    contentComparison,
    insights: {
      positives: positives.slice(0, 2),
      concerns: concerns.slice(0, 2),
    },
  };
}
