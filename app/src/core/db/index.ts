import Dexie, { type EntityTable } from 'dexie';
import type {
  Batch,
  Student,
  Snapshot,
  StudentSnapshot,
  AssignmentResult,
  WeeklyConsumption,
  Session,
  AttendanceRecord,
  FollowUp,
  AppSettings,
} from '@/types';

export interface SettingItem {
  key: string;
  value: unknown;
}

export class AppDatabase extends Dexie {
  batches!: EntityTable<Batch, 'id'>;
  students!: EntityTable<Student, 'id'>;
  snapshots!: EntityTable<Snapshot, 'id'>;
  studentSnapshots!: EntityTable<StudentSnapshot, 'id'>;
  assignmentResults!: EntityTable<AssignmentResult, 'id'>;
  weeklyConsumption!: EntityTable<WeeklyConsumption, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  attendance!: EntityTable<AttendanceRecord, 'id'>;
  followups!: EntityTable<FollowUp, 'id'>;
  settings!: EntityTable<SettingItem, 'key'>;

  constructor() {
    super('StudentProgressDB');
    this.version(1).stores({
      batches: 'id, name, externalBatchId, createdAt',
      students: 'id, externalStudentId, name, phoneE164',
      snapshots: 'id, batchId, snapshotDate, fileHash, parserVersion, [batchId+snapshotDate]',
      studentSnapshots: 'id, snapshotId, studentId, segment, [snapshotId+studentId]',
      assignmentResults: 'id, snapshotId, studentId, assignmentName, [snapshotId+studentId]',
      weeklyConsumption: 'id, snapshotId, studentId, weekNo, [snapshotId+studentId]',
      sessions: 'id, snapshotId, title, sessionDate',
      attendance: 'id, sessionId, studentId, [sessionId+studentId]',
      followups: 'id, studentId, snapshotId, status, updatedAt, [studentId+snapshotId]',
      settings: 'key',
    });
  }
}

export const db = new AppDatabase();

export const DEFAULT_SETTINGS: AppSettings = {
  highThreshold: 80,
  mediumThreshold: 50,
  deltaTolerance: 2,
  maskPii: false,
};

export async function getSettings(): Promise<AppSettings> {
  const item = await db.settings.get('app_settings');
  if (!item || !item.value) {
    return DEFAULT_SETTINGS;
  }
  return { ...DEFAULT_SETTINGS, ...(item.value as Partial<AppSettings>) };
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await db.settings.put({ key: 'app_settings', value: updated });
  return updated;
}

export async function clearAllLocalData(): Promise<void> {
  try {
    await Promise.all([
      db.batches.clear(),
      db.students.clear(),
      db.snapshots.clear(),
      db.studentSnapshots.clear(),
      db.assignmentResults.clear(),
      db.weeklyConsumption.clear(),
      db.sessions.clear(),
      db.attendance.clear(),
      db.followups.clear(),
    ]);
  } catch (err) {
    console.error('Failed to clear local DB cache:', err);
  }
}

