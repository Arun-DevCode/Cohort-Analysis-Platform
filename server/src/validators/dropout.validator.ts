import { z } from 'zod';

export const dropoutQuerySchema = z.object({
  snapshotId: z.string().min(1, 'snapshotId is required'),
});

export const updateDropoutSettingsSchema = z
  .object({
    slippingAt: z.number().int().min(1, 'slippingAt must be at least 1'),
    atRiskAt: z.number().int().min(1, 'atRiskAt must be at least 1'),
    dropoutAt: z.number().int().min(1, 'dropoutAt must be at least 1'),
    minDue: z.number().int().min(1, 'minDue must be at least 1'),
  })
  .superRefine((data, ctx) => {
    if (data.slippingAt >= data.atRiskAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['atRiskAt'],
        message: 'atRiskAt must be strictly greater than slippingAt',
      });
    }
    if (data.atRiskAt >= data.dropoutAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dropoutAt'],
        message: 'dropoutAt must be strictly greater than atRiskAt',
      });
    }
  });

export type DropoutQueryInput = z.infer<typeof dropoutQuerySchema>;
export type UpdateDropoutSettingsInput = z.infer<typeof updateDropoutSettingsSchema>;

