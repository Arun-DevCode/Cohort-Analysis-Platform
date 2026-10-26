import { z } from 'zod';

export const createBatchSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  externalBatchId: z.string().min(1, 'externalBatchId is required'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD').optional(),
});

export const updateBatchSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD').optional().nullable(),
});

export const assignTrainersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, 'At least one userId is required'),
});

export const batchIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type AssignTrainersInput = z.infer<typeof assignTrainersSchema>;
