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
