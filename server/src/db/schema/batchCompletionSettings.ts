import { pgTable, uuid, integer, timestamp, numeric, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { batches } from './index.js';

export const batchCompletionSettings = pgTable(
  'batch_completion_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' })
      .unique(),
    minAssignments: integer('min_assignments').default(70).notNull(),
    minContent: integer('min_content').default(60).notNull(),
    minAttendance: integer('min_attendance').default(50).notNull(),
    wAssignments: integer('w_assignments').default(50).notNull(),
    wContent: integer('w_content').default(30).notNull(),
    wAttendance: integer('w_attendance').default(20).notNull(),
    tooEarlyMinDue: integer('too_early_min_due').default(3).notNull(),
    tooEarlyMinElapsedPct: integer('too_early_min_elapsed_pct').default(25).notNull(),
    catchupLimit: numeric('catchup_limit', { precision: 4, scale: 2 }).default('2.00').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'chk_batch_completion_settings_minimums',
      sql`${t.minAssignments} >= 0 AND ${t.minAssignments} <= 100 AND ${t.minContent} >= 0 AND ${t.minContent} <= 100 AND ${t.minAttendance} >= 0 AND ${t.minAttendance} <= 100`
    ),
    check(
      'chk_batch_completion_settings_weights',
      sql`${t.wAssignments} >= 0 AND ${t.wContent} >= 0 AND ${t.wAttendance} >= 0 AND (${t.wAssignments} + ${t.wContent} + ${t.wAttendance} = 100)`
    ),
    check(
      'chk_batch_completion_settings_too_early',
      sql`${t.tooEarlyMinDue} >= 1 AND ${t.tooEarlyMinElapsedPct} >= 0 AND ${t.tooEarlyMinElapsedPct} <= 100`
    ),
    check(
      'chk_batch_completion_settings_catchup_limit',
      sql`${t.catchupLimit} > 0`
    ),
  ]
);

export type BatchCompletionSettings = typeof batchCompletionSettings.$inferSelect;
export type NewBatchCompletionSettings = typeof batchCompletionSettings.$inferInsert;

