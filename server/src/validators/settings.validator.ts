import { z } from 'zod';

export const thresholdsSchema = z.object({
  assignmentSubmissionAtRisk: z.coerce.number().min(0).max(100).default(60),
  consumptionAtRisk: z.coerce.number().min(0).max(100).default(50),
  liveAttendanceAtRisk: z.coerce.number().min(0).max(100).default(60),
  highSegmentMin: z.coerce.number().min(0).max(100).default(80),
  mediumSegmentMin: z.coerce.number().min(0).max(100).default(50),
});

export type Thresholds = z.infer<typeof thresholdsSchema>;

export const DEFAULT_THRESHOLDS: Thresholds = {
  assignmentSubmissionAtRisk: 60,
  consumptionAtRisk: 50,
  liveAttendanceAtRisk: 60,
  highSegmentMin: 80,
  mediumSegmentMin: 50,
};
