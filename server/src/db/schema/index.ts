import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  date,
  integer,
  numeric,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  boolean,
  bigint,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const roleEnum = pgEnum('role', ['admin', 'manager', 'trainer']);
export const uploadStatusEnum = pgEnum('upload_status', ['processing', 'done', 'failed']);
export const segmentEnum = pgEnum('segment', ['high', 'medium', 'low']);
export const followupStatusEnum = pgEnum('followup_status', ['open', 'in_progress', 'done']);

// 1. Users
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().default(''),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Batches
export const batches = pgTable(
  'batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    externalBatchId: varchar('external_batch_id', { length: 100 }).notNull().unique(),
    startDate: date('start_date'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('batches_created_by_idx').on(t.createdBy),
  ]
);

// 3. Batch Trainers
export const batchTrainers = pgTable(
  'batch_trainers',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.userId] })]
);

// 4. Students
export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    externalStudentId: varchar('external_student_id', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    phoneE164: varchar('phone_e164', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('students_created_by_external_id_unique').on(t.createdBy, t.externalStudentId),
    index('students_created_by_idx').on(t.createdBy),
  ]
);

// 5. Batch Students
export const batchStudents = pgTable(
  'batch_students',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.studentId] })]
);

// 6. Uploads
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    status: uploadStatusEnum('status').default('processing').notNull(),
    errorReport: jsonb('error_report'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('uploads_batch_id_idx').on(t.batchId),
  ]
);

// 7. Snapshots
export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    uploadId: uuid('upload_id').references(() => uploads.id, { onDelete: 'set null' }),
    snapshotDate: date('snapshot_date').notNull(),
    parserVersion: integer('parser_version').default(1).notNull(),
  },
  (t) => [
    uniqueIndex('snapshots_batch_date_unique').on(t.batchId, t.snapshotDate),
    index('snapshots_batch_id_idx').on(t.batchId),
  ]
);

// 8. Student Snapshots
export const studentSnapshots = pgTable(
  'student_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => snapshots.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    totalConsumptionPct: numeric('total_consumption_pct', { precision: 5, scale: 2 }).notNull(),
    videoPct: numeric('video_pct', { precision: 5, scale: 2 }).default('0').notNull(),
    pdfPct: numeric('pdf_pct', { precision: 5, scale: 2 }).default('0').notNull(),
    quizPct: numeric('quiz_pct', { precision: 5, scale: 2 }).default('0').notNull(),
    flashcardsPct: numeric('flashcards_pct', { precision: 5, scale: 2 }).default('0').notNull(),
    aiContentPct: numeric('ai_content_pct', { precision: 5, scale: 2 }).default('0').notNull(),
    assignmentSubmissionPct: numeric('assignment_submission_pct', { precision: 5, scale: 2 }).notNull(),
    assignmentScorePct: numeric('assignment_score_pct', { precision: 5, scale: 2 }).default('0').notNull(),
    livePct: numeric('live_pct', { precision: 5, scale: 2 }).notNull(),
    liveOrRecPct: numeric('live_or_rec_pct', { precision: 5, scale: 2 }).notNull(),
    assignmentsTotal: integer('assignments_total').default(0).notNull(),
    assignmentsSubmitted: integer('assignments_submitted').default(0).notNull(),
    assignmentsDelayed: integer('assignments_delayed').default(0).notNull(),
    liveTotal: integer('live_total').default(0).notNull(),
    liveAttended: integer('live_attended').default(0).notNull(),
    segment: segmentEnum('segment').notNull(),
    raw: jsonb('raw'),
  },
  (t) => [
    index('student_snapshots_snapshot_student_idx').on(t.snapshotId, t.studentId),
  ]
);

// 9. Assignment Items
export const assignmentItems = pgTable('assignment_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  snapshotId: uuid('snapshot_id')
    .notNull()
    .references(() => snapshots.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
});

// 10. Assignment Results
export const assignmentResults = pgTable('assignment_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentItemId: uuid('assignment_item_id')
    .notNull()
    .references(() => assignmentItems.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull(),
  score: numeric('score', { precision: 6, scale: 2 }),
  maxScore: numeric('max_score', { precision: 6, scale: 2 }),
});

// 11. Weekly Consumption
export const weeklyConsumption = pgTable('weekly_consumption', {
  id: uuid('id').primaryKey().defaultRandom(),
  snapshotId: uuid('snapshot_id')
    .notNull()
    .references(() => snapshots.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  weekNo: integer('week_no').notNull(),
  consumed: integer('consumed').default(0).notNull(),
  total: integer('total').default(0).notNull(),
});

// 12. Sessions
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  snapshotId: uuid('snapshot_id')
    .notNull()
    .references(() => snapshots.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  sessionDate: date('session_date'),
});

// 13. Attendance
export const attendance = pgTable('attendance', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  liveStatus: varchar('live_status', { length: 50 }).notNull(),
  liveOrRecStatus: varchar('live_or_rec_status', { length: 50 }).notNull(),
});

// 14. Follow-ups
export const followups = pgTable('followups', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  snapshotId: uuid('snapshot_id').references(() => snapshots.id, { onDelete: 'set null' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  note: text('note').notNull(),
  status: followupStatusEnum('status').default('open').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 15. Settings
export const settings = pgTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
});

// 16. Audit Logs
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  entity: varchar('entity', { length: 100 }).notNull(),
  entityId: varchar('entity_id', { length: 100 }),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 17. Report Files
export const reportFiles = pgTable(
  'report_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    snapshotId: uuid('snapshot_id').references(() => snapshots.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 32 }).notNull(), // 'lms_cumulative' | 'academic'
    version: integer('version').notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    objectKey: text('object_key').notNull(),
    contentType: varchar('content_type', { length: 100 })
      .default('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('report_files_batch_kind_sha256_unique').on(t.batchId, t.kind, t.sha256),
    index('report_files_batch_kind_idx').on(t.batchId, t.kind),
    index('report_files_snapshot_id_idx').on(t.snapshotId),
  ]
);

// 18. Assignment Schedule
export const assignmentSchedule = pgTable(
  'assignment_schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    lmsAssignmentName: varchar('lms_assignment_name', { length: 255 }).notNull(),
    roadmapKey: varchar('roadmap_key', { length: 255 }),
    type: varchar('type', { length: 32 }).default('regular').notNull(),
    dueDate: date('due_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('assignment_schedule_batch_lms_name_unique').on(t.batchId, t.lmsAssignmentName),
    index('assignment_schedule_batch_id_idx').on(t.batchId),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  createdBatches: many(batches),
  batchTrainers: many(batchTrainers),
  uploads: many(uploads),
  followups: many(followups),
  auditLogs: many(auditLogs),
  students: many(students),
}));

export const batchesRelations = relations(batches, ({ one, many }) => ({
  creator: one(users, {
    fields: [batches.createdBy],
    references: [users.id],
  }),
  trainers: many(batchTrainers),
  students: many(batchStudents),
  snapshots: many(snapshots),
  uploads: many(uploads),
  reportFiles: many(reportFiles),
  assignmentSchedules: many(assignmentSchedule),
}));

export const batchTrainersRelations = relations(batchTrainers, ({ one }) => ({
  batch: one(batches, {
    fields: [batchTrainers.batchId],
    references: [batches.id],
  }),
  user: one(users, {
    fields: [batchTrainers.userId],
    references: [users.id],
  }),
}));

export const batchStudentsRelations = relations(batchStudents, ({ one }) => ({
  batch: one(batches, {
    fields: [batchStudents.batchId],
    references: [batches.id],
  }),
  student: one(students, {
    fields: [batchStudents.studentId],
    references: [students.id],
  }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  creator: one(users, {
    fields: [students.createdBy],
    references: [users.id],
  }),
  batchStudents: many(batchStudents),
  studentSnapshots: many(studentSnapshots),
  assignmentResults: many(assignmentResults),
  weeklyConsumption: many(weeklyConsumption),
  attendance: many(attendance),
  followups: many(followups),
}));

export const studentSnapshotsRelations = relations(studentSnapshots, ({ one }) => ({
  snapshot: one(snapshots, {
    fields: [studentSnapshots.snapshotId],
    references: [snapshots.id],
  }),
  student: one(students, {
    fields: [studentSnapshots.studentId],
    references: [students.id],
  }),
}));

export const snapshotsRelations = relations(snapshots, ({ one, many }) => ({
  batch: one(batches, { fields: [snapshots.batchId], references: [batches.id] }),
  upload: one(uploads, { fields: [snapshots.uploadId], references: [uploads.id] }),
  studentSnapshots: many(studentSnapshots),
  assignmentItems: many(assignmentItems),
  weeklyConsumption: many(weeklyConsumption),
  sessions: many(sessions),
  followups: many(followups),
  reportFiles: many(reportFiles),
}));

export const reportFilesRelations = relations(reportFiles, ({ one }) => ({
  batch: one(batches, {
    fields: [reportFiles.batchId],
    references: [batches.id],
  }),
  snapshot: one(snapshots, {
    fields: [reportFiles.snapshotId],
    references: [snapshots.id],
  }),
  uploader: one(users, {
    fields: [reportFiles.uploadedBy],
    references: [users.id],
  }),
}));

export const assignmentScheduleRelations = relations(assignmentSchedule, ({ one }) => ({
  batch: one(batches, {
    fields: [assignmentSchedule.batchId],
    references: [batches.id],
  }),
}));

import { batchDropoutSettings } from './batchDropoutSettings.js';
export * from './batchDropoutSettings.js';
export const batchDropoutSettingsRelations = relations(batchDropoutSettings, ({ one }) => ({
  batch: one(batches, {
    fields: [batchDropoutSettings.batchId],
    references: [batches.id],
  }),
}));

import { batchCompletionSettings } from './batchCompletionSettings.js';
export * from './batchCompletionSettings.js';
export const batchCompletionSettingsRelations = relations(batchCompletionSettings, ({ one }) => ({
  batch: one(batches, {
    fields: [batchCompletionSettings.batchId],
    references: [batches.id],
  }),
}));
