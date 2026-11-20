import { z } from 'zod';

export const updateCompletionSettingsSchema = z
  .object({
    minAssignments: z.number().int().min(0).max(100),
    minContent: z.number().int().min(0).max(100),
    minAttendance: z.number().int().min(0).max(100),
    wAssignments: z.number().int().min(0).max(100),
    wContent: z.number().int().min(0).max(100),
    wAttendance: z.number().int().min(0).max(100),
    tooEarlyMinDue: z.number().int().min(1),
    tooEarlyMinElapsedPct: z.number().int().min(0).max(100),
    catchupLimit: z.number().positive(),
  })
  .refine(
    (data) => data.wAssignments + data.wContent + data.wAttendance === 100,
    {
      message: 'Weights for assignments, content, and attendance must sum to exactly 100',
      path: ['wAssignments'],
    }
  );

export type UpdateCompletionSettingsInput = z.infer<typeof updateCompletionSettingsSchema>;

