import type {
  StudentSnapshot,
  SegmentType,
  MovementType,
  StudentComparison,
  AtRiskStudent,
  Student,
} from '@/types';

export interface BatchScorecardMetric {
  title: string;
  currentValue: number;
  previousValue: number | null;
  deltaPts: number | null;
  trend: 'up' | 'down' | 'flat' | null;
}

export interface BatchScorecard {
  assignment: BatchScorecardMetric;
  consumption: BatchScorecardMetric;
  liveAttendance: BatchScorecardMetric;
  liveOrRecAttendance: BatchScorecardMetric;
}

export interface SnapshotAggregate {
  snapshotId: string;
  snapshotDate: string;
  studentCount: number;
  assignmentAvg: number;
  consumptionAvg: number;
  liveAttendanceAvg: number;
  liveOrRecAvg: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

export function computeAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return Number((sum / values.length).toFixed(1));
}

export function computeDelta(current: number, previous: number | null): number | null {
  if (previous === null || previous === undefined) return null;
  return Number((current - previous).toFixed(1));
}

export function getTrendDirection(delta: number | null, tolerance = 0.05): 'up' | 'down' | 'flat' | null {
  if (delta === null) return null;
  if (delta >= tolerance) return 'up';
  if (delta <= -tolerance) return 'down';
  return 'flat';
}

export function computeSnapshotAggregate(
  snapshotId: string,
  snapshotDate: string,
  studentSnapshots: StudentSnapshot[]
): SnapshotAggregate {
  const total = studentSnapshots.length;
  if (total === 0) {
    return {
      snapshotId,
      snapshotDate,
      studentCount: 0,
      assignmentAvg: 0,
      consumptionAvg: 0,
      liveAttendanceAvg: 0,
      liveOrRecAvg: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
    };
  }

  const assignmentValues = studentSnapshots.map((s) => s.metrics.assignmentSubmissionPct);
  const consumptionValues = studentSnapshots.map((s) => s.metrics.totalConsumptionPct);
  const liveValues = studentSnapshots.map((s) => s.metrics.liveClassPct);
  const liveOrRecValues = studentSnapshots.map((s) => s.metrics.liveOrRecordingPct);

  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const s of studentSnapshots) {
    if (s.segment === 'High') highCount++;
    else if (s.segment === 'Medium') mediumCount++;
    else lowCount++;
  }

  return {
    snapshotId,
    snapshotDate,
    studentCount: total,
    assignmentAvg: computeAverage(assignmentValues),
    consumptionAvg: computeAverage(consumptionValues),
    liveAttendanceAvg: computeAverage(liveValues),
    liveOrRecAvg: computeAverage(liveOrRecValues),
    highCount,
    mediumCount,
    lowCount,
  };
}

export function computeBatchScorecards(
  currentAgg: SnapshotAggregate,
  previousAgg: SnapshotAggregate | null
): BatchScorecard {
  const createMetric = (
    title: string,
    current: number,
    previous: number | null
  ): BatchScorecardMetric => {
    const delta = computeDelta(current, previous);
    return {
      title,
      currentValue: current,
      previousValue: previous,
      deltaPts: delta,
      trend: getTrendDirection(delta),
    };
  };

  return {
    assignment: createMetric(
      'Assignment Submission',
      currentAgg.assignmentAvg,
      previousAgg ? previousAgg.assignmentAvg : null
    ),
    consumption: createMetric(
      'Content Consumption',
      currentAgg.consumptionAvg,
      previousAgg ? previousAgg.consumptionAvg : null
    ),
    liveAttendance: createMetric(
      'Live Attendance',
      currentAgg.liveAttendanceAvg,
      previousAgg ? previousAgg.liveAttendanceAvg : null
    ),
    liveOrRecAttendance: createMetric(
      'Live + Recording',
      currentAgg.liveOrRecAvg,
      previousAgg ? previousAgg.liveOrRecAvg : null
    ),
  };
}

export function classifyMovement(delta: number, tolerance = 2): MovementType {
  if (delta >= tolerance) return 'IMPROVED';
  if (delta <= -tolerance) return 'DECLINED';
  return 'SAME';
}

export function compareSnapshots(
  snapshotAStudents: StudentSnapshot[],
  snapshotBStudents: StudentSnapshot[],
  studentDirectory: Map<string, Student>,
  tolerance = 2
): {
  comparisons: StudentComparison[];
  improved: StudentComparison[];
  same: StudentComparison[];
  declined: StudentComparison[];
  matrix: Record<SegmentType, Record<SegmentType, number>>;
} {
  const mapA = new Map<string, StudentSnapshot>();
  for (const s of snapshotAStudents) {
    mapA.set(s.studentId, s);
  }

  const comparisons: StudentComparison[] = [];
  const matrix: Record<SegmentType, Record<SegmentType, number>> = {
    High: { High: 0, Medium: 0, Low: 0 },
    Medium: { High: 0, Medium: 0, Low: 0 },
    Low: { High: 0, Medium: 0, Low: 0 },
  };

  for (const b of snapshotBStudents) {
    const a = mapA.get(b.studentId);
    if (!a) continue;

    const student = studentDirectory.get(b.studentId);
    const studentName = student?.name || b.studentId;
    const phoneE164 = student?.phoneE164 || '';

    const assignmentDelta = Number((b.metrics.assignmentSubmissionPct - a.metrics.assignmentSubmissionPct).toFixed(1));
    const consumptionDelta = Number((b.metrics.totalConsumptionPct - a.metrics.totalConsumptionPct).toFixed(1));
    const attendanceDelta = Number((b.metrics.liveClassPct - a.metrics.liveClassPct).toFixed(1));

    // Overall movement can be based on composite delta or consumption
    const averageDelta = Number(((assignmentDelta + consumptionDelta + attendanceDelta) / 3).toFixed(1));
    const movement = classifyMovement(averageDelta, tolerance);

    matrix[a.segment][b.segment]++;

    comparisons.push({
      studentId: b.studentId,
      studentName,
      phoneE164,
      assignmentA: a.metrics.assignmentSubmissionPct,
      assignmentB: b.metrics.assignmentSubmissionPct,
      assignmentDelta,
      consumptionA: a.metrics.totalConsumptionPct,
      consumptionB: b.metrics.totalConsumptionPct,
      consumptionDelta,
      attendanceA: a.metrics.liveClassPct,
      attendanceB: b.metrics.liveClassPct,
      attendanceDelta,
      segmentA: a.segment,
      segmentB: b.segment,
      movement,
    });
  }

  const improved = comparisons.filter((c) => c.movement === 'IMPROVED');
  const same = comparisons.filter((c) => c.movement === 'SAME');
  const declined = comparisons.filter((c) => c.movement === 'DECLINED');

  return {
    comparisons,
    improved,
    same,
    declined,
    matrix,
  };
}

export function identifyAtRiskStudents(
  studentSnapshots: StudentSnapshot[],
  studentDirectory: Map<string, Student>,
  thresholds = { consumption: 50, attendance: 50, liveLow: 30, liveOrRecHigh: 70, liveHigh: 70, assignmentLow: 25 }
): AtRiskStudent[] {
  const atRiskList: AtRiskStudent[] = [];

  for (const s of studentSnapshots) {
    const m = s.metrics;
    const reasons: string[] = [];

    // Rule 1: 0 assignments submitted
    if (m.assignmentsSubmitted === 0) {
      reasons.push('0 assignments submitted');
    }

    // Rule 2: Consumption below 50%
    if (m.totalConsumptionPct < thresholds.consumption) {
      reasons.push(`Low consumption (${m.totalConsumptionPct}%)`);
    }

    // Rule 3: Attendance below 50%
    if (m.liveClassPct < thresholds.attendance) {
      reasons.push(`Low attendance (${m.liveClassPct}%)`);
    }

    // Rule 4: Recording-only learner (Live < 30% and Live+Rec > 70%)
    if (m.liveClassPct < thresholds.liveLow && m.liveOrRecordingPct > thresholds.liveOrRecHigh) {
      reasons.push('Recording-only learner');
    }

    // Rule 5: Attends but does not submit (Live >= 70% and Assignment < 25%)
    if (m.liveClassPct >= thresholds.liveHigh && m.assignmentSubmissionPct < thresholds.assignmentLow) {
      reasons.push('Attends but does not submit');
    }

    if (reasons.length > 0) {
      const student = studentDirectory.get(s.studentId);
      atRiskList.push({
        studentId: s.studentId,
        studentName: student?.name || s.studentId,
        phoneE164: student?.phoneE164 || '',
        reasons,
        assignmentSubmissionPct: m.assignmentSubmissionPct,
        totalConsumptionPct: m.totalConsumptionPct,
        liveClassPct: m.liveClassPct,
        liveOrRecordingPct: m.liveOrRecordingPct,
        segment: s.segment,
      });
    }
  }

  // Sort by count of risk factors descending
  return atRiskList.sort((a, b) => b.reasons.length - a.reasons.length);
}
