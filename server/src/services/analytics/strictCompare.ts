import { getDb } from '../../db/client.js';
import {
  snapshots,
  batches,
  students,
  studentSnapshots,
  assignmentItems,
  assignmentResults,
  sessions,
  attendance,
  weeklyConsumption,
} from '../../db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler.js';
import {
  buildFingerprintFromStoredSnapshot,
  checkCompatibility,
  CompatibilityCheckItem,
  normalizeAssignmentName,
  normalizeSessionTitleWithoutDate,
} from './compatibility.service.js';
import { computeAverage, computeMedian, computeDelta, classifyMovement } from './metrics.js';
import { identifyAtRiskStudents, AtRiskCandidate } from './atRisk.js';
import { SegmentType } from './segments.js';

export interface StrictCompareOptions {
  tolerance?: number;
  sameItems?: boolean;
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

export async function compareStrictSnapshots(
  batchId: string,
  idA: string,
  idB: string,
  options: StrictCompareOptions = {}
): Promise<StrictCompareResult> {
  const tolerance = options.tolerance ?? 2;
  const sameItems = options.sameItems === true;
  const db = getDb();

  // 1. Fetch batch and both snapshots
  const batch = await db.query.batches.findFirst({
    where: eq(batches.id, batchId),
  });
  if (!batch) {
    throw new AppError('Report not found', 404, 'NOT_FOUND');
  }

  const snapA = await db.query.snapshots.findFirst({
    where: and(eq(snapshots.id, idA), eq(snapshots.batchId, batchId)),
  });
  const snapB = await db.query.snapshots.findFirst({
    where: and(eq(snapshots.id, idB), eq(snapshots.batchId, batchId)),
  });

  if (!snapA || !snapB) {
    throw new AppError('Report not found', 404, 'NOT_FOUND');
  }

  // 2. Auto-sort: older is LEFT, newer is RIGHT
  let leftSnap = snapA;
  let rightSnap = snapB;
  if (snapA.snapshotDate > snapB.snapshotDate) {
    leftSnap = snapB;
    rightSnap = snapA;
  }

  // 3. Build fingerprints and run checkCompatibility
  const leftFp = await buildFingerprintFromStoredSnapshot(leftSnap.id);
  const rightFp = await buildFingerprintFromStoredSnapshot(rightSnap.id);

  const compatibility = checkCompatibility(leftFp, rightFp);
  if (!compatibility.isComparable) {
    return {
      isComparable: false,
      shortReason: compatibility.shortReason,
      checks: compatibility.checks,
    };
  }

  // 4. Fetch facts & items for Left and Right
  const leftStudentSnapshots = await db
    .select({
      id: studentSnapshots.id,
      studentId: students.id,
      externalStudentId: students.externalStudentId,
      name: students.name,
      phoneE164: students.phoneE164,
      totalConsumptionPct: studentSnapshots.totalConsumptionPct,
      videoPct: studentSnapshots.videoPct,
      pdfPct: studentSnapshots.pdfPct,
      quizPct: studentSnapshots.quizPct,
      flashcardsPct: studentSnapshots.flashcardsPct,
      aiContentPct: studentSnapshots.aiContentPct,
      assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
      assignmentScorePct: studentSnapshots.assignmentScorePct,
      livePct: studentSnapshots.livePct,
      liveOrRecPct: studentSnapshots.liveOrRecPct,
      assignmentsTotal: studentSnapshots.assignmentsTotal,
      assignmentsSubmitted: studentSnapshots.assignmentsSubmitted,
      liveTotal: studentSnapshots.liveTotal,
      liveAttended: studentSnapshots.liveAttended,
      segment: studentSnapshots.segment,
    })
    .from(studentSnapshots)
    .innerJoin(students, eq(studentSnapshots.studentId, students.id))
    .where(eq(studentSnapshots.snapshotId, leftSnap.id));

  const rightStudentSnapshots = await db
    .select({
      id: studentSnapshots.id,
      studentId: students.id,
      externalStudentId: students.externalStudentId,
      name: students.name,
      phoneE164: students.phoneE164,
      totalConsumptionPct: studentSnapshots.totalConsumptionPct,
      videoPct: studentSnapshots.videoPct,
      pdfPct: studentSnapshots.pdfPct,
      quizPct: studentSnapshots.quizPct,
      flashcardsPct: studentSnapshots.flashcardsPct,
      aiContentPct: studentSnapshots.aiContentPct,
      assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
      assignmentScorePct: studentSnapshots.assignmentScorePct,
      livePct: studentSnapshots.livePct,
      liveOrRecPct: studentSnapshots.liveOrRecPct,
      assignmentsTotal: studentSnapshots.assignmentsTotal,
      assignmentsSubmitted: studentSnapshots.assignmentsSubmitted,
      liveTotal: studentSnapshots.liveTotal,
      liveAttended: studentSnapshots.liveAttended,
      segment: studentSnapshots.segment,
    })
    .from(studentSnapshots)
    .innerJoin(students, eq(studentSnapshots.studentId, students.id))
    .where(eq(studentSnapshots.snapshotId, rightSnap.id));

  // Map students by identity
  const rightStudentMap = new Map(rightStudentSnapshots.map((s) => [s.studentId, s]));

  // Assignments
  const leftAssignmentItems = await db.query.assignmentItems.findMany({
    where: eq(assignmentItems.snapshotId, leftSnap.id),
  });
  const rightAssignmentItems = await db.query.assignmentItems.findMany({
    where: eq(assignmentItems.snapshotId, rightSnap.id),
  });

  const leftAssignmentResults = await db
    .select()
    .from(assignmentResults)
    .innerJoin(assignmentItems, eq(assignmentResults.assignmentItemId, assignmentItems.id))
    .where(eq(assignmentItems.snapshotId, leftSnap.id));

  const rightAssignmentResults = await db
    .select()
    .from(assignmentResults)
    .innerJoin(assignmentItems, eq(assignmentResults.assignmentItemId, assignmentItems.id))
    .where(eq(assignmentItems.snapshotId, rightSnap.id));

  // Sessions & Attendance
  const leftSessions = await db.query.sessions.findMany({
    where: eq(sessions.snapshotId, leftSnap.id),
  });
  const rightSessions = await db.query.sessions.findMany({
    where: eq(sessions.snapshotId, rightSnap.id),
  });

  const leftAttendance = await db
    .select()
    .from(attendance)
    .innerJoin(sessions, eq(attendance.sessionId, sessions.id))
    .where(eq(sessions.snapshotId, leftSnap.id));

  const rightAttendance = await db
    .select()
    .from(attendance)
    .innerJoin(sessions, eq(attendance.sessionId, sessions.id))
    .where(eq(sessions.snapshotId, rightSnap.id));

  // Weekly Consumption
  const leftWeeks = await db.query.weeklyConsumption.findMany({
    where: eq(weeklyConsumption.snapshotId, leftSnap.id),
  });
  const rightWeeks = await db.query.weeklyConsumption.findMany({
    where: eq(weeklyConsumption.snapshotId, rightSnap.id),
  });

  // Identify common items vs new items in right
  const leftItemNormSet = new Set(leftAssignmentItems.map((i) => normalizeAssignmentName(i.name)));
  const rightNewAssignmentItems = rightAssignmentItems.filter(
    (i) => !leftItemNormSet.has(normalizeAssignmentName(i.name))
  );

  const leftSessionNormSet = new Set(leftSessions.map((s) => normalizeSessionTitleWithoutDate(s.title)));
  const rightNewSessions = rightSessions.filter(
    (s) => !leftSessionNormSet.has(normalizeSessionTitleWithoutDate(s.title))
  );

  const leftWeekSet = new Set(leftWeeks.map((w) => w.weekNo));
  const rightNewWeeks = Array.from(new Set(rightWeeks.map((w) => w.weekNo))).filter(
    (w) => !leftWeekSet.has(w)
  );

  let fairComparisonNote: string | null = null;
  if (rightNewSessions.length > 0 || rightNewAssignmentItems.length > 0 || rightNewWeeks.length > 0) {
    const parts: string[] = [];
    if (rightNewSessions.length > 0) parts.push(`${rightNewSessions.length} new session(s)`);
    if (rightNewAssignmentItems.length > 0)
      parts.push(`${rightNewAssignmentItems.length} new assignment(s)`);
    if (rightNewWeeks.length > 0) parts.push(`${rightNewWeeks.length} new week(s)`);
    fairComparisonNote = `The right report has ${parts.join(' and ')}.`;
  }

  // Filter if sameItems is requested
  const commonAssignmentNames = new Set(
    leftAssignmentItems.map((i) => normalizeAssignmentName(i.name))
  );
  const commonSessionTitles = new Set(
    leftSessions.map((s) => normalizeSessionTitleWithoutDate(s.title))
  );
  const commonWeeks = leftWeekSet;

  // 5. Build Learner Comparison List
  const learnerComparisons: StrictCompareResult['learnerComparisons'] = [];
  const firstTimeSubmitters: Array<{ studentId: string; name: string; phoneE164: string }> = [];
  const stoppedAttending: Array<{ studentId: string; name: string; phoneE164: string }> = [];

  for (const leftS of leftStudentSnapshots) {
    const rightS = rightStudentMap.get(leftS.studentId);
    if (!rightS) continue;

    let leftAssignPct = Number(leftS.assignmentSubmissionPct);
    let rightAssignPct = Number(rightS.assignmentSubmissionPct);

    let leftConsPct = Number(leftS.totalConsumptionPct);
    let rightConsPct = Number(rightS.totalConsumptionPct);

    let leftLiveRecPct = Number(leftS.liveOrRecPct);
    let rightLiveRecPct = Number(rightS.liveOrRecPct);

    let leftLivePct = Number(leftS.livePct);
    let rightLivePct = Number(rightS.livePct);

    if (sameItems) {
      // Recompute assignment rate using only common items
      const rightCommonResults = rightAssignmentResults.filter(
        (r) =>
          r.assignment_results.studentId === rightS.studentId &&
          commonAssignmentNames.has(normalizeAssignmentName(r.assignment_items.name))
      );
      const rightCommonSubmitted = rightCommonResults.filter(
        (r) =>
          r.assignment_results.status.toUpperCase() === 'PASSED' ||
          r.assignment_results.status.toUpperCase() === 'SUBMITTED'
      ).length;
      rightAssignPct =
        leftAssignmentItems.length > 0
          ? Number(((rightCommonSubmitted / leftAssignmentItems.length) * 100).toFixed(1))
          : 0;

      // Recompute attendance using only common sessions
      const rightCommonAtt = rightAttendance.filter(
        (a) =>
          a.attendance.studentId === rightS.studentId &&
          commonSessionTitles.has(normalizeSessionTitleWithoutDate(a.sessions.title))
      );
      const rightCommonAttended = rightCommonAtt.filter(
        (a) =>
          a.attendance.liveOrRecStatus.toUpperCase() === 'PRESENT' ||
          a.attendance.liveOrRecStatus.toUpperCase() === 'PARTIAL'
      ).length;
      rightLiveRecPct =
        leftSessions.length > 0
          ? Number(((rightCommonAttended / leftSessions.length) * 100).toFixed(1))
          : 0;

      const rightCommonLiveAttended = rightCommonAtt.filter(
        (a) =>
          a.attendance.liveStatus.toUpperCase() === 'PRESENT' ||
          a.attendance.liveStatus.toUpperCase() === 'PARTIAL'
      ).length;
      rightLivePct =
        leftSessions.length > 0
          ? Number(((rightCommonLiveAttended / leftSessions.length) * 100).toFixed(1))
          : 0;

      // Recompute consumption using only common weeks
      const rightCommonWeekRows = rightWeeks.filter(
        (w) => w.studentId === rightS.studentId && commonWeeks.has(w.weekNo)
      );
      const consumedSum = rightCommonWeekRows.reduce((acc, curr) => acc + curr.consumed, 0);
      const totalSum = rightCommonWeekRows.reduce((acc, curr) => acc + curr.total, 0);
      rightConsPct = totalSum > 0 ? Number(((consumedSum / totalSum) * 100).toFixed(1)) : 0;
    }

    const assignDelta = Number((rightAssignPct - leftAssignPct).toFixed(1));
    const consDelta = Number((rightConsPct - leftConsPct).toFixed(1));
    const liveOrRecDelta = Number((rightLiveRecPct - leftLiveRecPct).toFixed(1));
    const liveDelta = Number((rightLivePct - leftLivePct).toFixed(1));

    const leftComposite = Number(((leftAssignPct + leftConsPct + leftLiveRecPct) / 3).toFixed(1));
    const rightComposite = Number(((rightAssignPct + rightConsPct + rightLiveRecPct) / 3).toFixed(1));
    const compositeChange = Number((rightComposite - leftComposite).toFixed(1));

    const movement = classifyMovement(compositeChange, tolerance);
    const status: 'Improved' | 'Same' | 'Declined' =
      movement === 'IMPROVED' ? 'Improved' : movement === 'DECLINED' ? 'Declined' : 'Same';

    const isFirstTimeSubmitter =
      leftS.assignmentsSubmitted === 0 && rightS.assignmentsSubmitted > 0;
    if (isFirstTimeSubmitter) {
      firstTimeSubmitters.push({
        studentId: leftS.studentId,
        name: leftS.name,
        phoneE164: leftS.phoneE164,
      });
    }

    const isStoppedAttending = leftS.liveAttended > 0 && rightS.liveAttended === 0;
    if (isStoppedAttending) {
      stoppedAttending.push({
        studentId: leftS.studentId,
        name: leftS.name,
        phoneE164: leftS.phoneE164,
      });
    }

    learnerComparisons.push({
      studentId: leftS.studentId,
      externalStudentId: leftS.externalStudentId,
      name: leftS.name,
      phoneE164: leftS.phoneE164,
      leftSegment: leftS.segment,
      rightSegment: rightS.segment,
      leftComposite,
      rightComposite,
      compositeChange,
      status,
      assignmentDelta: assignDelta,
      contentDelta: consDelta,
      liveOrRecDelta,
      isFirstTimeSubmitter,
      isStoppedAttending,
      leftMetrics: {
        totalConsumption: leftConsPct,
        assignmentSubmission: leftAssignPct,
        liveAttendance: leftLivePct,
        liveOrRecAttendance: leftLiveRecPct,
        video: Number(leftS.videoPct),
        pdf: Number(leftS.pdfPct),
        quiz: Number(leftS.quizPct),
        aiContent: Number(leftS.aiContentPct),
        assignmentScore: Number(leftS.assignmentScorePct),
        flashcards: Number(leftS.flashcardsPct),
      },
      rightMetrics: {
        totalConsumption: rightConsPct,
        assignmentSubmission: rightAssignPct,
        liveAttendance: rightLivePct,
        liveOrRecAttendance: rightLiveRecPct,
        video: Number(rightS.videoPct),
        pdf: Number(rightS.pdfPct),
        quiz: Number(rightS.quizPct),
        aiContent: Number(rightS.aiContentPct),
        assignmentScore: Number(rightS.assignmentScorePct),
        flashcards: Number(rightS.flashcardsPct),
      },
    });
  }

  // Top 5 improvers & decliners
  const topImprovers = [...learnerComparisons]
    .sort((a, b) => b.compositeChange - a.compositeChange)
    .slice(0, 5)
    .map((l) => ({
      studentId: l.studentId,
      name: l.name,
      phoneE164: l.phoneE164,
      deltaPts: l.compositeChange,
      segment: l.rightSegment,
    }));

  const topDecliners = [...learnerComparisons]
    .sort((a, b) => a.compositeChange - b.compositeChange)
    .slice(0, 5)
    .map((l) => ({
      studentId: l.studentId,
      name: l.name,
      phoneE164: l.phoneE164,
      deltaPts: l.compositeChange,
      segment: l.rightSegment,
    }));

  // 6. 3x3 Segment Movement Matrix
  const segmentOrder = ['high', 'medium', 'low'];
  const matrix: Record<string, Record<string, number>> = {
    high: { high: 0, medium: 0, low: 0 },
    medium: { high: 0, medium: 0, low: 0 },
    low: { high: 0, medium: 0, low: 0 },
  };

  let movedUp = 0;
  let movedDown = 0;
  let unchanged = 0;

  for (const l of learnerComparisons) {
    const leftSeg = (l.leftSegment || 'medium').toLowerCase();
    const rightSeg = (l.rightSegment || 'medium').toLowerCase();
    if (matrix[leftSeg] && matrix[leftSeg][rightSeg] !== undefined) {
      matrix[leftSeg][rightSeg]++;
    }

    const rank = { high: 3, medium: 2, low: 1 };
    const rLeft = rank[leftSeg as keyof typeof rank] || 2;
    const rRight = rank[rightSeg as keyof typeof rank] || 2;

    if (rRight > rLeft) movedUp++;
    else if (rRight < rLeft) movedDown++;
    else unchanged++;
  }

  // 7. At-Risk Transitions
  const leftCandidates: AtRiskCandidate[] = leftStudentSnapshots.map((s) => ({
    studentId: s.studentId,
    externalStudentId: s.externalStudentId,
    name: s.name,
    phoneE164: s.phoneE164,
    assignmentSubmissionPct: Number(s.assignmentSubmissionPct),
    assignmentsSubmitted: s.assignmentsSubmitted,
    totalConsumptionPct: Number(s.totalConsumptionPct),
    livePct: Number(s.livePct),
    liveOrRecPct: Number(s.liveOrRecPct),
    segment: s.segment as SegmentType,
  }));

  const rightCandidates: AtRiskCandidate[] = rightStudentSnapshots.map((s) => ({
    studentId: s.studentId,
    externalStudentId: s.externalStudentId,
    name: s.name,
    phoneE164: s.phoneE164,
    assignmentSubmissionPct: Number(s.assignmentSubmissionPct),
    assignmentsSubmitted: s.assignmentsSubmitted,
    totalConsumptionPct: Number(s.totalConsumptionPct),
    livePct: Number(s.livePct),
    liveOrRecPct: Number(s.liveOrRecPct),
    segment: s.segment as SegmentType,
  }));

  const leftAtRisk = identifyAtRiskStudents(leftCandidates);
  const rightAtRisk = identifyAtRiskStudents(rightCandidates);

  const leftAtRiskMap = new Map(leftAtRisk.map((r) => [r.studentId, r]));
  const rightAtRiskMap = new Map(rightAtRisk.map((r) => [r.studentId, r]));

  const newlyAtRisk = rightAtRisk
    .filter((r) => !leftAtRiskMap.has(r.studentId))
    .map((r) => ({ studentId: r.studentId, name: r.name, phoneE164: r.phoneE164, reasons: r.reasons }));

  const recovered = leftAtRisk
    .filter((l) => !rightAtRiskMap.has(l.studentId))
    .map((l) => ({ studentId: l.studentId, name: l.name, phoneE164: l.phoneE164, reasons: l.reasons }));

  const stillAtRisk = rightAtRisk
    .filter((r) => leftAtRiskMap.has(r.studentId))
    .map((r) => ({ studentId: r.studentId, name: r.name, phoneE164: r.phoneE164, reasons: r.reasons }));

  const leftAttendsNoSubmit = leftStudentSnapshots.filter(
    (s) => Number(s.livePct) >= 50 && Number(s.assignmentSubmissionPct) < 50
  ).length;
  const rightAttendsNoSubmit = rightStudentSnapshots.filter(
    (s) => Number(s.livePct) >= 50 && Number(s.assignmentSubmissionPct) < 50
  ).length;

  const leftRecordingOnly = leftStudentSnapshots.filter(
    (s) => Number(s.livePct) === 0 && Number(s.liveOrRecPct) > 0
  ).length;
  const rightRecordingOnly = rightStudentSnapshots.filter(
    (s) => Number(s.livePct) === 0 && Number(s.liveOrRecPct) > 0
  ).length;

  // 8. Metric Aggregates
  const metricKeys = [
    { key: 'assignment', name: 'Assignment Submission' },
    { key: 'content', name: 'Content Consumption' },
    { key: 'attendance', name: 'Attendance (Live+Rec)' },
    { key: 'attendanceLive', name: 'Live Class Attendance' },
    { key: 'video', name: 'Video Consumption' },
    { key: 'pdf', name: 'PDF Consumption' },
    { key: 'quiz', name: 'Quiz Submission' },
    { key: 'aiContent', name: 'AI Content Attempt' },
    { key: 'assignmentScore', name: 'Assignment Score' },
    { key: 'flashcards', name: 'Flash Cards' },
  ];

  const getLearnerValues = (metricKey: string, side: 'left' | 'right'): number[] => {
    return learnerComparisons.map((l) => {
      const m = side === 'left' ? l.leftMetrics : l.rightMetrics;
      switch (metricKey) {
        case 'assignment':
          return m.assignmentSubmission;
        case 'content':
          return m.totalConsumption;
        case 'attendance':
          return m.liveOrRecAttendance;
        case 'attendanceLive':
          return m.liveAttendance;
        case 'video':
          return m.video;
        case 'pdf':
          return m.pdf;
        case 'quiz':
          return m.quiz;
        case 'aiContent':
          return m.aiContent;
        case 'assignmentScore':
          return m.assignmentScore;
        case 'flashcards':
          return m.flashcards;
        default:
          return 0;
      }
    });
  };

  const metrics: Record<string, MetricComparisonItem> = {};

  for (const m of metricKeys) {
    const leftVals = getLearnerValues(m.key, 'left');
    const rightVals = getLearnerValues(m.key, 'right');

    const leftAvg = computeAverage(leftVals);
    const rightAvg = computeAverage(rightVals);
    const deltaPts = Number((rightAvg - leftAvg).toFixed(1));

    const leftMedian = computeMedian(leftVals);
    const rightMedian = computeMedian(rightVals);

    const movement = classifyMovement(deltaPts, tolerance);
    const status: 'Improved' | 'Same' | 'Declined' =
      movement === 'IMPROVED' ? 'Improved' : movement === 'DECLINED' ? 'Declined' : 'Same';

    const arrow =
      deltaPts > 0 ? `+${deltaPts.toFixed(1)}% ↑` : deltaPts < 0 ? `${deltaPts.toFixed(1)}% ↓` : '0.0% →';

    metrics[m.key] = {
      leftValue: leftAvg,
      rightValue: rightAvg,
      deltaPts,
      status,
      arrow,
      leftAvg,
      rightAvg,
      leftMedian,
      rightMedian,
    };
  }

  // 9. Assignment Comparison
  const assignmentComparison: StrictCompareResult['assignmentComparison'] = [];
  const allItemNames = Array.from(
    new Set([
      ...leftAssignmentItems.map((i) => i.name),
      ...rightAssignmentItems.map((i) => i.name),
    ])
  );

  for (const rawName of allItemNames) {
    const norm = normalizeAssignmentName(rawName);
    const isNew = !leftItemNormSet.has(norm);

    const leftItem = leftAssignmentItems.find((i) => normalizeAssignmentName(i.name) === norm);
    const rightItem = rightAssignmentItems.find((i) => normalizeAssignmentName(i.name) === norm);

    const lResults = leftItem
      ? leftAssignmentResults.filter((r) => r.assignment_results.assignmentItemId === leftItem.id)
      : [];
    const rResults = rightItem
      ? rightAssignmentResults.filter((r) => r.assignment_results.assignmentItemId === rightItem.id)
      : [];

    const lPassed = lResults.filter((r) => r.assignment_results.status.toUpperCase() === 'PASSED').length;
    const lDelayed = lResults.filter((r) => r.assignment_results.status.toUpperCase() === 'DELAYED').length;
    const lNotSubmitted = lResults.filter(
      (r) => r.assignment_results.status.toUpperCase() === 'NOT_SUBMITTED'
    ).length;
    const lScores = lResults
      .map((r) => (r.assignment_results.score !== null ? Number(r.assignment_results.score) : null))
      .filter((s): s is number => s !== null && !isNaN(s));
    const lAvgScore = lScores.length > 0 ? computeAverage(lScores) : null;
    const lSubmitted = lPassed + lDelayed;
    const lRate = lResults.length > 0 ? Number(((lSubmitted / lResults.length) * 100).toFixed(1)) : null;

    const rPassed = rResults.filter((r) => r.assignment_results.status.toUpperCase() === 'PASSED').length;
    const rDelayed = rResults.filter((r) => r.assignment_results.status.toUpperCase() === 'DELAYED').length;
    const rNotSubmitted = rResults.filter(
      (r) => r.assignment_results.status.toUpperCase() === 'NOT_SUBMITTED'
    ).length;
    const rScores = rResults
      .map((r) => (r.assignment_results.score !== null ? Number(r.assignment_results.score) : null))
      .filter((s): s is number => s !== null && !isNaN(s));
    const rAvgScore = rScores.length > 0 ? computeAverage(rScores) : null;
    const rSubmitted = rPassed + rDelayed;
    const rRate = rResults.length > 0 ? Number(((rSubmitted / rResults.length) * 100).toFixed(1)) : 0;

    const deltaPts = lRate !== null ? Number((rRate - lRate).toFixed(1)) : null;

    assignmentComparison.push({
      name: rawName,
      status: isNew ? 'NEW' : 'SAME',
      isNew,
      leftSubmissionRate: lRate,
      rightSubmissionRate: rRate,
      deltaPts,
      leftPassed: lPassed,
      rightPassed: rPassed,
      leftDelayed: lDelayed,
      rightDelayed: rDelayed,
      leftNotSubmitted: lNotSubmitted,
      rightNotSubmitted: rNotSubmitted,
      leftAvgScore: lAvgScore,
      rightAvgScore: rAvgScore,
    });
  }

  // 10. Content Comparison
  const contentComparison: StrictCompareResult['contentComparison'] = [];
  const allWeeks = Array.from(
    new Set([...leftWeeks.map((w) => w.weekNo), ...rightWeeks.map((w) => w.weekNo)])
  ).sort((a, b) => a - b);

  for (const wNo of allWeeks) {
    const isNew = !leftWeekSet.has(wNo);

    const lRows = leftWeeks.filter((w) => w.weekNo === wNo);
    const rRows = rightWeeks.filter((w) => w.weekNo === wNo);

    const lConsumed = lRows.reduce((acc, curr) => acc + curr.consumed, 0);
    const lTotal = lRows.reduce((acc, curr) => acc + curr.total, 0);
    const lPct = lTotal > 0 ? Number(((lConsumed / lTotal) * 100).toFixed(1)) : null;

    const rConsumed = rRows.reduce((acc, curr) => acc + curr.consumed, 0);
    const rTotal = rRows.reduce((acc, curr) => acc + curr.total, 0);
    const rPct = rTotal > 0 ? Number(((rConsumed / rTotal) * 100).toFixed(1)) : 0;

    const deltaPts = lPct !== null ? Number((rPct - lPct).toFixed(1)) : null;

    contentComparison.push({
      weekNo: wNo,
      isNew,
      status: isNew ? 'NEW' : 'SAME',
      leftConsumedPct: lPct,
      rightConsumedPct: rPct,
      deltaPts,
    });
  }

  // 11. Session Comparison
  const sessionComparison: StrictCompareResult['sessionComparison'] = [];
  const allSessionTitles = Array.from(
    new Set([...leftSessions.map((s) => s.title), ...rightSessions.map((s) => s.title)])
  );

  for (const sTitle of allSessionTitles) {
    const norm = normalizeSessionTitleWithoutDate(sTitle);
    const isNew = !leftSessionNormSet.has(norm);

    const lSess = leftSessions.find((s) => normalizeSessionTitleWithoutDate(s.title) === norm);
    const rSess = rightSessions.find((s) => normalizeSessionTitleWithoutDate(s.title) === norm);

    const sessionDate = rSess?.sessionDate || lSess?.sessionDate || null;

    const lAtt = lSess ? leftAttendance.filter((a) => a.attendance.sessionId === lSess.id) : [];
    const rAtt = rSess ? rightAttendance.filter((a) => a.attendance.sessionId === rSess.id) : [];

    const lLive = lAtt.filter((a) => a.attendance.liveStatus.toUpperCase() === 'PRESENT').length;
    const lLiveRec = lAtt.filter(
      (a) =>
        a.attendance.liveOrRecStatus.toUpperCase() === 'PRESENT' ||
        a.attendance.liveOrRecStatus.toUpperCase() === 'PARTIAL'
    ).length;
    const lLiveRate = lAtt.length > 0 ? Number(((lLive / lAtt.length) * 100).toFixed(1)) : null;
    const lLiveRecRate = lAtt.length > 0 ? Number(((lLiveRec / lAtt.length) * 100).toFixed(1)) : null;

    const rLive = rAtt.filter((a) => a.attendance.liveStatus.toUpperCase() === 'PRESENT').length;
    const rLiveRec = rAtt.filter(
      (a) =>
        a.attendance.liveOrRecStatus.toUpperCase() === 'PRESENT' ||
        a.attendance.liveOrRecStatus.toUpperCase() === 'PARTIAL'
    ).length;
    const rLiveRate = rAtt.length > 0 ? Number(((rLive / rAtt.length) * 100).toFixed(1)) : 0;
    const rLiveRecRate = rAtt.length > 0 ? Number(((rLiveRec / rAtt.length) * 100).toFixed(1)) : 0;

    const liveDeltaPts = lLiveRate !== null ? Number((rLiveRate - lLiveRate).toFixed(1)) : null;
    const liveRecDeltaPts = lLiveRecRate !== null ? Number((rLiveRecRate - lLiveRecRate).toFixed(1)) : null;

    sessionComparison.push({
      title: sTitle,
      date: sessionDate,
      isNew,
      status: isNew ? 'NEW' : 'SAME',
      leftLiveRate: lLiveRate,
      rightLiveRate: rLiveRate,
      leftLiveRecRate: lLiveRecRate,
      rightLiveRecRate: rLiveRecRate,
      liveDeltaPts,
      liveRecDeltaPts,
    });
  }

  // 12. Deterministic Plain-Language Insights (up to 4 sentences, no AI call)
  const positives: string[] = [];
  const concerns: string[] = [];

  const assignDelta = metrics.assignment.deltaPts;
  if (assignDelta >= tolerance) {
    positives.push(
      `Assignment submission rose ${assignDelta.toFixed(1)} pts (${metrics.assignment.leftValue.toFixed(
        1
      )}% to ${metrics.assignment.rightValue.toFixed(1)}%).`
    );
  } else if (assignDelta <= -tolerance) {
    concerns.push(
      `Assignment submission declined ${Math.abs(assignDelta).toFixed(1)} pts (${metrics.assignment.leftValue.toFixed(
        1
      )}% to ${metrics.assignment.rightValue.toFixed(1)}%).`
    );
  }

  const contentDelta = metrics.content.deltaPts;
  if (contentDelta >= tolerance) {
    positives.push(
      `Content consumption rose ${contentDelta.toFixed(1)} pts (${metrics.content.leftValue.toFixed(
        1
      )}% to ${metrics.content.rightValue.toFixed(1)}%).`
    );
  } else if (contentDelta <= -tolerance) {
    concerns.push(
      `Content consumption declined ${Math.abs(contentDelta).toFixed(1)} pts (${metrics.content.leftValue.toFixed(
        1
      )}% to ${metrics.content.rightValue.toFixed(1)}%).`
    );
  }

  if (firstTimeSubmitters.length > 0) {
    positives.push(
      `${firstTimeSubmitters.length} learner(s) submitted an assignment for the first time.`
    );
  }
  if (recovered.length > 0) {
    positives.push(`${recovered.length} learner(s) recovered from at-risk status.`);
  }

  if (newlyAtRisk.length > 0) {
    concerns.push(`${newlyAtRisk.length} learner(s) are newly at risk of falling behind.`);
  }
  if (stoppedAttending.length > 0) {
    concerns.push(`${stoppedAttending.length} learner(s) stopped attending live classes.`);
  }

  // Days gap
  const dLeft = new Date(leftSnap.snapshotDate);
  const dRight = new Date(rightSnap.snapshotDate);
  const daysGap = Math.max(0, Math.round((dRight.getTime() - dLeft.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    isComparable: true,
    checks: compatibility.checks,
    batchId: batch.id,
    batchName: batch.name,
    batchKey: leftFp?.batchKey,
    fromSnapshotId: leftSnap.id,
    toSnapshotId: rightSnap.id,
    fromSnapshotDate: leftSnap.snapshotDate,
    toSnapshotDate: rightSnap.snapshotDate,
    daysGap,
    sameItemsOnly: sameItems,
    fairComparisonNote,
    metrics,
    headlineMetrics: ['assignment', 'content', 'attendance'],
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
        leftAttendsNoSubmit,
        rightAttendsNoSubmit,
        leftRecordingOnly,
        rightRecordingOnly,
      },
    },
    assignmentComparison,
    contentComparison,
    sessionComparison,
    insights: {
      positives: positives.slice(0, 2),
      concerns: concerns.slice(0, 2),
    },
  };
}
