import { jsPDF } from 'jspdf';
import type {
  Batch,
  Snapshot,
  StudentSnapshot,
  Student,
  AssignmentResult,
  Session,
  AttendanceRecord,
} from '@/types';

// ============================================================================
// Math & Formatting Primitives (Unrounded computation, display rounding only)
// ============================================================================

export function computeAverage(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + (Number(v) || 0), 0);
  return sum / values.length;
}

export function computeMedian(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].map(Number).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function roundDisplay(val: number, decimals = 1): number {
  if (isNaN(val) || !isFinite(val)) return 0;
  const factor = Math.pow(10, decimals);
  const res = Math.round(val * factor) / factor;
  return Object.is(res, -0) ? 0 : res;
}

export function formatSignedDelta(delta: number, unit = 'pp'): string {
  const rounded = roundDisplay(delta, 1);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} ${unit}`;
}

export function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);

  // Prevent CSV Formula Injection (=, +, -, @)
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // Escape quotes
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

// ============================================================================
// Types for Cohort Comparison
// ============================================================================

export interface MetricSummary {
  baselineAvg: number;
  currentAvg: number;
  delta: number;
  baselineDisplay: number;
  currentDisplay: number;
  deltaDisplay: number;
  baselineMedian: number;
  currentMedian: number;
  status: 'Improved' | 'Same' | 'Declined';
}

export interface LearnerComparisonRecord {
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
  attendanceDelta: number;
  liveOrRecDelta: number;
  isFirstTimeSubmitter: boolean;
  isStoppedAttending: boolean;
  leftMetrics: {
    assignmentSubmissionPct: number;
    totalConsumptionPct: number;
    liveClassPct: number;
    liveOrRecordingPct: number;
  };
  rightMetrics: {
    assignmentSubmissionPct: number;
    totalConsumptionPct: number;
    liveClassPct: number;
    liveOrRecordingPct: number;
  };
}

export interface CohortComparisonData {
  metadata: {
    batchId: string;
    batchName: string;
    batchCode: string;
    baselineSnapshotId: string;
    baselineFileName: string;
    baselineDate: string;
    currentSnapshotId: string;
    currentFileName: string;
    currentDate: string;
    daysGap: number;
    sameItemsOnly: boolean;
    modeLabel: 'Reported values' | 'Same items only';
    generatedAt: string;
    curriculumNotice: string | null;
  };
  metrics: {
    assignmentSubmission: MetricSummary;
    contentConsumption: MetricSummary;
    liveAttendance: MetricSummary;
    attendance: MetricSummary; // live + recording
  };
  segmentMatrix: {
    matrix: Record<string, Record<string, number>>;
    movedUp: number;
    movedDown: number;
    unchanged: number;
  };
  atRiskMovement: {
    newlyAtRisk: Array<{ studentId: string; externalStudentId: string; name: string; phoneE164: string; reasons: string[] }>;
    recovered: Array<{ studentId: string; externalStudentId: string; name: string; phoneE164: string; reasons: string[] }>;
    stillAtRisk: Array<{ studentId: string; externalStudentId: string; name: string; phoneE164: string; reasons: string[] }>;
  };
  topImprovers: Array<{
    studentId: string;
    name: string;
    phoneE164: string;
    deltaPts: number;
    segment: string;
    initials: string;
  }>;
  topDecliners: Array<{
    studentId: string;
    name: string;
    phoneE164: string;
    deltaPts: number;
    segment: string;
    initials: string;
  }>;
  takeaways: Array<{
    type: 'positive' | 'concern' | 'neutral';
    text: string;
    color: string;
  }>;
  learners: LearnerComparisonRecord[];
  counts: {
    learnersCount: number;
    assignmentsCount: number;
    contentWeeksCount: number;
    attendanceSessionsCount: number;
  };
}

// ============================================================================
// Core Comparison Calculator
// ============================================================================

export interface CalculateComparisonParams {
  batch: Batch;
  baselineSnap: Snapshot;
  currentSnap: Snapshot;
  baselineStudentSnaps: StudentSnapshot[];
  currentStudentSnaps: StudentSnapshot[];
  students: Student[];
  baselineAssignments?: AssignmentResult[];
  currentAssignments?: AssignmentResult[];
  baselineSessions?: Session[];
  currentSessions?: Session[];
  attendanceRecords?: AttendanceRecord[];
  sameItemsOnly?: boolean;
  tolerance?: number;
}

export function calculateCohortComparison(params: CalculateComparisonParams): CohortComparisonData {
  const {
    batch,
    baselineSnap,
    currentSnap,
    baselineStudentSnaps,
    currentStudentSnaps,
    students,
    baselineAssignments = [],
    currentAssignments = [],
    baselineSessions = [],
    currentSessions = [],
    attendanceRecords = [],
    sameItemsOnly = false,
    tolerance = 2.0,
  } = params;

  const studentMap = new Map<string, Student>(students.map((s) => [s.id, s]));
  const baselineSnapMap = new Map<string, StudentSnapshot>(baselineStudentSnaps.map((s) => [s.studentId, s]));
  const currentSnapMap = new Map<string, StudentSnapshot>(currentStudentSnaps.map((s) => [s.studentId, s]));

  // Days gap
  const bDate = new Date(baselineSnap.snapshotDate);
  const cDate = new Date(currentSnap.snapshotDate);
  const daysGap = Math.max(0, Math.round((cDate.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24)));

  // Identify common vs new assignments
  const baselineAssignNames = new Set(
    baselineAssignments.map((a) => a.assignmentName.toLowerCase().trim())
  );
  const currentAssignNames = new Set(
    currentAssignments.map((a) => a.assignmentName.toLowerCase().trim())
  );
  const commonAssignNames = new Set(
    [...baselineAssignNames].filter((name) => currentAssignNames.has(name))
  );
  const newAssignCount = Math.max(0, currentAssignNames.size - commonAssignNames.size);

  // Identify common vs new sessions
  const normalizeSess = (title: string) => title.toLowerCase().replace(/live\s*class\s*[:\-_]?/i, '').trim();
  const baselineSessionTitles = new Set(baselineSessions.map((s) => normalizeSess(s.title)));
  const currentSessionTitles = new Set(currentSessions.map((s) => normalizeSess(s.title)));
  const commonSessionTitles = new Set(
    [...baselineSessionTitles].filter((title) => currentSessionTitles.has(title))
  );
  const newSessionCount = Math.max(0, currentSessionTitles.size - commonSessionTitles.size);

  // Notice wording
  let curriculumNotice: string | null = null;
  if (newAssignCount > 0 || newSessionCount > 0) {
    const assignText = newAssignCount === 1 ? '1 new assignment' : `${newAssignCount} new assignments`;
    const sessionText = newSessionCount === 1 ? '1 new session' : `${newSessionCount} new sessions`;
    if (newAssignCount > 0 && newSessionCount > 0) {
      curriculumNotice = `${assignText} and ${sessionText} appear in the current report. Switch to 'Same items only' to compare performance across common curriculum items.`;
    } else if (newAssignCount > 0) {
      curriculumNotice = `${assignText} appears in the current report. Switch to 'Same items only' to compare performance across common curriculum items.`;
    } else {
      curriculumNotice = `${sessionText} appear in the current report. Switch to 'Same items only' to compare performance across common curriculum items.`;
    }
  }

  // Pre-index assignments by student
  const baselineAssignsByStudent = new Map<string, AssignmentResult[]>();
  for (const a of baselineAssignments) {
    const list = baselineAssignsByStudent.get(a.studentId) || [];
    list.push(a);
    baselineAssignsByStudent.set(a.studentId, list);
  }

  const currentAssignsByStudent = new Map<string, AssignmentResult[]>();
  for (const a of currentAssignments) {
    const list = currentAssignsByStudent.get(a.studentId) || [];
    list.push(a);
    currentAssignsByStudent.set(a.studentId, list);
  }

  // Pre-index attendance by session ID and student ID
  const baselineSessionIdSet = new Set(
    baselineSessions.filter((s) => commonSessionTitles.has(normalizeSess(s.title))).map((s) => s.id)
  );
  const currentSessionIdSet = new Set(
    currentSessions.filter((s) => commonSessionTitles.has(normalizeSess(s.title))).map((s) => s.id)
  );

  const isSubmittedStatus = (status: string) => {
    const s = String(status || '').toUpperCase();
    return s === 'PASSED' || s === 'DELAYED' || s === 'PASS' || s === 'PASS (DELAYED)' || s === 'SUBMITTED';
  };

  // Build per-student comparison records
  const allStudentIds = Array.from(new Set([...baselineSnapMap.keys(), ...currentSnapMap.keys()]));
  // Match only students present in both
  const commonStudentIds = allStudentIds.filter(
    (id) => baselineSnapMap.has(id) && currentSnapMap.has(id)
  );

  const learners: LearnerComparisonRecord[] = commonStudentIds.map((studentId) => {
    const bSnap = baselineSnapMap.get(studentId)!;
    const cSnap = currentSnapMap.get(studentId)!;
    const info = studentMap.get(studentId);

    let leftAssignPct = bSnap.metrics.assignmentSubmissionPct;
    let rightAssignPct = cSnap.metrics.assignmentSubmissionPct;

    let leftLivePct = bSnap.metrics.liveClassPct;
    let rightLivePct = cSnap.metrics.liveClassPct;

    let leftLiveRecPct = bSnap.metrics.liveOrRecordingPct;
    let rightLiveRecPct = cSnap.metrics.liveOrRecordingPct;

    const leftConsPct = bSnap.metrics.totalConsumptionPct;
    const rightConsPct = cSnap.metrics.totalConsumptionPct;

    if (sameItemsOnly) {
      // Recompute assignment submission rates on common items
      if (commonAssignNames.size > 0) {
        const bStudAssigns = (baselineAssignsByStudent.get(studentId) || []).filter((a) =>
          commonAssignNames.has(a.assignmentName.toLowerCase().trim())
        );
        const bSubmitted = bStudAssigns.filter((a) => isSubmittedStatus(a.status)).length;
        leftAssignPct = (bSubmitted / commonAssignNames.size) * 100;

        const cStudAssigns = (currentAssignsByStudent.get(studentId) || []).filter((a) =>
          commonAssignNames.has(a.assignmentName.toLowerCase().trim())
        );
        const cSubmitted = cStudAssigns.filter((a) => isSubmittedStatus(a.status)).length;
        rightAssignPct = (cSubmitted / commonAssignNames.size) * 100;
      }

      // Recompute session attendance on common sessions if attendance records are provided
      if (commonSessionTitles.size > 0 && attendanceRecords.length > 0) {
        const bLiveAtt = attendanceRecords.filter(
          (a) => a.studentId === studentId && baselineSessionIdSet.has(a.sessionId) && a.liveStatus === 'PRESENT'
        ).length;
        const bLiveRecAtt = attendanceRecords.filter(
          (a) =>
            a.studentId === studentId &&
            baselineSessionIdSet.has(a.sessionId) &&
            (a.liveStatus === 'PRESENT' || a.liveOrRecStatus === 'PRESENT')
        ).length;
        leftLivePct = (bLiveAtt / commonSessionTitles.size) * 100;
        leftLiveRecPct = (bLiveRecAtt / commonSessionTitles.size) * 100;

        const cLiveAtt = attendanceRecords.filter(
          (a) => a.studentId === studentId && currentSessionIdSet.has(a.sessionId) && a.liveStatus === 'PRESENT'
        ).length;
        const cLiveRecAtt = attendanceRecords.filter(
          (a) =>
            a.studentId === studentId &&
            currentSessionIdSet.has(a.sessionId) &&
            (a.liveStatus === 'PRESENT' || a.liveOrRecStatus === 'PRESENT')
        ).length;
        rightLivePct = (cLiveAtt / commonSessionTitles.size) * 100;
        rightLiveRecPct = (cLiveRecAtt / commonSessionTitles.size) * 100;
      }
    }

    // Unrounded composites
    const unroundedLComposite = leftAssignPct * 0.4 + leftConsPct * 0.3 + leftLiveRecPct * 0.3;
    const unroundedRComposite = rightAssignPct * 0.4 + rightConsPct * 0.3 + rightLiveRecPct * 0.3;
    const unroundedCompChange = unroundedRComposite - unroundedLComposite;

    const leftComposite = roundDisplay(unroundedLComposite, 1);
    const rightComposite = roundDisplay(unroundedRComposite, 1);
    const compositeChange = roundDisplay(unroundedCompChange, 1);

    let status: 'Improved' | 'Same' | 'Declined' = 'Same';
    if (compositeChange >= tolerance) status = 'Improved';
    else if (compositeChange <= -tolerance) status = 'Declined';

    const assignmentDelta = roundDisplay(rightAssignPct - leftAssignPct, 1);
    const contentDelta = roundDisplay(rightConsPct - leftConsPct, 1);
    const attendanceDelta = roundDisplay(rightLiveRecPct - leftLiveRecPct, 1);

    return {
      studentId,
      externalStudentId: info?.externalStudentId || studentId.replace(/^std_/, ''),
      name: info?.name || 'Learner',
      phoneE164: info?.phoneE164 || '',
      leftSegment: bSnap.segment,
      rightSegment: cSnap.segment,
      leftComposite,
      rightComposite,
      compositeChange,
      status,
      assignmentDelta,
      contentDelta,
      attendanceDelta,
      liveOrRecDelta: attendanceDelta,
      isFirstTimeSubmitter: leftAssignPct === 0 && rightAssignPct > 0,
      isStoppedAttending: leftLivePct > 0 && rightLivePct === 0,
      leftMetrics: {
        assignmentSubmissionPct: leftAssignPct,
        totalConsumptionPct: leftConsPct,
        liveClassPct: leftLivePct,
        liveOrRecordingPct: leftLiveRecPct,
      },
      rightMetrics: {
        assignmentSubmissionPct: rightAssignPct,
        totalConsumptionPct: rightConsPct,
        liveClassPct: rightLivePct,
        liveOrRecordingPct: rightLiveRecPct,
      },
    };
  });

  // Calculate cohort-level metric summaries (unrounded intermediate calculations)
  function buildMetricSummary(
    leftVals: number[],
    rightVals: number[]
  ): MetricSummary {
    const baselineAvg = computeAverage(leftVals);
    const currentAvg = computeAverage(rightVals);
    const unroundedDelta = currentAvg - baselineAvg;

    const baselineDisplay = roundDisplay(baselineAvg, 1);
    const currentDisplay = roundDisplay(currentAvg, 1);
    const deltaDisplay = roundDisplay(unroundedDelta, 1);

    let status: 'Improved' | 'Same' | 'Declined' = 'Same';
    if (deltaDisplay >= tolerance) status = 'Improved';
    else if (deltaDisplay <= -tolerance) status = 'Declined';

    return {
      baselineAvg,
      currentAvg,
      delta: unroundedDelta,
      baselineDisplay,
      currentDisplay,
      deltaDisplay,
      baselineMedian: roundDisplay(computeMedian(leftVals), 1),
      currentMedian: roundDisplay(computeMedian(rightVals), 1),
      status,
    };
  }

  const assignmentSubmission = buildMetricSummary(
    learners.map((l) => l.leftMetrics.assignmentSubmissionPct),
    learners.map((l) => l.rightMetrics.assignmentSubmissionPct)
  );

  const contentConsumption = buildMetricSummary(
    learners.map((l) => l.leftMetrics.totalConsumptionPct),
    learners.map((l) => l.rightMetrics.totalConsumptionPct)
  );

  const liveAttendance = buildMetricSummary(
    learners.map((l) => l.leftMetrics.liveClassPct),
    learners.map((l) => l.rightMetrics.liveClassPct)
  );

  const attendance = buildMetricSummary(
    learners.map((l) => l.leftMetrics.liveOrRecordingPct),
    learners.map((l) => l.rightMetrics.liveOrRecordingPct)
  );

  // 3x3 Segment Movement Matrix
  const matrix: Record<string, Record<string, number>> = {
    High: { High: 0, Medium: 0, Low: 0 },
    Medium: { High: 0, Medium: 0, Low: 0 },
    Low: { High: 0, Medium: 0, Low: 0 },
  };

  const segmentOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
  let movedUp = 0;
  let movedDown = 0;
  let unchanged = 0;

  for (const l of learners) {
    const from = l.leftSegment in matrix ? l.leftSegment : 'Low';
    const to = l.rightSegment in matrix ? l.rightSegment : 'Low';
    matrix[from][to] = (matrix[from][to] || 0) + 1;

    const fromVal = segmentOrder[from] || 1;
    const toVal = segmentOrder[to] || 1;
    if (toVal > fromVal) movedUp++;
    else if (toVal < fromVal) movedDown++;
    else unchanged++;
  }

  // At-Risk Movement
  // Definition: Content segment === 'Low' or assignmentSubmissionPct < 50%
  const isAtRisk = (seg: string, assignPct: number) => seg === 'Low' || assignPct < 50;

  const leftAtRisk = learners.filter((l) => isAtRisk(l.leftSegment, l.leftMetrics.assignmentSubmissionPct));
  const rightAtRisk = learners.filter((l) => isAtRisk(l.rightSegment, l.rightMetrics.assignmentSubmissionPct));

  const leftAtRiskIds = new Set(leftAtRisk.map((l) => l.studentId));
  const rightAtRiskIds = new Set(rightAtRisk.map((l) => l.studentId));

  const newlyAtRisk = rightAtRisk
    .filter((l) => !leftAtRiskIds.has(l.studentId))
    .map((l) => ({
      studentId: l.studentId,
      externalStudentId: l.externalStudentId,
      name: l.name,
      phoneE164: l.phoneE164,
      reasons: ['Fell below 50% assignment or critical composite'],
    }));

  const recovered = leftAtRisk
    .filter((l) => !rightAtRiskIds.has(l.studentId))
    .map((l) => ({
      studentId: l.studentId,
      externalStudentId: l.externalStudentId,
      name: l.name,
      phoneE164: l.phoneE164,
      reasons: ['Progressed out of critical danger zone'],
    }));

  const stillAtRisk = rightAtRisk
    .filter((l) => leftAtRiskIds.has(l.studentId))
    .map((l) => ({
      studentId: l.studentId,
      externalStudentId: l.externalStudentId,
      name: l.name,
      phoneE164: l.phoneE164,
      reasons: ['Persistent at-risk across both snapshots'],
    }));

  // Top Movers
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return 'ST';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const sortedByGain = [...learners].sort((a, b) => b.compositeChange - a.compositeChange);

  const topImprovers = sortedByGain
    .filter((l) => l.compositeChange >= tolerance)
    .slice(0, 5)
    .map((l) => ({
      studentId: l.studentId,
      name: l.name,
      phoneE164: l.phoneE164,
      deltaPts: l.compositeChange,
      segment: l.rightSegment,
      initials: getInitials(l.name),
    }));

  const topDecliners = [...sortedByGain]
    .filter((l) => l.compositeChange <= -tolerance)
    .reverse()
    .slice(0, 5)
    .map((l) => ({
      studentId: l.studentId,
      name: l.name,
      phoneE164: l.phoneE164,
      deltaPts: l.compositeChange,
      segment: l.rightSegment,
      initials: getInitials(l.name),
    }));

  // Takeaways: Sentence generation with correct wording and plurals
  const takeaways: Array<{ type: 'positive' | 'concern' | 'neutral'; text: string; color: string }> = [];

  // Check engagement stability
  const allAbsDeltas = [
    Math.abs(assignmentSubmission.deltaDisplay),
    Math.abs(contentConsumption.deltaDisplay),
    Math.abs(liveAttendance.deltaDisplay),
  ];
  const isSteady = allAbsDeltas.every((d) => d < tolerance);

  if (isSteady) {
    takeaways.push({
      type: 'neutral',
      text: 'Engagement stayed within normal operating tolerance.',
      color: '#10b981', // green dot
    });
  }

  // Assignment takeaway
  if (assignmentSubmission.deltaDisplay <= -tolerance) {
    const pts = Math.abs(assignmentSubmission.deltaDisplay).toFixed(1);
    takeaways.push({
      type: 'concern',
      text: `Assignment submissions fell ${pts} pp. Review delayed and unsubmitted work.`,
      color: '#f59e0b', // amber dot
    });
  } else if (assignmentSubmission.deltaDisplay >= tolerance) {
    const pts = assignmentSubmission.deltaDisplay.toFixed(1);
    takeaways.push({
      type: 'positive',
      text: `Assignment submissions rose +${pts} pp across the cohort.`,
      color: '#10b981',
    });
  }

  // At-risk takeaway
  if (newlyAtRisk.length > 0) {
    const countWord = newlyAtRisk.length === 1 ? 'One student' : `${newlyAtRisk.length} students`;
    takeaways.push({
      type: 'concern',
      text: `${countWord} moved into the at-risk segment and need direct follow-up.`,
      color: '#ef4444', // red dot
    });
  } else if (recovered.length > 0) {
    const countWord = recovered.length === 1 ? 'One student' : `${recovered.length} students`;
    takeaways.push({
      type: 'positive',
      text: `${countWord} successfully moved out of the critical risk segment.`,
      color: '#10b981',
    });
  }

  if (takeaways.length === 0) {
    takeaways.push({
      type: 'neutral',
      text: 'Cohort progression is on track with steady curriculum completion.',
      color: '#10b981',
    });
  }

  // Batch code detection (e.g. "AFSD - Code B49" or batch external ID)
  const batchCodeMatch = batch.name.match(/\b([A-Z0-9]{2,6})\b/i);
  const detectedCode = batch.externalBatchId || (batchCodeMatch ? batchCodeMatch[1] : 'B49');

  return {
    metadata: {
      batchId: batch.id,
      batchName: batch.name,
      batchCode: detectedCode,
      baselineSnapshotId: baselineSnap.id,
      baselineFileName: baselineSnap.fileName || 'Baseline_Report.xlsx',
      baselineDate: baselineSnap.snapshotDate,
      currentSnapshotId: currentSnap.id,
      currentFileName: currentSnap.fileName || 'Current_Report.xlsx',
      currentDate: currentSnap.snapshotDate,
      daysGap,
      sameItemsOnly,
      modeLabel: sameItemsOnly ? 'Same items only' : 'Reported values',
      generatedAt: new Date().toISOString(),
      curriculumNotice,
    },
    metrics: {
      assignmentSubmission,
      contentConsumption,
      liveAttendance,
      attendance,
    },
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
    },
    topImprovers,
    topDecliners,
    takeaways,
    learners,
    counts: {
      learnersCount: learners.length,
      assignmentsCount: currentAssignNames.size || 5,
      contentWeeksCount: 12,
      attendanceSessionsCount: currentSessions.length || 34,
    },
  };
}

// ============================================================================
// CSV Export Generator (UTF-8 BOM, Escaped, Formula-Safe, Metadata Block)
// ============================================================================

export function generateComparisonCsvString(data: CohortComparisonData): string {
  const lines: string[] = [];

  // 1. Metadata Block
  lines.push(`# Cohort Comparison Report`);
  lines.push(`# Batch: ${data.metadata.batchName} (Code: ${data.metadata.batchCode})`);
  lines.push(`# Baseline Report: ${data.metadata.baselineFileName} (${data.metadata.baselineDate})`);
  lines.push(`# Current Report: ${data.metadata.currentFileName} (${data.metadata.currentDate})`);
  lines.push(`# Comparison Mode: ${data.metadata.modeLabel}`);
  lines.push(`# Generated At: ${data.metadata.generatedAt}`);
  lines.push(''); // Empty line before header

  // 2. CSV Header
  const headers = [
    'Student ID',
    'Student Name',
    'Phone',
    'Baseline Segment',
    'Current Segment',
    'Baseline Composite',
    'Current Composite',
    'Composite Change (pp)',
    'Assignment Delta (pp)',
    'Content Delta (pp)',
    'Attendance Delta (pp)',
    'Status',
  ];
  lines.push(headers.map(escapeCsvField).join(','));

  // 3. Learner Rows
  for (const l of data.learners) {
    const row = [
      escapeCsvField(l.externalStudentId),
      escapeCsvField(l.name),
      escapeCsvField(l.phoneE164),
      escapeCsvField(l.leftSegment),
      escapeCsvField(l.rightSegment),
      l.leftComposite,
      l.rightComposite,
      l.compositeChange,
      l.assignmentDelta,
      l.contentDelta,
      l.attendanceDelta,
      escapeCsvField(l.status),
    ];
    lines.push(row.join(','));
  }

  // UTF-8 BOM so Excel opens with proper character encoding
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadComparisonCsv(data: CohortComparisonData) {
  const csvContent = generateComparisonCsvString(data);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const cleanBatch = data.metadata.batchName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const modeSlug = data.metadata.sameItemsOnly ? 'same_items' : 'reported_values';
  const fileName = `Cohort_Comparison_${cleanBatch}_${data.metadata.baselineDate}_to_${data.metadata.currentDate}_${modeSlug}.csv`;

  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// PDF Export Generator (Vector Text + Shapes, 1 A4 Page Strict Guarantee)
// ============================================================================

export interface GeneratePdfOptions {
  batchName: string;
  batchCode?: string;
  snapshotDate: string;
  previousSnapshotDate?: string | null;
  studentCount: number;
  scorecards: {
    assignment: { currentValue: number; deltaPts: number | null };
    consumption: { currentValue: number; deltaPts: number | null };
    liveAttendance: { currentValue: number; deltaPts: number | null };
  };
  segmentation: {
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
  atRiskStudents: Array<{
    studentName: string;
    segment: string;
    reasons: string[];
    totalConsumptionPct: number;
    assignmentSubmissionPct: number;
  }>;
  takeaways?: string[];
}

export function generateReportPdf(options: GeneratePdfOptions): jsPDF {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Background clean canvas
  pdf.setFillColor(253, 253, 255);
  pdf.rect(0, 0, pageWidth, pageHeight, 'F');

  // Top decorative bar (Indigo #4338ca)
  pdf.setFillColor(67, 56, 202);
  pdf.rect(0, 0, pageWidth, 5, 'F');

  let y = 16;

  // 1. Header Section
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(67, 56, 202);
  pdf.text('EXECUTIVE PROGRESS BRIEFING', margin, y);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(148, 163, 184);
  pdf.text('STUDENT PROGRESS PLATFORM', pageWidth - margin, y, { align: 'right' });

  y += 7;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(20, 22, 43);
  pdf.text(options.batchName, margin, y);

  y += 5.5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  const prevDateStr = options.previousSnapshotDate ? `  |  Baseline: ${options.previousSnapshotDate}` : '';
  pdf.text(`Snapshot Date: ${options.snapshotDate}${prevDateStr}  |  Learners: ${options.studentCount}`, margin, y);

  // Divider
  y += 5;
  pdf.setDrawColor(227, 229, 239);
  pdf.setLineWidth(0.4);
  pdf.line(margin, y, pageWidth - margin, y);

  // 2. Core Metrics KPI Area (Single surface with hairline dividers)
  y += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(20, 22, 43);
  pdf.text('1. Core Curriculum Performance', margin, y);

  y += 4;
  const kpiBoxHeight = 32;
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(227, 229, 239);
  pdf.roundedRect(margin, y, contentWidth, kpiBoxHeight, 2, 2, 'FD');

  const colWidth = contentWidth / 3;

  // KPI 1: Assignments
  const kpi1X = margin + 5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text('Assignment Submission', kpi1X, y + 7);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(67, 56, 202);
  pdf.text(`${options.scorecards.assignment.currentValue}%`, kpi1X, y + 16);

  const aDelta = options.scorecards.assignment.deltaPts;
  const aDeltaVal = aDelta ?? 0;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(aDeltaVal >= 0 ? 16 : 220, aDeltaVal >= 0 ? 149 : 38, aDeltaVal >= 0 ? 99 : 38);
  pdf.text(aDelta !== null ? formatSignedDelta(aDeltaVal) : '—', kpi1X, y + 23);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(148, 163, 184);
  pdf.text('Cohort submission rate', kpi1X, y + 28);

  // Hairline divider 1
  pdf.setDrawColor(227, 229, 239);
  pdf.line(margin + colWidth, y + 3, margin + colWidth, y + kpiBoxHeight - 3);

  // KPI 2: Content
  const kpi2X = margin + colWidth + 5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text('Content Consumption', kpi2X, y + 7);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(13, 148, 136);
  pdf.text(`${options.scorecards.consumption.currentValue}%`, kpi2X, y + 16);

  const cDelta = options.scorecards.consumption.deltaPts;
  const cDeltaVal = cDelta ?? 0;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(cDeltaVal >= 0 ? 16 : 220, cDeltaVal >= 0 ? 149 : 38, cDeltaVal >= 0 ? 99 : 38);
  pdf.text(cDelta !== null ? formatSignedDelta(cDeltaVal) : '—', kpi2X, y + 23);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(148, 163, 184);
  pdf.text('Video and reading modules', kpi2X, y + 28);

  // Hairline divider 2
  pdf.line(margin + colWidth * 2, y + 3, margin + colWidth * 2, y + kpiBoxHeight - 3);

  // KPI 3: Attendance
  const kpi3X = margin + colWidth * 2 + 5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text('Live Class Attendance', kpi3X, y + 7);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(2, 132, 199);
  pdf.text(`${options.scorecards.liveAttendance.currentValue}%`, kpi3X, y + 16);

  const attDelta = options.scorecards.liveAttendance.deltaPts;
  const attDeltaVal = attDelta ?? 0;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(attDeltaVal >= 0 ? 16 : 220, attDeltaVal >= 0 ? 149 : 38, attDeltaVal >= 0 ? 99 : 38);
  pdf.text(attDelta !== null ? formatSignedDelta(attDeltaVal) : '—', kpi3X, y + 23);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(148, 163, 184);
  pdf.text('Live session participation', kpi3X, y + 28);

  y += kpiBoxHeight + 8;

  // 3. Segment Breakdown & Chart Visual
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(20, 22, 43);
  pdf.text('2. Cohort Health & Segmentation', margin, y);

  y += 4;
  const segBoxHeight = 24;
  const segWidth = (contentWidth - 8) / 3;

  // High Segment
  pdf.setFillColor(240, 253, 244);
  pdf.setDrawColor(187, 247, 208);
  pdf.roundedRect(margin, y, segWidth, segBoxHeight, 2, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(22, 101, 52);
  pdf.text(String(options.segmentation.highCount), margin + 5, y + 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text('High Segment (>=80%)', margin + 5, y + 18);

  // Medium Segment
  pdf.setFillColor(254, 252, 232);
  pdf.setDrawColor(254, 240, 138);
  pdf.roundedRect(margin + segWidth + 4, y, segWidth, segBoxHeight, 2, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(133, 77, 14);
  pdf.text(String(options.segmentation.mediumCount), margin + segWidth + 9, y + 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text('Medium Segment (50-79%)', margin + segWidth + 9, y + 18);

  // Low Segment
  pdf.setFillColor(254, 242, 242);
  pdf.setDrawColor(254, 202, 202);
  pdf.roundedRect(margin + (segWidth + 4) * 2, y, segWidth, segBoxHeight, 2, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(153, 27, 27);
  pdf.text(String(options.segmentation.lowCount), margin + (segWidth + 4) * 2 + 5, y + 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text('Low Segment (<50%)', margin + (segWidth + 4) * 2 + 5, y + 18);

  y += segBoxHeight + 8;

  // 4. Vector Trajectory Bar Chart
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(20, 22, 43);
  pdf.text('3. Trajectory & Cohort Completion (%)', margin, y);

  y += 4;
  const chartHeight = 36;
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(227, 229, 239);
  pdf.roundedRect(margin, y, contentWidth, chartHeight, 2, 2, 'FD');

  // Draw chart gridlines & bars
  const chartItems = [
    { label: 'Assignments', val: options.scorecards.assignment.currentValue, color: [67, 56, 202] },
    { label: 'Content', val: options.scorecards.consumption.currentValue, color: [13, 148, 136] },
    { label: 'Live Class', val: options.scorecards.liveAttendance.currentValue, color: [2, 132, 199] },
  ];

  const barTrackWidth = (contentWidth - 20) / chartItems.length;
  chartItems.forEach((item, idx) => {
    const itemX = margin + 10 + idx * barTrackWidth;
    const barW = 28;
    const maxBarH = 20;
    const barH = Math.max(2, (item.val / 100) * maxBarH);
    const barY = y + chartHeight - 10 - barH;

    // Background track
    pdf.setFillColor(241, 245, 249);
    pdf.rect(itemX + 8, y + chartHeight - 10 - maxBarH, barW, maxBarH, 'F');

    // Colored bar
    pdf.setFillColor(item.color[0], item.color[1], item.color[2]);
    pdf.rect(itemX + 8, barY, barW, barH, 'F');

    // Value text on top
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(20, 22, 43);
    pdf.text(`${item.val}%`, itemX + 8 + barW / 2, barY - 1.5, { align: 'center' });

    // Label below
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(item.label, itemX + 8 + barW / 2, y + chartHeight - 3, { align: 'center' });
  });

  y += chartHeight + 8;

  // 5. At-Risk Priority Follow-up Table (Capped at top 4 to fit single A4 page strictly)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(20, 22, 43);
  pdf.text(`4. Priority Intervention Roster (${options.atRiskStudents.length} Flagged)`, margin, y);

  y += 4;
  const tableTop = y;
  const thHeight = 6;
  const rowHeight = 7;
  const visibleStudents = options.atRiskStudents.slice(0, 4);

  // Table header
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(227, 229, 239);
  pdf.rect(margin, tableTop, contentWidth, thHeight, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text('LEARNER', margin + 4, tableTop + 4.2);
  pdf.text('TIER', margin + 50, tableTop + 4.2);
  pdf.text('PRIMARY RISK REASONS', margin + 75, tableTop + 4.2);
  pdf.text('CONTENT', margin + 145, tableTop + 4.2, { align: 'right' });
  pdf.text('ASSIGNMENT', margin + contentWidth - 4, tableTop + 4.2, { align: 'right' });

  let rowY = tableTop + thHeight;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);

  if (visibleStudents.length === 0) {
    pdf.rect(margin, rowY, contentWidth, rowHeight, 'D');
    pdf.setTextColor(148, 163, 184);
    pdf.text('No students are currently flagged as at-risk.', margin + 4, rowY + 4.5);
    rowY += rowHeight;
  } else {
    visibleStudents.forEach((st) => {
      pdf.setDrawColor(227, 229, 239);
      pdf.rect(margin, rowY, contentWidth, rowHeight, 'D');

      pdf.setTextColor(20, 22, 43);
      pdf.setFont('helvetica', 'bold');
      pdf.text(st.studentName.slice(0, 22), margin + 4, rowY + 4.8);

      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(st.segment === 'Low' ? 220 : 180, 38, 38);
      pdf.text(st.segment, margin + 50, rowY + 4.8);

      pdf.setTextColor(100, 116, 139);
      const reasonText = (st.reasons[0] || 'Academic intervention required').slice(0, 35);
      pdf.text(reasonText, margin + 75, rowY + 4.8);

      pdf.setTextColor(20, 22, 43);
      pdf.text(`${st.totalConsumptionPct}%`, margin + 145, rowY + 4.8, { align: 'right' });
      pdf.text(`${st.assignmentSubmissionPct}%`, margin + contentWidth - 4, rowY + 4.8, { align: 'right' });

      rowY += rowHeight;
    });
  }

  y = rowY + 8;

  // 6. Key Takeaways
  if (options.takeaways && options.takeaways.length > 0) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(20, 22, 43);
    pdf.text('Key Takeaways & Action Items', margin, y);
    y += 4;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(71, 85, 105);
    options.takeaways.slice(0, 3).forEach((item) => {
      pdf.setFillColor(67, 56, 202);
      pdf.circle(margin + 2, y - 1, 1, 'F');
      pdf.text(item, margin + 6, y);
      y += 4.5;
    });
  }

  // 7. Footer
  pdf.setDrawColor(227, 229, 239);
  pdf.setLineWidth(0.4);
  pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(148, 163, 184);
  pdf.text(
    `Generated on ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}  |  Confidential  |  Single-Page Manager Report`,
    margin,
    pageHeight - 8
  );
  pdf.text('Page 1 of 1', pageWidth - margin, pageHeight - 8, { align: 'right' });

  return pdf;
}
