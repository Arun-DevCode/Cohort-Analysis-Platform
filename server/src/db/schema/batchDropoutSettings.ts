import {
  pgTable,
  uuid,
  integer,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { batches } from './index.js';

export const batchDropoutSettings = pgTable(
  'batch_dropout_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    slippingAt: integer('slipping_at').notNull().default(1),
    atRiskAt: integer('at_risk_at').notNull().default(2),
    dropoutAt: integer('dropout_at').notNull().default(3),
    minDue: integer('min_due').notNull().default(3),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('batch_dropout_settings_batch_id_unique').on(t.batchId),
    check(
      'batch_dropout_settings_thresholds_check',
      sql`slipping_at >= 1 AND slipping_at < at_risk_at AND at_risk_at < dropout_at AND min_due >= 1`
    ),
  ]
);

export type BatchDropoutSettings = typeof batchDropoutSettings.$inferSelect;
export type NewBatchDropoutSettings = typeof batchDropoutSettings.$inferInsert;

