/**
 * Core Data Models & Schemas
 */

export type SegmentType = 'High' | 'Medium' | 'Low';

export interface Batch {
  id: string;
  name: string;
  externalBatchId?: string;
  createdAt: number;
}

export interface Student {
  id: string; // Internal unique ID (e.g. std_7715491)
  externalStudentId: string; // LMS Student ID or User ID (e.g. "7715491")
  name: string;
  phoneE164: string; // Normalized E.164 phone
}

export interface Snapshot {
  id: string;
  batchId: string;
  snapshotDate: string; // ISO format: YYYY-MM-DD
  fileHash: string; // SHA-256 hash of the uploaded .xlsx
  parserVersion: string;
  uploadedAt: number;
  fileName: string;
}

export interface StudentMetrics {
  totalConsumptionPct: number;
  videoPct: number;
  pdfPct: number;
  quizSubmissionPct: number;
  flashCardsPct: number;
  aiContentPct: number;
  assignmentSubmissionPct: number;
  assignmentAggregateScorePct: number;
  liveClassPct: number;
  liveOrRecordingPct: number;
  // Raw counts
  pdfTotal: number;
  pdfConsumed: number;
  videoTotal: number;
  videoConsumed: number;
  quizTotal: number;
  quizAttended: number;
  flashCardsTotal: number;
  flashCardsConsumed: number;
  aiContentTotal: number;
  aiContentAttempted: number;
  assignmentsTotal: number;
  assignmentsSubmitted: number;
  liveClassAttended: number;
  liveClassTotal: number;
  liveOrRecordingConsumed: number;
}

export interface StudentSnapshot {
  id: string;
  snapshotId: string;
  studentId: string;
  metrics: StudentMetrics;
  segment: SegmentType;
  raw?: Record<string, string | number>;
}

export type AssignmentStatus = 'PASSED' | 'FAILED' | 'SUBMISSION_PENDING' | 'DELAYED' | 'NOT_SUBMITTED' | string;

export interface AssignmentResult {
  id: string;
  snapshotId: string;
  studentId: string;
  assignmentName: string;
  status: AssignmentStatus;
  score: number | null;
  maxScore: number | null;
}

export interface WeeklyConsumption {
  id: string;
  snapshotId: string;
  studentId: string;
  weekNo: number;
  consumed: number;
  total: number;
}

export interface Session {
  id: string;
  snapshotId: string;
  title: string;
  sessionDate: string; // YYYY-MM-DD
  originalColumn: string;
  orderIndex: number;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'PARTIAL' | string;

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  liveStatus: AttendanceStatus;
  liveOrRecStatus: AttendanceStatus;
}

export interface FollowUp {
  id: string;
  studentId: string;
  snapshotId: string;
  note: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED';
  updatedAt: number;
}

export interface AppSettings {
  highThreshold: number; // default 80
  mediumThreshold: number; // default 50
  deltaTolerance: number; // default 2 percentage points
  maskPii: boolean; // default false
  passcodeHash?: string; // optional salted SHA-256 hash
}

// Ingestion & Parsing types
export interface ValidationError {
  sheet: string;
  row?: number;
  column?: string;
  message: string;
  blocking: true;
}

export interface ValidationWarning {
  sheet: string;
  row?: number;
  column?: string;
  message: string;
  blocking: false;
}

export interface UnmatchedRow {
  sheet: string;
  identifier: string; // phone or name
  raw: Record<string, string | number>;
  reason: string;
}

export interface ParseResult {
  success: boolean;
  fileHash: string;
  fileName: string;
  detectedBatchName?: string;
  sheetsFound: string[];
  totalStudents: number;
  students: Student[];
  metrics: { studentId: string; metrics: StudentMetrics; segment: SegmentType }[];
  assignmentResults: Omit<AssignmentResult, 'id' | 'snapshotId'>[];
  weeklyConsumption: Omit<WeeklyConsumption, 'id' | 'snapshotId'>[];
  sessions: Omit<Session, 'id' | 'snapshotId'>[];
  attendance: Omit<AttendanceRecord, 'id'>[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
  unmatchedRows: UnmatchedRow[];
  averages: {
    assignmentSubmissionAvg: number;
    totalConsumptionAvg: number;
    liveAttendanceAvg: number;
    liveOrRecAvg: number;
  };
}

// Comparison & Analytics types
export type MovementType = 'IMPROVED' | 'SAME' | 'DECLINED';

export interface StudentComparison {
  studentId: string;
  studentName: string;
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

export interface AtRiskStudent {
  studentId: string;
  studentName: string;
  phoneE164: string;
  reasons: string[];
  assignmentSubmissionPct: number;
  totalConsumptionPct: number;
  liveClassPct: number;
  liveOrRecordingPct: number;
  segment: SegmentType;
}

export interface StoredReportFile {
  id: string;
  batchId: string;
  snapshotId: string | null;
  kind: 'lms_cumulative' | 'academic';
  version: number;
  isCurrent: boolean;
  originalName: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
  uploaderName?: string | null;
  uploaderEmail?: string | null;
  snapshotDate?: string | null;
}

export interface AssignmentScheduleItem {
  id?: string | null;
  lmsAssignmentName: string;
  roadmapKey: string | null;
  matchedRoadmapTitle?: string | null;
  confidence?: 'high' | 'medium' | 'low' | 'none';
  type: 'regular' | 'module_end';
  dueDate: string | null;
  startDate?: string | null;
  defaultDueDate?: string | null;
  suggestedDueDate?: string | null;
}

export interface RoadmapReferenceItem {
  id: string;
  topic: string;
  title: string;
  kind: string;
  date: string | null;
  week: string;
  day: string;
}

export interface AssignmentScheduleResponse {
  batchId: string;
  batchStartDate?: string | null;
  hasAcademicFile: boolean;
  roadmapRange: { minDate: string | null; maxDate: string | null };
  roadmapItems: RoadmapReferenceItem[];
  schedule: AssignmentScheduleItem[];
}

export type SubmissionLatenessStatus =
  | 'on_time'
  | 'late'
  | 'possibly_late'
  | 'unknown'
  | 'not_submitted'
  | 'no_due_date';

export interface LearnerLatenessRecord {
  studentId: string;
  studentName: string;
  phoneE164: string;
  lmsAssignmentName: string;
  status: SubmissionLatenessStatus;
  submissionDateEstimate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  windowText: string | null;
  firstSubmittedSnapshotDate: string | null;
  lastPendingSnapshotDate: string | null;
  rawStatus: string;
  score: number | null;
  dueDate: string | null;
}

export type LearnerAssignmentStatus = LearnerLatenessRecord;

export interface AssignmentLatenessSummary {
  lmsAssignmentName: string;
  roadmapKey: string | null;
  type: 'regular' | 'module_end';
  dueDate: string | null;
  hasDueDate: boolean;
  totalLearners: number;
  submittedCount: number;
  onTimeCount: number;
  lateCount: number;
  possiblyLateCount: number;
  unknownCount: number;
  notSubmittedCount: number;
  learners: LearnerLatenessRecord[];
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

// Stage 3: Drop-out Risk Analytics Types
export type DropoutTier = 'active' | 'slipping' | 'at_risk' | 'likely_dropped_out' | 'too_early';

export interface DropoutSettings {
  slippingAt: number;
  atRiskAt: number;
  dropoutAt: number;
  minDue: number;
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
  settings?: DropoutSettings;
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


// Stage 4: Completion Forecast Types
export type CompletionAreaStatus = 'Met' | 'Behind';
export type CompletionOutlook = 'On track' | 'Recoverable' | 'Unlikely' | 'Too early';

export interface CompletionAreaMetric {
  currentPct: number;
  minimumPct: number;
  status: CompletionAreaStatus;
  currentItems: number;
  totalItems: number;
  neededItems: number;
  requiredPacePerWeek: number | null;
  normalPacePerWeek: number;
  catchupMultiple: number | null;
  needsText: string;
}

export interface CompletionLearnerSummary {
  studentId: string;
  name: string;
  phoneE164: string;
  assignments: CompletionAreaMetric;
  content: CompletionAreaMetric;
  attendance: CompletionAreaMetric;
  readinessScore: number;
  outlook: CompletionOutlook;
}

export interface CompletionRoadmapInfo {
  version: string | null;
  startDate: string;
  endDate: string;
  reportDate: string;
  totalDays: number;
  elapsedDays: number;
  daysToEnd: number;
  elapsedPct: number;
  weeksLeft: number;
  roadmapWeeks: number;
  totalRegularAssignments: number;
  regularAssignmentsDue: number;
  totalLiveSessions: number;
  remainingLiveSessions: number;
  totalHeldLiveSessions: number;
  totalContentReleased: number;
  note: string | null;
}

export interface BatchCompletionSettings {
  minAssignments: number;
  minContent: number;
  minAttendance: number;
  wAssignments: number;
  wContent: number;
  wAttendance: number;
  tooEarlyMinDue: number;
  tooEarlyMinElapsedPct: number;
  catchupLimit: number;
}

export interface BatchCompletionReport {
  summary: {
    totalLearners: number;
    onTrack: number;
    recoverable: number;
    unlikely: number;
    tooEarly: number;
    forecastFloor: number;
    forecastCeiling: number;
    forecastTotal: number;
    rangeSentence: string | null;
  };
  roadmap: CompletionRoadmapInfo | null;
  settings: BatchCompletionSettings;
  learners: CompletionLearnerSummary[];
  histogram: { bin: string; count: number }[];
}
