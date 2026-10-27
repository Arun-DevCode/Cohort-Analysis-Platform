import { getDb } from '../../db/client.js';
import {
  snapshots,
  batches,
  uploads,
  sessions,
  assignmentItems,
  weeklyConsumption,
  studentSnapshots,
  students,
} from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { normalizePhone, normalizeName } from '../../utils/normalizers.js';

export interface LearnerIdentitySignature {
  studentId: string;
  phoneE164: string;
  nameNormalized: string;
  displayName: string;
}

export interface SnapshotFingerprint {
  version: 1;
  snapshotId: string;
  batchId: string;
  batchKey: string;
  reportDate: string; // ISO YYYY-MM-DD
  fileHash: string;
  sheets: string[];
  coreColumns: Record<string, string[]>;
  assignmentNames: string[];
  sessionTitlesWithoutDates: string[];
  weekNumbers: number[];
  learners: LearnerIdentitySignature[];
  createdAt: string;
}

export interface CompatibilityCheckItem {
  name:
    | 'fingerprint_valid'
    | 'same_batch'
    | 'different_dates'
    | 'sheets_and_columns'
    | 'curriculum_compatible'
    | 'learners_match_100';
  passed: boolean;
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface CompatibilityResult {
  isComparable: boolean;
  shortReason?: string;
  checks: CompatibilityCheckItem[];
}

/**
 * Normalizes session title by stripping date suffixes and date tokens,
 * normalizing case and whitespace.
 * e.g., "TN-DA-ANB22-23Oct-Matplotlib-23-10-2026" -> "tn-da-b22-matplotlib"
 */
export function normalizeSessionTitleWithoutDate(rawTitle: string): string {
  if (!rawTitle) return '';
  let cleaned = rawTitle.trim();

  // Strip trailing date: e.g. "-23-10-2026", "/23/10/2026", " 23.10.2026"
  cleaned = cleaned.replace(/[-_/\s]*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*$/i, '');

  // Strip date token in middle if any: e.g. "-23Oct-", "-23OCTOBER-"
  cleaned = cleaned.replace(/[-_/\s]*\d{1,2}[A-Za-z]{3,4}[-_/\s]*/i, '-');

  // Normalize case-insensitive ANB batch patterns: e.g. "-anb22-" or "-anB22-" -> "-b22-"
  cleaned = cleaned.replace(/-an?b(\d+)-/i, '-b$1-');

  // Collapse consecutive hyphens / whitespace
  cleaned = cleaned.replace(/[-_\s]+/g, '-').replace(/^-+|-+$/g, '');

  return cleaned.toLowerCase();
}

/**
 * Normalizes assignment name by stripping "(Status / Score)" suffix,
 * trimming whitespace and lowercasing for curriculum matching.
 */
export function normalizeAssignmentName(rawName: string): string {
  if (!rawName) return '';
  return rawName
    .replace(/\s*\(Status\s*\/\s*Score\)/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Extracts canonical batch key following the strict hierarchy:
 * 1. User-confirmed batch name/code
 * 2. Session title regex /([A-Z]{2,4})-AN?B(\d+)/i (case-insensitive)
 * 3. Filename hint
 */
export function extractBatchKey(
  userBatchName: string,
  sessionTitles: string[] = [],
  fileName?: string
): string {
  // 1. Scan session titles for pattern like TN-DA-ANB22 or DA-ANB22 or DA-B22
  for (const title of sessionTitles) {
    if (!title) continue;
    // Match e.g. TN-DA-ANB22 or DA-ANB22 or DA-B22 or TN-AFSD-ANB49
    const fullMatch = title.match(/(?:TN-)?([A-Za-z]{2,4})-(?:AN?B|B)(\d+)/i);
    if (fullMatch) {
      const prog = fullMatch[1].toUpperCase();
      const num = fullMatch[2];
      return `${prog}-B${num}`;
    }

    // Match just ANB22 or B22 in title
    const batchOnlyMatch = title.match(/\b(?:AN?B|B)(\d+)\b/i);
    if (batchOnlyMatch) {
      const num = batchOnlyMatch[1];
      const prog = userBatchName ? userBatchName.trim().toUpperCase() : 'BATCH';
      return `${prog}-B${num}`;
    }
  }

  // 2. Scan filename hint: e.g. B22-27-10.xlsx or DA-B22.xlsx
  if (fileName) {
    const fnMatch = fileName.match(/(?:([A-Za-z]{2,4})[-_])?(?:AN?B|B)(\d+)/i);
    if (fnMatch) {
      const prog = fnMatch[1]
        ? fnMatch[1].toUpperCase()
        : userBatchName
        ? userBatchName.trim().toUpperCase()
        : 'BATCH';
      const num = fnMatch[2];
      return `${prog}-B${num}`;
    }
  }

  // 3. Fallback to user batch name
  const clean = userBatchName ? userBatchName.trim().toUpperCase() : 'UNKNOWN_BATCH';
  // If user batch has ANB22 / B22, normalize it
  const userMatch = clean.match(/(?:([A-Za-z]{2,4})[-_])?(?:AN?B|B)(\d+)/i);
  if (userMatch) {
    const prog = userMatch[1] ? userMatch[1].toUpperCase() : 'BATCH';
    return `${prog}-B${userMatch[2]}`;
  }

  return clean;
}

/**
 * Builds a fingerprint on-demand from database rows for legacy snapshots
 */
export async function buildFingerprintFromStoredSnapshot(
  snapshotId: string
): Promise<SnapshotFingerprint | null> {
  const db = getDb();

  const snap = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, snapshotId),
  });
  if (!snap) return null;

  const batch = await db.query.batches.findFirst({
    where: eq(batches.id, snap.batchId),
  });
  if (!batch) return null;

  let fileHash = 'legacy-hash';
  if (snap.uploadId) {
    const upload = await db.query.uploads.findFirst({
      where: eq(uploads.id, snap.uploadId),
    });
    if (upload) fileHash = upload.fileHash;
  }

  // Fetch sessions
  const snapSessions = await db.query.sessions.findMany({
    where: eq(sessions.snapshotId, snapshotId),
  });
  const sessionTitles = snapSessions.map((s) => s.title);
  const sessionTitlesWithoutDates = Array.from(
    new Set(sessionTitles.map(normalizeSessionTitleWithoutDate))
  ).sort();

  // Determine canonical batch key
  const batchKey = extractBatchKey(batch.name, sessionTitles);

  // Fetch assignment items
  const items = await db.query.assignmentItems.findMany({
    where: eq(assignmentItems.snapshotId, snapshotId),
  });
  const assignmentNames = Array.from(
    new Set(items.map((i) => normalizeAssignmentName(i.name)))
  ).sort();

  // Fetch weekly consumption
  const weeks = await db.query.weeklyConsumption.findMany({
    where: eq(weeklyConsumption.snapshotId, snapshotId),
  });
  const weekNumbers = Array.from(new Set(weeks.map((w) => w.weekNo))).sort((a, b) => a - b);

  // Fetch student snapshots + students
  const studentRows = await db
    .select({
      externalStudentId: students.externalStudentId,
      phoneE164: students.phoneE164,
      name: students.name,
    })
    .from(studentSnapshots)
    .innerJoin(students, eq(studentSnapshots.studentId, students.id))
    .where(eq(studentSnapshots.snapshotId, snapshotId));

  const learners: LearnerIdentitySignature[] = studentRows.map((s) => ({
    studentId: (s.externalStudentId || '').trim(),
    phoneE164: normalizePhone(s.phoneE164),
    nameNormalized: normalizeName(s.name),
    displayName: s.name,
  }));

  const sheets = [
    'Cumulative Report',
    'Assignments',
    'Content Consumption',
    'Live Attendance',
    'Attendance (Live+Recording)',
  ];

  const coreColumns: Record<string, string[]> = {
    'Cumulative Report': [
      'Student ID',
      'Name',
      'Phone',
      'Total Consumption %',
      'Assignment Submission %',
      'Live Class %',
    ],
    Assignments: ['Student ID', 'Name', 'Phone'],
    'Content Consumption': ['Student ID', 'Name', 'Phone'],
    'Live Attendance': ['Name', 'Phone'],
    'Attendance (Live+Recording)': ['Name', 'Phone'],
  };

  return {
    version: 1,
    snapshotId: snap.id,
    batchId: snap.batchId,
    batchKey,
    reportDate: snap.snapshotDate,
    fileHash,
    sheets,
    coreColumns,
    assignmentNames,
    sessionTitlesWithoutDates,
    weekNumbers,
    learners,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Executes all 6 strict compatibility checks between Left (older) and Right (newer).
 * Returns isComparable = true ONLY if every single check passes.
 */
export function checkCompatibility(
  left: SnapshotFingerprint | null | undefined,
  right: SnapshotFingerprint | null | undefined
): CompatibilityResult {
  const checks: CompatibilityCheckItem[] = [];

  // Check 1: Fingerprint Validity
  if (!left || !right) {
    checks.push({
      name: 'fingerprint_valid',
      passed: false,
      detail: 'This report cannot be verified for comparison. Re-upload it.',
    });
    return {
      isComparable: false,
      shortReason: 'This report cannot be verified for comparison. Re-upload it.',
      checks,
    };
  }

  checks.push({
    name: 'fingerprint_valid',
    passed: true,
    detail: 'Both report fingerprints verified successfully.',
  });

  // Check 2: Same Batch (batch_id & batch_key)
  const leftBatch = (left.batchKey || '').toUpperCase().trim();
  const rightBatch = (right.batchKey || '').toUpperCase().trim();
  const sameBatch = left.batchId === right.batchId && leftBatch === rightBatch;

  if (!sameBatch) {
    const detail = `These reports belong to different batches (${leftBatch || 'Unknown'} and ${
      rightBatch || 'Unknown'
    }).`;
    checks.push({
      name: 'same_batch',
      passed: false,
      detail,
      metadata: { leftBatch, rightBatch },
    });
  } else {
    checks.push({
      name: 'same_batch',
      passed: true,
      detail: `Both reports belong to batch ${leftBatch}.`,
    });
  }

  // Check 3: Different Report Dates
  if (left.reportDate === right.reportDate) {
    checks.push({
      name: 'different_dates',
      passed: false,
      detail: 'Both reports have the same date. Choose reports with different dates.',
      metadata: { date: left.reportDate },
    });
  } else {
    checks.push({
      name: 'different_dates',
      passed: true,
      detail: `Report dates differ (Left: ${left.reportDate}, Right: ${right.reportDate}).`,
    });
  }

  // Check 4: Same Required Sheets and Core Columns
  const requiredSheets = [
    'Cumulative Report',
    'Assignments',
    'Content Consumption',
    'Live Attendance',
    'Attendance (Live+Recording)',
  ];
  const missingSheetsLeft = requiredSheets.filter((s) => !left.sheets.includes(s));
  const missingSheetsRight = requiredSheets.filter((s) => !right.sheets.includes(s));

  if (missingSheetsLeft.length > 0 || missingSheetsRight.length > 0) {
    const missing = Array.from(new Set([...missingSheetsLeft, ...missingSheetsRight]));
    checks.push({
      name: 'sheets_and_columns',
      passed: false,
      detail: `Course structure differs: required sheet(s) missing [${missing.join(', ')}].`,
      metadata: { missing },
    });
  } else {
    checks.push({
      name: 'sheets_and_columns',
      passed: true,
      detail: 'All 5 required sheets and core columns are present in both reports.',
    });
  }

  // Check 5: Curriculum Compatibility
  // Every assignment, session title (without date), and week in LEFT must exist in RIGHT.
  // Extras in RIGHT are allowed and marked "New".
  const rightAssignmentSet = new Set(right.assignmentNames);
  const missingAssignments = left.assignmentNames.filter((a) => !rightAssignmentSet.has(a));

  const rightSessionSet = new Set(right.sessionTitlesWithoutDates);
  const missingSessions = left.sessionTitlesWithoutDates.filter((s) => !rightSessionSet.has(s));

  const rightWeekSet = new Set(right.weekNumbers);
  const missingWeeks = left.weekNumbers.filter((w) => !rightWeekSet.has(w));

  const totalMissingCurriculum =
    missingAssignments.length + missingSessions.length + missingWeeks.length;

  if (totalMissingCurriculum > 0) {
    const parts: string[] = [];
    if (missingAssignments.length > 0) {
      parts.push(`${missingAssignments.length} assignment(s)`);
    }
    if (missingSessions.length > 0) {
      parts.push(`${missingSessions.length} session(s)`);
    }
    if (missingWeeks.length > 0) {
      parts.push(`${missingWeeks.length} week(s)`);
    }
    const detail = `Course structure differs: ${parts.join(
      ', '
    )} from the left report are missing in the right report.`;
    checks.push({
      name: 'curriculum_compatible',
      passed: false,
      detail,
      metadata: { missingAssignments, missingSessions, missingWeeks },
    });
  } else {
    const extraAssignments = right.assignmentNames.filter(
      (a) => !new Set(left.assignmentNames).has(a)
    );
    const extraSessions = right.sessionTitlesWithoutDates.filter(
      (s) => !new Set(left.sessionTitlesWithoutDates).has(s)
    );
    const extraWeeks = right.weekNumbers.filter((w) => !new Set(left.weekNumbers).has(w));
    checks.push({
      name: 'curriculum_compatible',
      passed: true,
      detail: `Curriculum compatible. ${
        extraAssignments.length + extraSessions.length + extraWeeks.length > 0
          ? `Right report includes ${extraAssignments.length} new assignment(s), ${extraSessions.length} new session(s), ${extraWeeks.length} new week(s).`
          : 'Exact curriculum match.'
      }`,
      metadata: { extraAssignments, extraSessions, extraWeeks },
    });
  }

  // Check 6: 100% Learner Match
  // Priority: Student ID -> Normalized Phone (E.164) -> Normalized Name
  const matchLearner = (
    needle: LearnerIdentitySignature,
    haystack: LearnerIdentitySignature[]
  ): boolean => {
    return haystack.some((candidate) => {
      if (needle.studentId && candidate.studentId) {
        return needle.studentId === candidate.studentId;
      }
      if (needle.phoneE164 && candidate.phoneE164) {
        return needle.phoneE164 === candidate.phoneE164;
      }
      if (needle.nameNormalized && candidate.nameNormalized) {
        return needle.nameNormalized === candidate.nameNormalized;
      }
      return false;
    });
  };

  const onlyInLeft = left.learners.filter((l) => !matchLearner(l, right.learners));
  const onlyInRight = right.learners.filter((r) => !matchLearner(r, left.learners));

  if (onlyInLeft.length > 0 || onlyInRight.length > 0) {
    const detail = `Learners do not match: ${onlyInLeft.length} only in the left report, ${onlyInRight.length} only in the right report.`;
    checks.push({
      name: 'learners_match_100',
      passed: false,
      detail,
      metadata: {
        onlyInLeft: onlyInLeft.map((l) => l.displayName || l.studentId || l.phoneE164),
        onlyInRight: onlyInRight.map((r) => r.displayName || r.studentId || r.phoneE164),
      },
    });
  } else {
    checks.push({
      name: 'learners_match_100',
      passed: true,
      detail: `100% learner match (${left.learners.length} learners present in both reports).`,
    });
  }

  const isComparable = checks.every((c) => c.passed);

  let shortReason: string | undefined;
  if (!isComparable) {
    const failedCheck = checks.find((c) => !c.passed);
    shortReason = failedCheck?.detail;
  }

  return {
    isComparable,
    shortReason,
    checks,
  };
}
