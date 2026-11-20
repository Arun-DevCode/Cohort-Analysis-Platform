import { z } from 'zod';

export const fileIdParamSchema = z.object({
  fileId: z.string().uuid('Invalid file ID format'),
});

export const deleteFileQuerySchema = z.object({
  confirm: z.string().refine((v) => v === 'true', {
    message: 'Deletion requires explicit confirm=true query parameter',
  }),
});

