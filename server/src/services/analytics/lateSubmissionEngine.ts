import { z } from 'zod';

export const SubmissionLatenessStatusSchema = z.enum([
  'on_time',
  'late',
  'possibly_late',
  'unknown',
  'not_submitted',
  'no_due_date',
]);

export type SubmissionLatenessStatus = z.infer<typeof SubmissionLatenessStatusSchema>;

export interface LearnerAssignmentStatus {
  studentId: string;
  studentName: string;
  phoneE164: string;
  lmsAssignmentName: string;
  status: SubmissionLatenessStatus;
  submissionDateEstimate: string | null; // e.g. "On or before 2026-08-28"
  windowStart: string | null; // S_prev date
  windowEnd: string | null; // S_sub date
  windowText: string | null; // e.g. "submitted between 28 Oct and 4 Nov"
  firstSubmittedSnapshotDate: string | null;
  lastPendingSnapshotDate: string | null;
  rawStatus: string;
  score: number | null;
  dueDate: string | null;
}

export interface AssignmentLatenessSummary {
  lmsAssignmentName: string;
  roadmapKey: string | null;
  type: 'regular' | 'module_end';
  dueDate: string | null;
  hasDueDate: boolean;
  totalLearners: number;
  submittedCount: number;
  onTimeCount: number;
  lateCount: number; // Certain late
  possiblyLateCount: number;
  unknownCount: number;
  notSubmittedCount: number;
  learners: LearnerAssignmentStatus[];
}

export interface BatchLatenessReport {
  batchId: string;
  snapshotId: string;
  snapshotDate: string;
  totalSnapshotsConsidered: number;
  snapshotDates: string[];
  certainLateTotal: number;
  possiblyLateTotal: number;
  unknownTotal: number;
  onTimeTotal: number;
  missingDueDatesCount: number;
  staleUploadWarning: boolean;
  daysSinceLastUpload: number;
  assignments: AssignmentLatenessSummary[];
}

export interface SnapshotInputData {
  id: string;
  snapshotDate: string; // YYYY-MM-DD
  assignments: Array<{
    studentId: string;
    studentName: string;
    phoneE164: string;
    assignmentName: string;
    status: string; // e.g. 'PASSED', 'SUBMISSION_PENDING'
    score: number | null;
  }>;
}

export interface ScheduleInputData {
  lmsAssignmentName: string;
  roadmapKey: string | null;
  type: 'regular' | 'module_end';
  dueDate: string | null; // YYYY-MM-DD
}

/**
 * Checks if status value represents submitted work
 * Approved list: PASSED, SUBMITTED, DELAYED, PASS (DELAYED), PASS
 */
export function isSubmittedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = String(status).trim().toUpperCase();
  return (
    s === 'PASSED' ||
    s === 'SUBMITTED' ||
    s === 'DELAYED' ||
    s === 'PASS (DELAYED)' ||
    s === 'PASS' ||
    s.startsWith('PASSED') ||
    s.startsWith('SUBMITTED') ||
    s.startsWith('DELAYED')
  );
}

/**
 * Formats date into readable string e.g. "28 Oct" or "4 Nov"
 */
function formatDateShort(dateStr: string): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${day} ${months[monthIdx]}`;
      }
    }
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

/**
 * Pure Engine: computes late-submission estimates across chronological snapshots
 */
export function computeLateSubmissions(params: {
  batchId: string;
  selectedSnapshotId: string;
  allBatchSnapshots: SnapshotInputData[];
  schedule: ScheduleInputData[];
  currentDate?: string;
}): BatchLatenessReport {
  const { batchId, selectedSnapshotId, allBatchSnapshots, schedule } = params;

  // 1. Identify selected snapshot
  const targetSnap = allBatchSnapshots.find((s) => s.id === selectedSnapshotId);
  if (!targetSnap) {
    throw new Error(`Target snapshot ${selectedSnapshotId} not found in provided batch snapshots`);
  }

  // 2. Filter: Only snapshots on or before the selected snapshot's report date
  // Sort strictly by REPORT DATE (ascending), never upload time
  const chronologicalSnapshots = allBatchSnapshots
    .filter((s) => s.snapshotDate <= targetSnap.snapshotDate)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

  const snapshotDates = chronologicalSnapshots.map((s) => s.snapshotDate);

  // 3. Stale upload detection: check days since target snapshot date
  const now = params.currentDate ? new Date(params.currentDate) : new Date();
  const snapDateObj = new Date(targetSnap.snapshotDate);
  const diffTime = Math.max(0, now.getTime() - snapDateObj.getTime());
  const daysSinceLastUpload = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const staleUploadWarning = daysSinceLastUpload > 7;

  // 4. Map schedule by normalized lmsAssignmentName
  const scheduleMap = new Map<string, ScheduleInputData>();
  for (const s of schedule) {
    scheduleMap.set(s.lmsAssignmentName.trim(), s);
  }

  // 5. Gather all distinct assignment names present in target snapshot
  const distinctAssignmentsInTarget = Array.from(
    new Set(targetSnap.assignments.map((a) => a.assignmentName.trim()))
  );

  // 6. Gather all distinct students present in target snapshot
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

  const assignmentSummaries: AssignmentLatenessSummary[] = [];
  let certainLateTotal = 0;
  let possiblyLateTotal = 0;
  let unknownTotal = 0;
  let onTimeTotal = 0;
  let missingDueDatesCount = 0;

  for (const assignName of distinctAssignmentsInTarget) {
    const sched = scheduleMap.get(assignName);
    const dueDate = sched?.dueDate || null;
    const type = sched?.type || (assignName.toLowerCase().includes('module end') ? 'module_end' : 'regular');
    const roadmapKey = sched?.roadmapKey || null;

    if (!dueDate) {
      missingDueDatesCount++;
    }

    const learnerResults: LearnerAssignmentStatus[] = [];
    let onTimeCount = 0;
    let lateCount = 0;
    let possiblyLateCount = 0;
    let unknownCount = 0;
    let notSubmittedCount = 0;

    for (const [studentId, student] of studentMap.entries()) {
      if (!dueDate) {
        // Find latest status in target snapshot
        const targetRecord = targetSnap.assignments.find(
          (a) => a.studentId === studentId && a.assignmentName.trim() === assignName
        );
        learnerResults.push({
          studentId,
          studentName: student.name,
          phoneE164: student.phoneE164,
          lmsAssignmentName: assignName,
          status: 'no_due_date',
          submissionDateEstimate: null,
          windowStart: null,
          windowEnd: null,
          windowText: null,
          firstSubmittedSnapshotDate: null,
          lastPendingSnapshotDate: null,
          rawStatus: targetRecord?.status || 'NOT_SUBMITTED',
          score: targetRecord?.score ?? null,
          dueDate: null,
        });
        continue;
      }

      // Track timeline of this learner's status across chronological snapshots
      let firstSubmittedSnap: SnapshotInputData | null = null;
      let lastPendingSnapBeforeSub: SnapshotInputData | null = null;
      let targetRecordRaw: { status: string; score: number | null } | null = null;

      for (const snap of chronologicalSnapshots) {
        const record = snap.assignments.find(
          (a) => a.studentId === studentId && a.assignmentName.trim() === assignName
        );

        if (snap.id === targetSnap.id && record) {
          targetRecordRaw = { status: record.status, score: record.score };
        }

        if (record) {
          if (isSubmittedStatus(record.status)) {
            if (!firstSubmittedSnap) {
              firstSubmittedSnap = snap;
            }
          } else {
            // It is pending or not submitted in this snapshot
            if (!firstSubmittedSnap) {
              lastPendingSnapBeforeSub = snap;
            }
          }
        }
      }

      let latenessStatus: SubmissionLatenessStatus = 'not_submitted';
      let windowStart: string | null = null;
      let windowEnd: string | null = null;
      let windowText: string | null = null;
      let submissionDateEstimate: string | null = null;

      if (!firstSubmittedSnap) {
        // None: not submitted (not counted as late)
        latenessStatus = 'not_submitted';
        notSubmittedCount++;
      } else if (firstSubmittedSnap.snapshotDate <= dueDate) {
        // S_sub date <= D: on_time
        latenessStatus = 'on_time';
        onTimeCount++;
        onTimeTotal++;
        windowEnd = firstSubmittedSnap.snapshotDate;
        windowText = `Submitted on or before ${formatDateShort(windowEnd)}`;
        submissionDateEstimate = `Submitted on or before ${firstSubmittedSnap.snapshotDate}`;
      } else {
        // S_sub date > D: check S_prev
        windowEnd = firstSubmittedSnap.snapshotDate;

        if (!lastPendingSnapBeforeSub) {
          // If LMS status explicitly marked this learner DELAYED, count as late
          const isMarkedDelayed =
            targetRecordRaw?.status &&
            (targetRecordRaw.status.toUpperCase().includes('DELAYED') ||
              targetRecordRaw.status.toUpperCase().includes('LATE'));

          if (isMarkedDelayed) {
            latenessStatus = 'late';
            lateCount++;
            certainLateTotal++;
            windowText = `Marked delayed by LMS (submitted by ${formatDateShort(windowEnd)})`;
            submissionDateEstimate = `Marked delayed by LMS`;
          } else {
            // None exists: unknown
            latenessStatus = 'unknown';
            unknownCount++;
            unknownTotal++;
            windowText = `Timing unknown (submitted by ${formatDateShort(windowEnd)})`;
            submissionDateEstimate = `Submitted on or before ${windowEnd} (no earlier report)`;
          }
        } else if (lastPendingSnapBeforeSub.snapshotDate > dueDate) {
          // S_prev date > D: late (certain)
          latenessStatus = 'late';
          lateCount++;
          certainLateTotal++;
          windowStart = lastPendingSnapBeforeSub.snapshotDate;
          windowText = `Submitted late (between ${formatDateShort(windowStart)} and ${formatDateShort(windowEnd)})`;
          submissionDateEstimate = `Submitted between ${windowStart} and ${windowEnd}`;
        } else {
          // S_prev date <= D: possibly_late with window (S_prev date, S_sub date]
          latenessStatus = 'possibly_late';
          possiblyLateCount++;
          possiblyLateTotal++;
          windowStart = lastPendingSnapBeforeSub.snapshotDate;
          windowText = `Submitted between ${formatDateShort(windowStart)} and ${formatDateShort(windowEnd)}`;
          submissionDateEstimate = `Window: ${windowStart} to ${windowEnd}`;
        }
      }

      learnerResults.push({
        studentId,
        studentName: student.name,
        phoneE164: student.phoneE164,
        lmsAssignmentName: assignName,
        status: latenessStatus,
        submissionDateEstimate,
        windowStart,
        windowEnd,
        windowText,
        firstSubmittedSnapshotDate: firstSubmittedSnap?.snapshotDate || null,
        lastPendingSnapshotDate: lastPendingSnapBeforeSub?.snapshotDate || null,
        rawStatus: targetRecordRaw?.status || 'NOT_SUBMITTED',
        score: targetRecordRaw?.score ?? null,
        dueDate,
      });
    }

    const submittedCount = onTimeCount + lateCount + possiblyLateCount + unknownCount;

    assignmentSummaries.push({
      lmsAssignmentName: assignName,
      roadmapKey,
      type,
      dueDate,
      hasDueDate: Boolean(dueDate),
      totalLearners: studentMap.size,
      submittedCount,
      onTimeCount,
      lateCount,
      possiblyLateCount,
      unknownCount,
      notSubmittedCount,
      learners: learnerResults,
    });
  }

  return {
    batchId,
    snapshotId: targetSnap.id,
    snapshotDate: targetSnap.snapshotDate,
    totalSnapshotsConsidered: chronologicalSnapshots.length,
    snapshotDates,
    certainLateTotal,
    possiblyLateTotal,
    unknownTotal,
    onTimeTotal,
    missingDueDatesCount,
    staleUploadWarning,
    daysSinceLastUpload,
    assignments: assignmentSummaries,
  };
}

