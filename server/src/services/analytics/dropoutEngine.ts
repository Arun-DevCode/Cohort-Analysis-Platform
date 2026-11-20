import { isSubmittedStatus } from './lateSubmissionEngine.js';

export const TREND_STABLE_BAND_PCT = 5.0;

export type DropoutTier = 'active' | 'slipping' | 'at_risk' | 'likely_dropped_out' | 'too_early';

export interface DropoutSettings {
  slippingAt: number;
  atRiskAt: number;
  dropoutAt: number;
  minDue: number;
}

export const DEFAULT_DROPOUT_SETTINGS: DropoutSettings = {
  slippingAt: 1,
  atRiskAt: 2,
  dropoutAt: 3,
  minDue: 3,
};

export interface DropoutAssignmentScheduleItem {
  lmsAssignmentName: string;
  type: 'regular' | 'module_end';
  dueDate: string | null; // YYYY-MM-DD
}

export interface DropoutSnapshotRecord {
  id: string;
  snapshotDate: string; // YYYY-MM-DD
  assignments: {
    studentId: string;
    studentName: string;
    phoneE164: string;
    assignmentName: string;
    status: string;
    score: number | null;
  }[];
}

export interface DropoutLearnerSummary {
  studentId: string;
  studentName: string;
  phoneE164: string;
  tier: DropoutTier;
  tierLabel: string;
  dueCount: number;
  submittedCount: number;
  submissionRate: number;
  currentStreak: number;
  longestStreak: number;
  neverStarted: boolean;
  lastSubmittedAssignment: {
    name: string;
    dueDate: string | null;
    status: string;
    windowText: string | null;
  } | null;
  trend: {
    direction: 'improving' | 'declining' | 'stable' | 'not_applicable';
    diffPct: number | null;
    text: string;
  };
  moduleEndDue: number;
  moduleEndSubmitted: number;
  missedModuleEnd: boolean;
}

export interface DropoutFunnelItem {
  assignmentName: string;
  dueDate: string;
  type: 'regular' | 'module_end';
  submittedCount: number;
  learnerCount: number;
  submissionRate: number;
}

export interface BatchDropoutReport {
  batchId: string;
  snapshotId: string;
  reportDate: string;
  hasDueDates: boolean;
  isTooEarly: boolean;
  minDue: number;
  thresholds: DropoutSettings;
  tierCounts: {
    active: number;
    slipping: number;
    atRisk: number;
    likelyDroppedOut: number;
    tooEarly: number;
  };
  funnel: DropoutFunnelItem[];
  learners: DropoutLearnerSummary[];
}

export function formatTierLabel(tier: DropoutTier): string {
  switch (tier) {
    case 'active':
      return 'Active';
    case 'slipping':
      return 'Slipping';
    case 'at_risk':
      return 'At risk';
    case 'likely_dropped_out':
      return 'Likely dropped out';
    case 'too_early':
      return 'Too early';
  }
}

/**
 * Pure Engine: Computes assignment-based drop-out risk for one report snapshot.
 * Evaluated entirely on read with zero persistence.
 */
export function computeDropoutAnalytics(params: {
  batchId: string;
  selectedSnapshotId: string;
  allBatchSnapshots: DropoutSnapshotRecord[];
  schedule: DropoutAssignmentScheduleItem[];
  settings?: Partial<DropoutSettings>;
}): BatchDropoutReport {
  const { batchId, selectedSnapshotId, allBatchSnapshots, schedule } = params;

  const settings: DropoutSettings = {
    slippingAt: params.settings?.slippingAt ?? DEFAULT_DROPOUT_SETTINGS.slippingAt,
    atRiskAt: params.settings?.atRiskAt ?? DEFAULT_DROPOUT_SETTINGS.atRiskAt,
    dropoutAt: params.settings?.dropoutAt ?? DEFAULT_DROPOUT_SETTINGS.dropoutAt,
    minDue: params.settings?.minDue ?? DEFAULT_DROPOUT_SETTINGS.minDue,
  };

  // 1. Identify selected snapshot
  const targetSnap = allBatchSnapshots.find((s) => s.id === selectedSnapshotId);
  if (!targetSnap) {
    throw new Error(`Target snapshot ${selectedSnapshotId} not found in provided batch snapshots`);
  }
  const reportDate = targetSnap.snapshotDate;

  // 2. Identify due assignments as of the report date
  // Regular assignments only determine streak and tier
  const regularDueAssignments = schedule
    .filter(
      (s) =>
        s.type === 'regular' &&
        s.dueDate !== null &&
        s.dueDate.trim() !== '' &&
        s.dueDate.slice(0, 10) <= reportDate
    )
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.lmsAssignmentName.localeCompare(b.lmsAssignmentName));

  const moduleEndDueAssignments = schedule
    .filter(
      (s) =>
        s.type === 'module_end' &&
        s.dueDate !== null &&
        s.dueDate.trim() !== '' &&
        s.dueDate.slice(0, 10) <= reportDate
    )
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.lmsAssignmentName.localeCompare(b.lmsAssignmentName));

  const hasDueDates = regularDueAssignments.length > 0 || moduleEndDueAssignments.length > 0;
  const isTooEarly = regularDueAssignments.length < settings.minDue;

  // 3. Funnel: all due assignments (regular + module_end) in due-date order
  const allDueAssignments = [...regularDueAssignments, ...moduleEndDueAssignments].sort(
    (a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.lmsAssignmentName.localeCompare(b.lmsAssignmentName)
  );

  // Collect distinct learners from target snapshot
  const studentMap = new Map<string, { id: string; name: string; phoneE164: string }>();
  for (const a of targetSnap.assignments) {
    if (!studentMap.has(a.studentId)) {
      studentMap.set(a.studentId, {
        id: a.studentId,
        name: a.studentName,
        phoneE164: a.phoneE164,
      });
    }
  }
  const totalLearners = studentMap.size;

  // Pre-index target snapshot assignments by learner and normalized name
  const targetRecordsMap = new Map<string, Map<string, { status: string; score: number | null }>>();
  for (const a of targetSnap.assignments) {
    let studentAsgns = targetRecordsMap.get(a.studentId);
    if (!studentAsgns) {
      studentAsgns = new Map();
      targetRecordsMap.set(a.studentId, studentAsgns);
    }
    studentAsgns.set(a.assignmentName.trim().toLowerCase(), {
      status: a.status,
      score: a.score,
    });
  }

  // Pre-calculate funnel item submission counts
  const funnel: DropoutFunnelItem[] = allDueAssignments.map((asgn) => {
    const asgnKey = asgn.lmsAssignmentName.trim().toLowerCase();
    let submittedCount = 0;
    for (const [, studentAsgns] of targetRecordsMap) {
      const rec = studentAsgns.get(asgnKey);
      if (rec && isSubmittedStatus(rec.status)) {
        submittedCount++;
      }
    }
    const rate = totalLearners > 0 ? Number(((submittedCount / totalLearners) * 100).toFixed(1)) : 0;
    return {
      assignmentName: asgn.lmsAssignmentName,
      dueDate: asgn.dueDate || '',
      type: asgn.type,
      submittedCount,
      learnerCount: totalLearners,
      submissionRate: rate,
    };
  });

  // 4. Chronological snapshots on or before report date for Stage 2 submission window
  const chronologicalSnaps = allBatchSnapshots
    .filter((s) => s.snapshotDate <= reportDate)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

  // 5. Per-learner drop-out evaluation
  const learners: DropoutLearnerSummary[] = [];
  const tierCounts = {
    active: 0,
    slipping: 0,
    atRisk: 0,
    likelyDroppedOut: 0,
    tooEarly: 0,
  };

  const regDueCount = regularDueAssignments.length;
  const modEndDueCount = moduleEndDueAssignments.length;

  for (const [studentId, student] of studentMap) {
    const studentAsgns = targetRecordsMap.get(studentId) || new Map();

    // Regular assignments evaluation in due-date order
    let regSubmittedCount = 0;
    const regSubmissions: boolean[] = [];
    let lastSubmittedRegularItem: {
      name: string;
      dueDate: string | null;
      status: string;
      windowText: string | null;
    } | null = null;

    for (const rAsgn of regularDueAssignments) {
      const rKey = rAsgn.lmsAssignmentName.trim().toLowerCase();
      const rec = studentAsgns.get(rKey);
      const isSub = rec ? isSubmittedStatus(rec.status) : false;
      regSubmissions.push(isSub);
      if (isSub) {
        regSubmittedCount++;
        // Keep track of the most recent submitted regular assignment in due-date order
        lastSubmittedRegularItem = {
          name: rAsgn.lmsAssignmentName,
          dueDate: rAsgn.dueDate,
          status: rec?.status || 'SUBMITTED',
          windowText: null, // Will compute window below
        };
      }
    }

    // Compute Stage 2 submission window for the last submitted assignment if present
    if (lastSubmittedRegularItem) {
      const targetAsgnKey = lastSubmittedRegularItem.name.trim().toLowerCase();
      let firstSubSnapDate: string | null = null;
      let lastPendingSnapDate: string | null = null;

      for (const snap of chronologicalSnaps) {
        const found = snap.assignments.find(
          (a) => a.studentId === studentId && a.assignmentName.trim().toLowerCase() === targetAsgnKey
        );
        if (found) {
          if (isSubmittedStatus(found.status)) {
            if (!firstSubSnapDate) firstSubSnapDate = snap.snapshotDate;
          } else {
            if (!firstSubSnapDate) lastPendingSnapDate = snap.snapshotDate;
          }
        }
      }

      if (firstSubSnapDate && lastPendingSnapDate) {
        lastSubmittedRegularItem.windowText = `Submitted between ${lastPendingSnapDate} and ${firstSubSnapDate}`;
      } else if (firstSubSnapDate) {
        lastSubmittedRegularItem.windowText = `Submitted on or before ${firstSubSnapDate}`;
      }
    }

    // Current streak: consecutive missed regular due assignments counting back from the most recent one
    let currentStreak = 0;
    for (let i = regSubmissions.length - 1; i >= 0; i--) {
      if (!regSubmissions[i]) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Longest streak: max consecutive run of false
    let longestStreak = 0;
    let currentRun = 0;
    for (const isSub of regSubmissions) {
      if (!isSub) {
        currentRun++;
        if (currentRun > longestStreak) longestStreak = currentRun;
      } else {
        currentRun = 0;
      }
    }

    const regRate = regDueCount > 0 ? Number(((regSubmittedCount / regDueCount) * 100).toFixed(1)) : 0;
    const neverStarted = regDueCount >= 1 && regSubmittedCount === 0;

    // Trend calculation: requires at least 4 regular assignments due
    // so earlierCount is at least 1 (earlier is never empty)
    let trend: DropoutLearnerSummary['trend'] = {
      direction: 'not_applicable',
      diffPct: null,
      text: 'Requires ≥ 4 assignments due',
    };

    if (regDueCount >= 4) {
      // Last 3 due assignments
      const last3 = regSubmissions.slice(-3);
      const last3SubCount = last3.filter(Boolean).length;
      const last3Rate = (last3SubCount / 3) * 100;

      // Earlier due assignments
      const earlier = regSubmissions.slice(0, -3);
      const earlierSubCount = earlier.filter(Boolean).length;
      const earlierRate = (earlierSubCount / earlier.length) * 100;

      const diff = Number((last3Rate - earlierRate).toFixed(1));

      if (diff > TREND_STABLE_BAND_PCT) {
        trend = {
          direction: 'improving',
          diffPct: diff,
          text: `+${diff}% (improving)`,
        };
      } else if (diff < -TREND_STABLE_BAND_PCT) {
        trend = {
          direction: 'declining',
          diffPct: diff,
          text: `${diff}% (declining)`,
        };
      } else {
        trend = {
          direction: 'stable',
          diffPct: diff,
          text: `±${Math.abs(diff)}% (stable)`,
        };
      }
    }

    // Module-end assignments evaluation
    let modEndSubmittedCount = 0;
    for (const mAsgn of moduleEndDueAssignments) {
      const mKey = mAsgn.lmsAssignmentName.trim().toLowerCase();
      const rec = studentAsgns.get(mKey);
      if (rec && isSubmittedStatus(rec.status)) {
        modEndSubmittedCount++;
      }
    }
    const missedModuleEnd = modEndDueCount > modEndSubmittedCount;

    // Tier assignment: top-down range checks with >= so edited thresholds never leave a gap
    let tier: DropoutTier;
    if (!hasDueDates || isTooEarly) {
      tier = 'too_early';
    } else {
      const noSubmissionsThreshold = Math.max(settings.dropoutAt, settings.minDue);
      if (currentStreak >= settings.dropoutAt || (regSubmittedCount === 0 && regDueCount >= noSubmissionsThreshold)) {
        tier = 'likely_dropped_out';
      } else if (currentStreak >= settings.atRiskAt) {
        tier = 'at_risk';
      } else if (currentStreak >= settings.slippingAt) {
        tier = 'slipping';
      } else {
        tier = 'active';
      }
    }

    // Update tier counts
    if (tier === 'likely_dropped_out') tierCounts.likelyDroppedOut++;
    else if (tier === 'at_risk') tierCounts.atRisk++;
    else if (tier === 'slipping') tierCounts.slipping++;
    else if (tier === 'active') tierCounts.active++;
    else tierCounts.tooEarly++;

    learners.push({
      studentId,
      studentName: student.name,
      phoneE164: student.phoneE164,
      tier,
      tierLabel: formatTierLabel(tier),
      dueCount: regDueCount,
      submittedCount: regSubmittedCount,
      submissionRate: regRate,
      currentStreak,
      longestStreak,
      neverStarted,
      lastSubmittedAssignment: lastSubmittedRegularItem,
      trend,
      moduleEndDue: modEndDueCount,
      moduleEndSubmitted: modEndSubmittedCount,
      missedModuleEnd,
    });
  }

  // Sort learners by severity:
  // 1. Likely dropped out
  // 2. At risk
  // 3. Slipping
  // 4. Active
  // 5. Too early
  const tierWeight: Record<DropoutTier, number> = {
    likely_dropped_out: 0,
    at_risk: 1,
    slipping: 2,
    active: 3,
    too_early: 4,
  };

  learners.sort((a, b) => {
    const wDiff = tierWeight[a.tier] - tierWeight[b.tier];
    if (wDiff !== 0) return wDiff;
    if (a.submissionRate !== b.submissionRate) return a.submissionRate - b.submissionRate;
    if (a.currentStreak !== b.currentStreak) return b.currentStreak - a.currentStreak;
    return a.studentName.localeCompare(b.studentName);
  });

  return {
    batchId,
    snapshotId: targetSnap.id,
    reportDate,
    hasDueDates,
    isTooEarly,
    minDue: settings.minDue,
    thresholds: settings,
    tierCounts,
    funnel,
    learners,
  };
}

