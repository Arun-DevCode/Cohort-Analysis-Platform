import { classifyMovement, MovementType } from './metrics.js';

export type SegmentType = 'high' | 'medium' | 'low';

export interface StudentSnapshotFact {
  studentId: string;
  externalStudentId: string;
  name: string;
  phoneE164: string;
  assignmentSubmissionPct: number;
  totalConsumptionPct: number;
  livePct: number;
  liveOrRecPct: number;
  segment: SegmentType;
}

export interface StudentComparisonResult {
  studentId: string;
  externalStudentId: string;
  name: string;
  phoneE164: string;
  assignmentA: number;
  assignmentB: number;
  assignmentDelta: number;
  consumptionA: number;
  consumptionB: number;
  consumptionDelta: number;
  attendanceA: number;
  attendanceB: number;
  attendanceDelta: number;
  segmentA: SegmentType;
  segmentB: SegmentType;
  movement: MovementType;
}

export interface TransitionMatrix {
  high: { high: number; medium: number; low: number };
  medium: { high: number; medium: number; low: number };
  low: { high: number; medium: number; low: number };
}

export function compareSnapshotStudents(
  snapshotAStudents: StudentSnapshotFact[],
  snapshotBStudents: StudentSnapshotFact[],
  tolerance = 2
): {
  comparisons: StudentComparisonResult[];
  improved: StudentComparisonResult[];
  same: StudentComparisonResult[];
  declined: StudentComparisonResult[];
  matrix: TransitionMatrix;
} {
  const mapA = new Map<string, StudentSnapshotFact>();
  for (const s of snapshotAStudents) {
    mapA.set(s.studentId, s);
  }

  const comparisons: StudentComparisonResult[] = [];
  const matrix: TransitionMatrix = {
    high: { high: 0, medium: 0, low: 0 },
    medium: { high: 0, medium: 0, low: 0 },
    low: { high: 0, medium: 0, low: 0 },
  };

  for (const b of snapshotBStudents) {
    const a = mapA.get(b.studentId);
    if (!a) continue;

    const assignmentDelta = Number((b.assignmentSubmissionPct - a.assignmentSubmissionPct).toFixed(1));
    const consumptionDelta = Number((b.totalConsumptionPct - a.totalConsumptionPct).toFixed(1));
    const attendanceDelta = Number((b.livePct - a.livePct).toFixed(1));

    // Overall movement based on composite delta
    const compositeDelta = Number(((assignmentDelta + consumptionDelta + attendanceDelta) / 3).toFixed(1));
    const movement = classifyMovement(compositeDelta, tolerance);

    matrix[a.segment][b.segment]++;

    comparisons.push({
      studentId: b.studentId,
      externalStudentId: b.externalStudentId,
      name: b.name,
      phoneE164: b.phoneE164,
      assignmentA: a.assignmentSubmissionPct,
      assignmentB: b.assignmentSubmissionPct,
      assignmentDelta,
      consumptionA: a.totalConsumptionPct,
      consumptionB: b.totalConsumptionPct,
      consumptionDelta,
      attendanceA: a.livePct,
      attendanceB: b.livePct,
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
