import ExcelJS from 'exceljs';
import {
  parsePercentage,
  parseNumber,
  parseAssignmentCell,
  parseWeekCell,
  extractSessionDate,
  normalizePhone,
  normalizeName,
} from '../../utils/normalizers.js';
import { worksheetToRows } from './parsers.js';
import {
  detectSheets,
  RequiredSheetName,
} from './detectSheets.js';
import {
  cumulativeStudentRowSchema,
  RowValidationError,
} from '../../validators/excelRow.validator.js';

export interface ResolvedStudent {
  externalStudentId: string;
  name: string;
  phoneE164: string;
  totalConsumptionPct: number;
  videoPct: number;
  pdfPct: number;
  quizPct: number;
  flashcardsPct: number;
  aiContentPct: number;
  assignmentSubmissionPct: number;
  assignmentScorePct: number;
  livePct: number;
  liveOrRecPct: number;
  assignmentsTotal: number;
  assignmentsSubmitted: number;
  assignmentsDelayed: number;
  liveTotal: number;
  liveAttended: number;
  segment: 'high' | 'medium' | 'low';
  raw: Record<string, unknown>;
}

export interface ParsedAssignmentItem {
  name: string;
}

export interface ParsedAssignmentResult {
  assignmentName: string;
  studentExternalId: string;
  status: string;
  score: number | null;
  maxScore: number | null;
}

export interface ParsedWeeklyConsumption {
  studentExternalId: string;
  weekNo: number;
  consumed: number;
  total: number;
}

export interface ParsedSession {
  title: string;
  sessionDate: string | null;
}

export interface ParsedAttendance {
  sessionTitle: string;
  studentExternalId: string;
  liveStatus: string;
  liveOrRecStatus: string;
}

export interface UnmatchedRow {
  sheet: string;
  identifier: string;
  reason: string;
  raw: Record<string, unknown>;
}

export interface IngestionResult {
  success: boolean;
  sheetsFound: string[];
  totalStudents: number;
  students: ResolvedStudent[];
  assignmentItems: ParsedAssignmentItem[];
  assignmentResults: ParsedAssignmentResult[];
  weeklyConsumption: ParsedWeeklyConsumption[];
  sessions: ParsedSession[];
  attendance: ParsedAttendance[];
  errors: RowValidationError[];
  warnings: RowValidationError[];
  unmatchedRows: UnmatchedRow[];
  averages: {
    assignmentSubmissionAvg: number;
    totalConsumptionAvg: number;
    liveAttendanceAvg: number;
    liveOrRecAvg: number;
  };
}

export function determineSegment(
  consumptionPct: number,
  highThreshold = 80,
  mediumThreshold = 50
): 'high' | 'medium' | 'low' {
  if (consumptionPct >= highThreshold) return 'high';
  if (consumptionPct >= mediumThreshold) return 'medium';
  return 'low';
}

export async function processWorkbook(
  workbook: ExcelJS.Workbook,
  thresholds = { high: 80, medium: 50 }
): Promise<IngestionResult> {
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  const { matchedSheets, errors: sheetErrors } = detectSheets(sheetNames);

  const errors: RowValidationError[] = [];
  const warnings: RowValidationError[] = [];
  const unmatchedRows: UnmatchedRow[] = [];

  if (sheetErrors.length > 0) {
    sheetErrors.forEach((err) => {
      errors.push({
        sheet: 'Workbook',
        message: err,
        blocking: true,
      });
    });

    return {
      success: false,
      sheetsFound: sheetNames,
      totalStudents: 0,
      students: [],
      assignmentItems: [],
      assignmentResults: [],
      weeklyConsumption: [],
      sessions: [],
      attendance: [],
      errors,
      warnings,
      unmatchedRows,
      averages: {
        assignmentSubmissionAvg: 0,
        totalConsumptionAvg: 0,
        liveAttendanceAvg: 0,
        liveOrRecAvg: 0,
      },
    };
  }

  // --- 1. Parse Cumulative Report ---
  const cumulativeSheet = workbook.getWorksheet(matchedSheets['Cumulative Report'])!;
  const cumulativeRows = worksheetToRows(cumulativeSheet);

  const studentsMap = new Map<string, ResolvedStudent>();
  const phoneToStudentId = new Map<string, string>();
  const nameToStudentId = new Map<string, string>();
  const seenStudentIds = new Set<string>();

  let rowIdx = 1;
  for (const row of cumulativeRows) {
    rowIdx++;
    const rawStudentId = String(row['Student ID'] || row['User ID'] || '').trim();
    const rawName = String(row['Student Name'] || row['Name'] || '').trim();
    const rawPhone = row['Phone'] ?? row['Phone number'];

    if (
      !rawStudentId ||
      rawStudentId.toUpperCase() === 'AVERAGE' ||
      rawStudentId.toUpperCase() === 'TOTAL'
    ) {
      continue;
    }

    if (seenStudentIds.has(rawStudentId)) {
      warnings.push({
        sheet: 'Cumulative Report',
        row: rowIdx,
        column: 'Student ID',
        message: `Duplicate student ID "${rawStudentId}". Overwriting earlier row.`,
        blocking: false,
      });
    }

    const phoneE164 = normalizePhone(rawPhone as string | number);
    const parsedRow = {
      studentId: rawStudentId,
      name: rawName,
      phone: phoneE164,
      totalConsumptionPct: parsePercentage(row['Total Consumption %']),
      videoPct: parsePercentage(row['Video %']),
      pdfPct: parsePercentage(row['PDF %']),
      quizSubmissionPct: parsePercentage(row['Quiz Submission %']),
      flashCardsPct: parsePercentage(row['Flash Cards %']),
      aiContentPct: parsePercentage(row['AI Content %']),
      assignmentSubmissionPct: parsePercentage(row['Assignment Submission %']),
      assignmentScorePct: parsePercentage(row['Assignment Aggregate Score %']),
      liveClassPct: parsePercentage(row['Live Class %']),
      liveOrRecordingPct: parsePercentage(row['Live Or Recording %']),
      pdfTotal: parseNumber(row['PDF Total']),
      pdfConsumed: parseNumber(row['PDF Consumed']),
      videoTotal: parseNumber(row['Video Total']),
      videoConsumed: parseNumber(row['Video Consumed']),
      quizTotal: parseNumber(row['Quiz Total']),
      quizAttended: parseNumber(row['Quiz Attended']),
      assignmentsTotal: parseNumber(row['Assignments Total']),
      assignmentsSubmitted: parseNumber(row['Assignments Submitted']),
      liveClassTotal: parseNumber(row['Live Class Total']),
      liveClassAttended: parseNumber(row['Live Class Attended']),
    };

    const validation = cumulativeStudentRowSchema.safeParse(parsedRow);
    if (!validation.success) {
      validation.error.errors.forEach((err) => {
        errors.push({
          sheet: 'Cumulative Report',
          row: rowIdx,
          column: err.path.join('.'),
          message: err.message,
          blocking: true,
        });
      });
      continue;
    }

    seenStudentIds.add(rawStudentId);

    const segment = determineSegment(
      parsedRow.totalConsumptionPct,
      thresholds.high,
      thresholds.medium
    );

    const resolvedStudent: ResolvedStudent = {
      externalStudentId: rawStudentId,
      name: rawName,
      phoneE164,
      totalConsumptionPct: parsedRow.totalConsumptionPct,
      videoPct: parsedRow.videoPct,
      pdfPct: parsedRow.pdfPct,
      quizPct: parsedRow.quizSubmissionPct,
      flashcardsPct: parsedRow.flashCardsPct,
      aiContentPct: parsedRow.aiContentPct,
      assignmentSubmissionPct: parsedRow.assignmentSubmissionPct,
      assignmentScorePct: parsedRow.assignmentScorePct,
      livePct: parsedRow.liveClassPct,
      liveOrRecPct: parsedRow.liveOrRecordingPct,
      assignmentsTotal: parsedRow.assignmentsTotal,
      assignmentsSubmitted: parsedRow.assignmentsSubmitted,
      assignmentsDelayed: parseNumber(row['Assignments Delayed'] || 0),
      liveTotal: parsedRow.liveClassTotal,
      liveAttended: parsedRow.liveClassAttended,
      segment,
      raw: row,
    };

    studentsMap.set(rawStudentId, resolvedStudent);
    if (phoneE164) {
      phoneToStudentId.set(phoneE164, rawStudentId);
    }
    if (rawName) {
      nameToStudentId.set(normalizeName(rawName), rawStudentId);
    }
  }

  // --- 2. Parse Assignments ---
  const assignmentsSheet = workbook.getWorksheet(matchedSheets['Assignments'])!;
  const assignmentRows = worksheetToRows(assignmentsSheet);

  const assignmentItemsMap = new Map<string, ParsedAssignmentItem>();
  const assignmentResults: ParsedAssignmentResult[] = [];

  const knownMetaCols = new Set([
    'User ID',
    'Student ID',
    'Name',
    'Student Name',
    'Phone',
    'Phone number',
    'Total Assignments',
    'Assignments Submitted',
    'Assignments Not Submitted',
    'Assignments Delayed',
    'Submission Rate (%)',
    'Total Score',
    'Total Maximum Score',
    'Aggregate Assignment Score (%)',
  ]);

  if (assignmentRows.length > 0) {
    const assignmentColNames = Object.keys(assignmentRows[0]).filter(
      (col) => !knownMetaCols.has(col)
    );

    assignmentColNames.forEach((col) => {
      const cleanName = col.replace(/\s*\(Status\s*\/\s*Score\)/i, '').trim();
      assignmentItemsMap.set(cleanName, { name: cleanName });
    });

    for (const row of assignmentRows) {
      const rawUserId = String(row['User ID'] || row['Student ID'] || '').trim();
      if (
        !rawUserId ||
        rawUserId.toUpperCase() === 'AVERAGE' ||
        rawUserId.toUpperCase() === 'TOTAL'
      ) {
        continue;
      }

      let studentId = rawUserId;
      if (!studentsMap.has(studentId)) {
        const phone = normalizePhone(row['Phone'] as string | number);
        const nameKey = normalizeName(String(row['Name'] || ''));
        studentId = phoneToStudentId.get(phone) || nameToStudentId.get(nameKey) || '';
      }

      if (!studentId || !studentsMap.has(studentId)) {
        unmatchedRows.push({
          sheet: 'Assignments',
          identifier: rawUserId || String(row['Name'] || ''),
          reason: 'Student not found in Cumulative Report',
          raw: row,
        });
        continue;
      }

      for (const col of assignmentColNames) {
        const { status, score } = parseAssignmentCell(row[col]);
        const cleanName = col.replace(/\s*\(Status\s*\/\s*Score\)/i, '').trim();

        assignmentResults.push({
          assignmentName: cleanName,
          studentExternalId: studentId,
          status,
          score,
          maxScore: 10,
        });
      }
    }
  }

  // --- 3. Parse Content Consumption ---
  const contentSheet = workbook.getWorksheet(matchedSheets['Content Consumption'])!;
  const contentRows = worksheetToRows(contentSheet);

  const weeklyConsumption: ParsedWeeklyConsumption[] = [];
  if (contentRows.length > 0) {
    const weekColNames = Object.keys(contentRows[0]).filter((col) =>
      /Week\s*(\d+)/i.test(col)
    );

    for (const row of contentRows) {
      const rawUserId = String(row['User ID'] || row['Student ID'] || '').trim();
      if (
        !rawUserId ||
        rawUserId.toUpperCase() === 'AVERAGE' ||
        rawUserId.toUpperCase() === 'TOTAL'
      ) {
        continue;
      }

      let studentId = rawUserId;
      if (!studentsMap.has(studentId)) {
        const phone = normalizePhone(row['Phone'] as string | number);
        const nameKey = normalizeName(String(row['Name'] || ''));
        studentId = phoneToStudentId.get(phone) || nameToStudentId.get(nameKey) || '';
      }

      if (!studentId || !studentsMap.has(studentId)) {
        unmatchedRows.push({
          sheet: 'Content Consumption',
          identifier: rawUserId || String(row['Name'] || ''),
          reason: 'Student not found in Cumulative Report',
          raw: row,
        });
        continue;
      }

      for (const col of weekColNames) {
        const weekMatch = col.match(/Week\s*(\d+)/i);
        const weekNo = weekMatch ? parseInt(weekMatch[1], 10) : 1;
        const { consumed, total } = parseWeekCell(row[col]);

        weeklyConsumption.push({
          studentExternalId: studentId,
          weekNo,
          consumed,
          total,
        });
      }
    }
  }

  // --- 4 & 5. Parse Live Attendance & Attendance (Live+Recording) ---
  const liveSheet = workbook.getWorksheet(matchedSheets['Live Attendance'])!;
  const liveRows = worksheetToRows(liveSheet);

  const liveRecSheet = workbook.getWorksheet(matchedSheets['Attendance (Live+Recording)'])!;
  const liveRecRows = worksheetToRows(liveRecSheet);

  const sessions: ParsedSession[] = [];
  const attendance: ParsedAttendance[] = [];

  const ignoredAttendanceCols = new Set([
    'Name',
    'Student Name',
    'Phone',
    'Phone number',
    'Attendance Percentage',
    'Attendance %',
  ]);

  if (liveRows.length > 0) {
    const sessionColNames = Object.keys(liveRows[0]).filter(
      (col) => !ignoredAttendanceCols.has(col)
    );

    sessionColNames.forEach((col, idx) => {
      const sessionDate = extractSessionDate(col) || `2026-10-${String(idx + 1).padStart(2, '0')}`;
      sessions.push({
        title: col,
        sessionDate,
      });
    });

    const recMapByPhone = new Map<string, Record<string, unknown>>();
    const recMapByName = new Map<string, Record<string, unknown>>();

    for (const recRow of liveRecRows) {
      const phone = normalizePhone((recRow['Phone number'] ?? recRow['Phone']) as string | number);
      const name = normalizeName(String(recRow['Name'] || ''));
      if (phone) recMapByPhone.set(phone, recRow);
      if (name) recMapByName.set(name, recRow);
    }

    for (const liveRow of liveRows) {
      const rawName = String(liveRow['Name'] || '').trim();
      const phone = normalizePhone((liveRow['Phone number'] ?? liveRow['Phone']) as string | number);
      const nameKey = normalizeName(rawName);

      if (!rawName && !phone) continue;

      const studentId = phoneToStudentId.get(phone) || nameToStudentId.get(nameKey) || '';
      if (!studentId || !studentsMap.has(studentId)) {
        unmatchedRows.push({
          sheet: 'Live Attendance',
          identifier: rawName || phone,
          reason: 'Could not match attendee by phone or name to Cumulative Report',
          raw: liveRow,
        });
        continue;
      }

      const matchingRecRow = recMapByPhone.get(phone) || recMapByName.get(nameKey) || {};

      for (const col of sessionColNames) {
        const liveStatus = String(liveRow[col] || 'ABSENT').trim().toUpperCase();
        const liveOrRecStatus = String(matchingRecRow[col] || liveStatus).trim().toUpperCase();

        attendance.push({
          sessionTitle: col,
          studentExternalId: studentId,
          liveStatus,
          liveOrRecStatus,
        });
      }
    }
  }

  // --- Calculate Batch Averages ---
  const studentsList = Array.from(studentsMap.values());
  const totalStudents = studentsList.length;

  let assignmentSubmissionSum = 0;
  let totalConsumptionSum = 0;
  let liveAttendanceSum = 0;
  let liveOrRecSum = 0;

  for (const s of studentsList) {
    assignmentSubmissionSum += s.assignmentSubmissionPct;
    totalConsumptionSum += s.totalConsumptionPct;
    liveAttendanceSum += s.livePct;
    liveOrRecSum += s.liveOrRecPct;
  }

  const averages = {
    assignmentSubmissionAvg:
      totalStudents > 0 ? Number((assignmentSubmissionSum / totalStudents).toFixed(1)) : 0,
    totalConsumptionAvg:
      totalStudents > 0 ? Number((totalConsumptionSum / totalStudents).toFixed(1)) : 0,
    liveAttendanceAvg:
      totalStudents > 0 ? Number((liveAttendanceSum / totalStudents).toFixed(1)) : 0,
    liveOrRecAvg: totalStudents > 0 ? Number((liveOrRecSum / totalStudents).toFixed(1)) : 0,
  };

  return {
    success: errors.filter((e) => e.blocking).length === 0,
    sheetsFound: sheetNames,
    totalStudents,
    students: studentsList,
    assignmentItems: Array.from(assignmentItemsMap.values()),
    assignmentResults,
    weeklyConsumption,
    sessions,
    attendance,
    errors,
    warnings,
    unmatchedRows,
    averages,
  };
}
