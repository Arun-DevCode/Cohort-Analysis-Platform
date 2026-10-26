import { z } from 'zod';

export const createFollowupSchema = z.object({
  studentId: z.string().uuid(),
  snapshotId: z.string().uuid().optional(),
  note: z.string().min(1, 'Note cannot be empty').max(5000),
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
});

export const updateFollowupSchema = z.object({
  note: z.string().min(1).max(5000).optional(),
  status: z.enum(['open', 'in_progress', 'done']).optional(),
});

export const queryFollowupsSchema = z.object({
  studentId: z.string().uuid().optional(),
  snapshotId: z.string().uuid().optional(),
  status: z.enum(['open', 'in_progress', 'done']).optional(),
  batchId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFollowupInput = z.infer<typeof createFollowupSchema>;
export type UpdateFollowupInput = z.infer<typeof updateFollowupSchema>;
export type QueryFollowupsInput = z.infer<typeof queryFollowupsSchema>;
