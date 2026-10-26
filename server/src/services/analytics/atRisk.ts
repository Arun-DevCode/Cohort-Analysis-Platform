import { SegmentType } from './segments.js';

export interface AtRiskThresholds {
  consumption: number;
  attendance: number;
  liveLow: number;
  liveOrRecHigh: number;
  liveHigh: number;
  assignmentLow: number;
}

export const DEFAULT_AT_RISK_THRESHOLDS: AtRiskThresholds = {
  consumption: 50,
  attendance: 50,
  liveLow: 30,
  liveOrRecHigh: 70,
  liveHigh: 70,
  assignmentLow: 25,
};

export interface AtRiskCandidate {
  studentId: string;
  externalStudentId: string;
  name: string;
  phoneE164: string;
  assignmentSubmissionPct: number;
  assignmentsSubmitted: number;
  totalConsumptionPct: number;
  livePct: number;
  liveOrRecPct: number;
  segment: SegmentType;
}

export interface AtRiskStudentResult {
  studentId: string;
  externalStudentId: string;
  name: string;
  phoneE164: string;
  reasons: string[];
  assignmentSubmissionPct: number;
  totalConsumptionPct: number;
  livePct: number;
  liveOrRecPct: number;
  segment: SegmentType;
}

export function identifyAtRiskStudents(
  candidates: AtRiskCandidate[],
  thresholds: AtRiskThresholds = DEFAULT_AT_RISK_THRESHOLDS
): AtRiskStudentResult[] {
  const atRiskList: AtRiskStudentResult[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];

    // Rule 1: 0 assignments submitted
    if (c.assignmentsSubmitted === 0) {
      reasons.push('0 assignments submitted');
    }

    // Rule 2: Consumption below threshold
    if (c.totalConsumptionPct < thresholds.consumption) {
      reasons.push(`Low consumption (${c.totalConsumptionPct}%)`);
    }

    // Rule 3: Attendance below threshold
    if (c.livePct < thresholds.attendance) {
      reasons.push(`Low attendance (${c.livePct}%)`);
    }

    // Rule 4: Recording-only learner (Live < 30% and Live+Rec > 70%)
    if (c.livePct < thresholds.liveLow && c.liveOrRecPct > thresholds.liveOrRecHigh) {
      reasons.push('Recording-only learner');
    }

    // Rule 5: Attends but does not submit (Live >= 70% and Assignment < 25%)
    if (c.livePct >= thresholds.liveHigh && c.assignmentSubmissionPct < thresholds.assignmentLow) {
      reasons.push('Attends but does not submit');
    }

    if (reasons.length > 0) {
      atRiskList.push({
        studentId: c.studentId,
        externalStudentId: c.externalStudentId,
        name: c.name,
        phoneE164: c.phoneE164,
        reasons,
        assignmentSubmissionPct: c.assignmentSubmissionPct,
        totalConsumptionPct: c.totalConsumptionPct,
        livePct: c.livePct,
        liveOrRecPct: c.liveOrRecPct,
        segment: c.segment,
      });
    }
  }

  // Sort descending by number of risk factors
  return atRiskList.sort((a, b) => b.reasons.length - a.reasons.length);
}

export function exportAtRiskToCsv(atRiskList: AtRiskStudentResult[]): string {
  const headers = [
    'Student ID',
    'Student Name',
    'Phone',
    'Risk Factors Count',
    'Risk Reasons',
    'Assignment Submission %',
    'Total Consumption %',
    'Live Attendance %',
    'Live Or Recording %',
    'Segment',
  ];

  const escapeCsv = (val: any) => {
    const str = String(val === null || val === undefined ? '' : val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = atRiskList.map((st) => [
    escapeCsv(st.externalStudentId),
    escapeCsv(st.name),
    escapeCsv(st.phoneE164),
    st.reasons.length,
    escapeCsv(st.reasons.join('; ')),
    st.assignmentSubmissionPct,
    st.totalConsumptionPct,
    st.livePct,
    st.liveOrRecPct,
    st.segment.toUpperCase(),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
