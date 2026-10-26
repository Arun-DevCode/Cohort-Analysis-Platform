import { z } from 'zod';
import type { ValidationError, ValidationWarning } from '@/types';

export const StudentMetricsSchema = z.object({
  totalConsumptionPct: z.number().min(0).max(100),
  videoPct: z.number().min(0).max(100),
  pdfPct: z.number().min(0).max(100),
  quizSubmissionPct: z.number().min(0).max(100),
  flashCardsPct: z.number().min(0).max(100),
  aiContentPct: z.number().min(0).max(100),
  assignmentSubmissionPct: z.number().min(0).max(100),
  assignmentAggregateScorePct: z.number().min(0).max(100),
  liveClassPct: z.number().min(0).max(100),
  liveOrRecordingPct: z.number().min(0).max(100),
  pdfTotal: z.number().min(0),
  pdfConsumed: z.number().min(0),
  videoTotal: z.number().min(0),
  videoConsumed: z.number().min(0),
  quizTotal: z.number().min(0),
  quizAttended: z.number().min(0),
  flashCardsTotal: z.number().min(0),
  flashCardsConsumed: z.number().min(0),
  aiContentTotal: z.number().min(0),
  aiContentAttempted: z.number().min(0),
  assignmentsTotal: z.number().min(0),
  assignmentsSubmitted: z.number().min(0),
  liveClassAttended: z.number().min(0),
  liveClassTotal: z.number().min(0),
  liveOrRecordingConsumed: z.number().min(0),
});

export const REQUIRED_SHEETS = [
  'Cumulative Report',
  'Assignments',
  'Content Consumption',
  'Live Attendance',
  'Attendance (Live+Recording)',
] as const;

export function validateSheetsPresence(availableSheets: string[]): {
  errors: ValidationError[];
  matchedSheets: Record<string, string>;
} {
  const errors: ValidationError[] = [];
  const matchedSheets: Record<string, string> = {};

  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const req of REQUIRED_SHEETS) {
    const reqClean = clean(req);
    const found = availableSheets.find((sheet) => {
      const sClean = clean(sheet);
      return sClean === reqClean || sClean.includes(reqClean) || reqClean.includes(sClean);
    });

    if (found) {
      matchedSheets[req] = found;
    } else {
      errors.push({
        sheet: req,
        message: `Required sheet "${req}" is missing from workbook. Available sheets: [${availableSheets.join(', ')}]`,
        blocking: true,
      });
    }
  }

  return { errors, matchedSheets };
}

export function validateStudentRow(
  rowIdx: number,
  studentId: string,
  name: string,
  existingIds: Set<string>
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!studentId || studentId.trim() === '') {
    errors.push({
      sheet: 'Cumulative Report',
      row: rowIdx,
      column: 'Student ID',
      message: `Row ${rowIdx}: Missing Student ID.`,
      blocking: true,
    });
  } else if (existingIds.has(studentId)) {
    warnings.push({
      sheet: 'Cumulative Report',
      row: rowIdx,
      column: 'Student ID',
      message: `Row ${rowIdx}: Duplicate Student ID "${studentId}". Subsequent record will overwrite earlier one.`,
      blocking: false,
    });
  }

  if (!name || name.trim() === '') {
    warnings.push({
      sheet: 'Cumulative Report',
      row: rowIdx,
      column: 'Student Name',
      message: `Row ${rowIdx}: Missing student name for ID "${studentId}".`,
      blocking: false,
    });
  }

  return { errors, warnings };
}
