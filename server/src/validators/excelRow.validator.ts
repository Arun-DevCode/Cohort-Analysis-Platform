import { z } from 'zod';

export interface RowValidationError {
  sheet: string;
  row?: number;
  column?: string;
  message: string;
  blocking: boolean;
}

export const percentSchema = z.coerce.number().min(0).max(100);

export const cumulativeStudentRowSchema = z
  .object({
    studentId: z.string().min(1, 'Student ID is required'),
    name: z.string().min(1, 'Student Name is required'),
    phone: z.string().optional().nullable(),
    totalConsumptionPct: percentSchema,
    videoPct: percentSchema.default(0),
    pdfPct: percentSchema.default(0),
    quizSubmissionPct: percentSchema.default(0),
    flashCardsPct: percentSchema.default(0),
    aiContentPct: percentSchema.default(0),
    assignmentSubmissionPct: percentSchema,
    assignmentScorePct: percentSchema.default(0),
    liveClassPct: percentSchema,
    liveOrRecordingPct: percentSchema,
    pdfTotal: z.coerce.number().min(0).default(0),
    pdfConsumed: z.coerce.number().min(0).default(0),
    videoTotal: z.coerce.number().min(0).default(0),
    videoConsumed: z.coerce.number().min(0).default(0),
    quizTotal: z.coerce.number().min(0).default(0),
    quizAttended: z.coerce.number().min(0).default(0),
    assignmentsTotal: z.coerce.number().min(0).default(0),
    assignmentsSubmitted: z.coerce.number().min(0).default(0),
    liveClassTotal: z.coerce.number().min(0).default(0),
    liveClassAttended: z.coerce.number().min(0).default(0),
  })
  .refine((data) => data.pdfConsumed <= data.pdfTotal, {
    message: 'PDF consumed cannot exceed total',
    path: ['pdfConsumed'],
  })
  .refine((data) => data.videoConsumed <= data.videoTotal, {
    message: 'Video consumed cannot exceed total',
    path: ['videoConsumed'],
  })
  .refine((data) => data.assignmentsSubmitted <= data.assignmentsTotal, {
    message: 'Assignments submitted cannot exceed total',
    path: ['assignmentsSubmitted'],
  });

export type ValidatedCumulativeStudentRow = z.infer<typeof cumulativeStudentRowSchema>;
