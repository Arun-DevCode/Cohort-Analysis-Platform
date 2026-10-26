import * as XLSX from 'xlsx';
import type {
  ParseResult,
  Student,
  StudentMetrics,
  AssignmentResult,
  WeeklyConsumption,
  Session,
  AttendanceRecord,
  UnmatchedRow,
  ValidationError,
  ValidationWarning,
  SegmentType,
} from '@/types';
import {
  parsePercentage,
  parseNumber,
  parseAssignmentCell,
  parseWeekCell,
  extractSessionDate,
} from './normalizers';
import { normalizePhone, normalizeName } from '../identity/phone';
import { validateSheetsPresence, validateStudentRow } from '../validation/schemas';
import { computeFileHash } from './hash';

export function determineSegment(
  metrics: Pick<StudentMetrics, 'totalConsumptionPct'>,
  highThreshold = 80,
  mediumThreshold = 50
): SegmentType {
  const val = metrics.totalConsumptionPct;
  if (val >= highThreshold) return 'High';
  if (val >= mediumThreshold) return 'Medium';
  return 'Low';
}

export function extractBatchNameFromFileName(fileName: string): string {
  if (!fileName) return 'Batch';
  const match = fileName.match(/(Batch[_\s-]*[A-Za-z0-9]+)/i);
  if (match) {
    return match[1].replace(/_/g, ' ');
  }
  return fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
}

export async function parseWorkbook(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  thresholds = { high: 80, medium: 50 }
): Promise<ParseResult> {
  const fileHash = await computeFileHash(arrayBuffer);
  const detectedBatchName = extractBatchNameFromFileName(fileName);

  // Read workbook (values only, never evaluate formulas)
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), {
    type: 'array',
    raw: true,
    cellFormula: false,
    cellHTML: false,
    cellText: true,
  });

  const availableSheets = workbook.SheetNames;
  const { errors: sheetErrors, matchedSheets } = validateSheetsPresence(availableSheets);

  if (sheetErrors.length > 0) {
    return {
      success: false,
      fileHash,
      fileName,
      detectedBatchName,
      sheetsFound: availableSheets,
      totalStudents: 0,
      students: [],
      metrics: [],
      assignmentResults: [],
      weeklyConsumption: [],
      sessions: [],
      attendance: [],
      errors: sheetErrors,
      warnings: [],
      unmatchedRows: [],
      averages: {
        assignmentSubmissionAvg: 0,
        totalConsumptionAvg: 0,
        liveAttendanceAvg: 0,
        liveOrRecAvg: 0,
      },
    };
  }

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const unmatchedRows: UnmatchedRow[] = [];

  // --- 1. Parse Cumulative Report ---
  const cumulativeSheet = workbook.Sheets[matchedSheets['Cumulative Report']];
  const rawCumulativeRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(cumulativeSheet, {
    defval: '',
  });

  const studentMap = new Map<string, Student>();
  const phoneToStudentId = new Map<string, string>();
  const nameToStudentId = new Map<string, string>();
  const metricsList: { studentId: string; metrics: StudentMetrics; segment: SegmentType }[] = [];
  const existingStudentIds = new Set<string>();

  let rowIdx = 1;
  for (const row of rawCumulativeRows) {
    rowIdx++;
    const rawStudentId = String(row['Student ID'] || row['User ID'] || '').trim();
    const rawName = String(row['Student Name'] || row['Name'] || '').trim();
    const rawPhone = row['Phone'] ?? row['Phone number'];

    if (!rawStudentId || rawStudentId.toUpperCase() === 'AVERAGE' || rawStudentId.toUpperCase() === 'TOTAL') {
      continue;
    }

    const { errors: rowErrors, warnings: rowWarnings } = validateStudentRow(
      rowIdx,
      rawStudentId,
      rawName,
      existingStudentIds
    );
    errors.push(...rowErrors);
    warnings.push(...rowWarnings);

    if (rowErrors.some((e) => e.blocking)) {
      continue;
    }

    existingStudentIds.add(rawStudentId);
    const phoneE164 = normalizePhone(rawPhone as string | number);
    const studentInternalId = `std_${rawStudentId}`;

    const student: Student = {
      id: studentInternalId,
      externalStudentId: rawStudentId,
      name: rawName,
      phoneE164,
    };

    studentMap.set(studentInternalId, student);
    if (phoneE164) {
      phoneToStudentId.set(phoneE164, studentInternalId);
    }
    if (rawName) {
      nameToStudentId.set(normalizeName(rawName), studentInternalId);
    }

    const metrics: StudentMetrics = {
      totalConsumptionPct: parsePercentage(row['Total Consumption %']),
      videoPct: parsePercentage(row['Video %']),
      pdfPct: parsePercentage(row['PDF %']),
      quizSubmissionPct: parsePercentage(row['Quiz Submission %']),
      flashCardsPct: parsePercentage(row['Flash Cards %']),
      aiContentPct: parsePercentage(row['AI Content %']),
      assignmentSubmissionPct: parsePercentage(row['Assignment Submission %']),
      assignmentAggregateScorePct: parsePercentage(row['Assignment Aggregate Score %']),
      liveClassPct: parsePercentage(row['Live Class %']),
      liveOrRecordingPct: parsePercentage(row['Live Or Recording %']),
      pdfTotal: parseNumber(row['PDF Total']),
      pdfConsumed: parseNumber(row['PDF Consumed']),
      videoTotal: parseNumber(row['Video Total']),
      videoConsumed: parseNumber(row['Video Consumed']),
      quizTotal: parseNumber(row['Quiz Total']),
      quizAttended: parseNumber(row['Quiz Attended']),
      flashCardsTotal: parseNumber(row['Flash Cards Total']),
      flashCardsConsumed: parseNumber(row['Flash Cards Consumed']),
      aiContentTotal: parseNumber(row['AI Content Total']),
      aiContentAttempted: parseNumber(row['AI Content Attempted']),
      assignmentsTotal: parseNumber(row['Assignments Total']),
      assignmentsSubmitted: parseNumber(row['Assignments Submitted']),
      liveClassAttended: parseNumber(row['Live Class Attended']),
      liveClassTotal: parseNumber(row['Live Class Total']),
      liveOrRecordingConsumed: parseNumber(row['Live Or Recording Consumed']),
    };

    const segment = determineSegment(metrics, thresholds.high, thresholds.medium);
    metricsList.push({
      studentId: studentInternalId,
      metrics,
      segment,
    });
  }

  // --- 2. Parse Assignments ---
  const assignmentsSheet = workbook.Sheets[matchedSheets['Assignments']];
  const rawAssignmentRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(assignmentsSheet, {
    defval: '',
  });

  const assignmentResults: Omit<AssignmentResult, 'id' | 'snapshotId'>[] = [];
  const knownAssignmentMetaCols = new Set([
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

  if (rawAssignmentRows.length > 0) {
    const assignmentColNames = Object.keys(rawAssignmentRows[0]).filter(
      (col) => !knownAssignmentMetaCols.has(col)
    );

    for (const row of rawAssignmentRows) {
      const rawUserId = String(row['User ID'] || row['Student ID'] || '').trim();
      if (!rawUserId || rawUserId.toUpperCase() === 'AVERAGE' || rawUserId.toUpperCase() === 'TOTAL') {
        continue;
      }

      let studentId = `std_${rawUserId}`;
      if (!studentMap.has(studentId)) {
        const phone = normalizePhone(row['Phone'] as string | number);
        const nameKey = normalizeName(String(row['Name'] || ''));
        studentId = phoneToStudentId.get(phone) || nameToStudentId.get(nameKey) || '';
      }

      if (!studentId || !studentMap.has(studentId)) {
        unmatchedRows.push({
          sheet: 'Assignments',
          identifier: rawUserId || String(row['Name'] || ''),
          raw: row as Record<string, string | number>,
          reason: 'Student ID / User ID not found in Cumulative Report',
        });
        continue;
      }

      for (const colName of assignmentColNames) {
        const cellVal = row[colName];
        const { status, score } = parseAssignmentCell(cellVal);
        const cleanAssignmentName = colName.replace(/\s*\(Status\s*\/\s*Score\)/i, '').trim();

        assignmentResults.push({
          studentId,
          assignmentName: cleanAssignmentName,
          status,
          score,
          maxScore: 10,
        });
      }
    }
  }

  // --- 3. Parse Content Consumption ---
  const contentSheet = workbook.Sheets[matchedSheets['Content Consumption']];
  const rawContentRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(contentSheet, {
    defval: '',
  });

  const weeklyConsumption: Omit<WeeklyConsumption, 'id' | 'snapshotId'>[] = [];
  if (rawContentRows.length > 0) {
    const weekColNames = Object.keys(rawContentRows[0]).filter((col) =>
      /Week\s*(\d+)/i.test(col)
    );

    for (const row of rawContentRows) {
      const rawUserId = String(row['User ID'] || row['Student ID'] || '').trim();
      if (!rawUserId || rawUserId.toUpperCase() === 'AVERAGE' || rawUserId.toUpperCase() === 'TOTAL') {
        continue;
      }

      let studentId = `std_${rawUserId}`;
      if (!studentMap.has(studentId)) {
        const phone = normalizePhone(row['Phone'] as string | number);
        const nameKey = normalizeName(String(row['Name'] || ''));
        studentId = phoneToStudentId.get(phone) || nameToStudentId.get(nameKey) || '';
      }

      if (!studentId || !studentMap.has(studentId)) {
        unmatchedRows.push({
          sheet: 'Content Consumption',
          identifier: rawUserId || String(row['Name'] || ''),
          raw: row as Record<string, string | number>,
          reason: 'Student ID not found in Cumulative Report',
        });
        continue;
      }

      for (const col of weekColNames) {
        const weekMatch = col.match(/Week\s*(\d+)/i);
        const weekNo = weekMatch ? parseInt(weekMatch[1], 10) : 1;
        const { consumed, total } = parseWeekCell(row[col]);

        weeklyConsumption.push({
          studentId,
          weekNo,
          consumed,
          total,
        });
      }
    }
  }

  // --- 4 & 5. Parse Live Attendance and Attendance (Live+Recording) ---
  const liveSheet = workbook.Sheets[matchedSheets['Live Attendance']];
  const rawLiveRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(liveSheet, {
    defval: '',
  });

  const liveRecSheet = workbook.Sheets[matchedSheets['Attendance (Live+Recording)']];
  const rawLiveRecRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(liveRecSheet, {
    defval: '',
  });

  const sessions: Omit<Session, 'id' | 'snapshotId'>[] = [];
  const attendance: Omit<AttendanceRecord, 'id'>[] = [];

  const ignoredAttendanceCols = new Set([
    'Name',
    'Student Name',
    'Phone',
    'Phone number',
    'Attendance Percentage',
    'Attendance %',
  ]);

  if (rawLiveRows.length > 0) {
    const sessionColNames = Object.keys(rawLiveRows[0]).filter(
      (col) => !ignoredAttendanceCols.has(col)
    );

    sessionColNames.forEach((col, idx) => {
      const sessionDate = extractSessionDate(col) || `2026-10-${String(idx + 1).padStart(2, '0')}`;
      sessions.push({
        title: col,
        sessionDate,
        originalColumn: col,
        orderIndex: idx,
      });
    });

    const recMapByPhone = new Map<string, Record<string, unknown>>();
    const recMapByName = new Map<string, Record<string, unknown>>();
    for (const recRow of rawLiveRecRows) {
      const rawRecPhone = (recRow['Phone number'] ?? recRow['Phone']) as string | number | undefined;
      const phone = normalizePhone(rawRecPhone);
      const name = normalizeName(String(recRow['Name'] || ''));
      if (phone) recMapByPhone.set(phone, recRow);
      if (name) recMapByName.set(name, recRow);
    }

    for (const liveRow of rawLiveRows) {
      const rawName = String(liveRow['Name'] || '').trim();
      const rawLivePhone = (liveRow['Phone number'] ?? liveRow['Phone']) as string | number | undefined;
      const phone = normalizePhone(rawLivePhone);
      const nameKey = normalizeName(rawName);

      if (!rawName && !phone) continue;

      const studentId = phoneToStudentId.get(phone) || nameToStudentId.get(nameKey) || '';

      if (!studentId) {
        unmatchedRows.push({
          sheet: 'Live Attendance',
          identifier: rawName || phone,
          raw: liveRow as Record<string, string | number>,
          reason: 'Could not match attendee by phone or name to Cumulative Report',
        });
        continue;
      }

      const matchingRecRow = recMapByPhone.get(phone) || recMapByName.get(nameKey) || {};

      sessionColNames.forEach((col, sIdx) => {
        const liveStatus = String(liveRow[col] || 'ABSENT').trim().toUpperCase();
        const liveOrRecStatus = String(matchingRecRow[col] || liveStatus).trim().toUpperCase();

        attendance.push({
          sessionId: `sess_${sIdx}`,
          studentId,
          liveStatus,
          liveOrRecStatus,
        });
      });
    }
  }

  // Calculate batch averages
  const totalStudents = metricsList.length;
  let assignmentSubmissionSum = 0;
  let totalConsumptionSum = 0;
  let liveAttendanceSum = 0;
  let liveOrRecSum = 0;

  for (const m of metricsList) {
    assignmentSubmissionSum += m.metrics.assignmentSubmissionPct;
    totalConsumptionSum += m.metrics.totalConsumptionPct;
    liveAttendanceSum += m.metrics.liveClassPct;
    liveOrRecSum += m.metrics.liveOrRecordingPct;
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
    fileHash,
    fileName,
    detectedBatchName,
    sheetsFound: availableSheets,
    totalStudents,
    students: Array.from(studentMap.values()),
    metrics: metricsList,
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
