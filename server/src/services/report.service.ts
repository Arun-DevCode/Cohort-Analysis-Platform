import ExcelJS from 'exceljs';
import { getDb } from '../db/client.js';
import {
  batches,
  snapshots,
  studentSnapshots,
  students,
  sessions,
  attendance,
} from '../db/schema/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler.js';
import { identifyAtRiskStudents } from './analytics/atRisk.js';
import { AuditService } from './audit.service.js';

export class ReportService {
  static async generateBatchReport(
    batchId: string,
    options: { snapshotId?: string; userId?: string }
  ): Promise<{ buffer: Buffer; filename: string }> {
    const db = getDb();

    // 1. Fetch batch
    const [batch] = await db
      .select()
      .from(batches)
      .where(eq(batches.id, batchId))
      .limit(1);

    if (!batch) {
      throw new AppError('Batch not found', 404);
    }

    // 2. Resolve snapshot
    let snapshotId = options.snapshotId;
    if (!snapshotId) {
      const [latest] = await db
        .select()
        .from(snapshots)
        .where(eq(snapshots.batchId, batchId))
        .orderBy(desc(snapshots.snapshotDate))
        .limit(1);

      if (!latest) {
        throw new AppError('No snapshots found for this batch', 404);
      }
      snapshotId = latest.id;
    }

    const [snapshot] = await db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.id, snapshotId), eq(snapshots.batchId, batchId)))
      .limit(1);

    if (!snapshot) {
      throw new AppError('Snapshot not found in this batch', 404);
    }

    // 3. Fetch student snapshot rows
    const rawStudentRows = await db
      .select({
        studentId: students.id,
        externalId: students.externalStudentId,
        name: students.name,
        phone: students.phoneE164,
        totalConsumptionPct: studentSnapshots.totalConsumptionPct,
        assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
        assignmentScorePct: studentSnapshots.assignmentScorePct,
        livePct: studentSnapshots.livePct,
        liveOrRecPct: studentSnapshots.liveOrRecPct,
        segment: studentSnapshots.segment,
        assignmentsTotal: studentSnapshots.assignmentsTotal,
        assignmentsSubmitted: studentSnapshots.assignmentsSubmitted,
        liveTotal: studentSnapshots.liveTotal,
        liveAttended: studentSnapshots.liveAttended,
      })
      .from(studentSnapshots)
      .innerJoin(students, eq(studentSnapshots.studentId, students.id))
      .where(eq(studentSnapshots.snapshotId, snapshotId))
      .orderBy(students.name);

    const studentRows = rawStudentRows.map((s) => ({
      ...s,
      totalConsumptionPct: parseFloat(s.totalConsumptionPct || '0'),
      assignmentSubmissionPct: parseFloat(s.assignmentSubmissionPct || '0'),
      assignmentScorePct: parseFloat(s.assignmentScorePct || '0'),
      livePct: parseFloat(s.livePct || '0'),
      liveOrRecPct: parseFloat(s.liveOrRecPct || '0'),
    }));

    // 4. Compute at-risk flags
    const atRiskCandidates = studentRows.map((s) => ({
      studentId: s.studentId,
      externalStudentId: s.externalId,
      name: s.name,
      phoneE164: s.phone,
      assignmentSubmissionPct: s.assignmentSubmissionPct,
      assignmentsSubmitted: s.assignmentsSubmitted,
      totalConsumptionPct: s.totalConsumptionPct,
      livePct: s.livePct,
      liveOrRecPct: s.liveOrRecPct,
      segment: s.segment,
    }));

    const evaluatedAtRisk = identifyAtRiskStudents(atRiskCandidates);
    const atRiskMap = new Map<string, string[]>();
    evaluatedAtRisk.forEach((ar) => {
      atRiskMap.set(ar.studentId, ar.reasons);
    });

    const atRiskData = studentRows.map((s) => ({
      ...s,
      isAtRisk: atRiskMap.has(s.studentId),
      reasons: (atRiskMap.get(s.studentId) || []).join('; '),
    }));

    const atRiskStudents = atRiskData.filter((s) => s.isAtRisk);

    // 5. Fetch session attendance data
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.snapshotId, snapshotId))
      .orderBy(sessions.sessionDate);

    const sessionStats: Array<{
      title: string;
      date: string | null;
      liveAttended: number;
      livePct: number;
      liveOrRecAttended: number;
      liveOrRecPct: number;
    }> = [];

    for (const sess of sessionRows) {
      const records = await db
        .select()
        .from(attendance)
        .where(eq(attendance.sessionId, sess.id));

      const total = records.length;
      const liveCount = records.filter(
        (r) => r.liveStatus.toLowerCase() === 'present'
      ).length;
      const liveOrRecCount = records.filter(
        (r) =>
          r.liveOrRecStatus.toLowerCase() === 'present' ||
          r.liveStatus.toLowerCase() === 'present'
      ).length;

      sessionStats.push({
        title: sess.title,
        date: sess.sessionDate ? String(sess.sessionDate) : 'N/A',
        liveAttended: liveCount,
        livePct: total > 0 ? Math.round((liveCount / total) * 1000) / 10 : 0,
        liveOrRecAttended: liveOrRecCount,
        liveOrRecPct: total > 0 ? Math.round((liveOrRecCount / total) * 1000) / 10 : 0,
      });
    }

    // 6. Build Excel Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Student Progress Analytics Platform';
    workbook.created = new Date();

    // Palette & Styling
    const headerFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1E293B' }, // Dark slate
    };
    const headerFont: Partial<ExcelJS.Font> = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFF' },
    };

    // --- Sheet 1: Executive Summary ---
    const summarySheet = workbook.addWorksheet('Executive Summary', {
      views: [{ showGridLines: true }],
    });

    const totalStudents = studentRows.length;
    const avgAssignment =
      totalStudents > 0
        ? Math.round(
            (studentRows.reduce((acc, s) => acc + s.assignmentSubmissionPct, 0) /
              totalStudents) *
              10
          ) / 10
        : 0;
    const avgConsumption =
      totalStudents > 0
        ? Math.round(
            (studentRows.reduce((acc, s) => acc + s.totalConsumptionPct, 0) /
              totalStudents) *
              10
          ) / 10
        : 0;
    const avgLive =
      totalStudents > 0
        ? Math.round(
            (studentRows.reduce((acc, s) => acc + s.livePct, 0) / totalStudents) * 10
          ) / 10
        : 0;

    const highCount = studentRows.filter((s) => s.segment === 'high').length;
    const medCount = studentRows.filter((s) => s.segment === 'medium').length;
    const lowCount = studentRows.filter((s) => s.segment === 'low').length;

    summarySheet.columns = [
      { width: 32 },
      { width: 25 },
      { width: 15 },
    ];

    summarySheet.addRow(['STUDENT PROGRESS EXECUTIVE REPORT', '', '']);
    summarySheet.mergeCells('A1:C1');
    const titleCell = summarySheet.getCell('A1');
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: '1E3A8A' } };
    summarySheet.addRow([]);

    summarySheet.addRow(['Batch Name', batch.name]);
    summarySheet.addRow(['External Batch ID', batch.externalBatchId]);
    summarySheet.addRow(['Snapshot Date', snapshot.snapshotDate]);
    summarySheet.addRow(['Total Enrolled Students', totalStudents]);
    summarySheet.addRow(['Report Exported At', new Date().toISOString()]);
    summarySheet.addRow([]);

    const kpiHeader = summarySheet.addRow(['Key Performance Metric', 'Batch Average', 'Benchmark']);
    kpiHeader.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
    });

    summarySheet.addRow(['Assignment Submission Rate', `${avgAssignment}%`, '≥ 70%']);
    summarySheet.addRow(['Content Consumption Rate', `${avgConsumption}%`, '≥ 60%']);
    summarySheet.addRow(['Live Attendance Rate', `${avgLive}%`, '≥ 70%']);
    summarySheet.addRow([]);

    const segHeader = summarySheet.addRow(['Engagement Segment', 'Student Count', 'Percentage']);
    segHeader.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
    });

    summarySheet.addRow([
      'High Engagement',
      highCount,
      totalStudents > 0 ? `${Math.round((highCount / totalStudents) * 100)}%` : '0%',
    ]);
    summarySheet.addRow([
      'Medium Engagement',
      medCount,
      totalStudents > 0 ? `${Math.round((medCount / totalStudents) * 100)}%` : '0%',
    ]);
    summarySheet.addRow([
      'Low Engagement (At Risk)',
      lowCount,
      totalStudents > 0 ? `${Math.round((lowCount / totalStudents) * 100)}%` : '0%',
    ]);
    summarySheet.addRow([
      'Total Flagged At-Risk',
      atRiskStudents.length,
      totalStudents > 0 ? `${Math.round((atRiskStudents.length / totalStudents) * 100)}%` : '0%',
    ]);

    // --- Sheet 2: Student Performance Roster ---
    const rosterSheet = workbook.addWorksheet('Student Performance', {
      views: [{ showGridLines: true }],
    });

    rosterSheet.columns = [
      { header: 'Student ID', key: 'externalId', width: 16 },
      { header: 'Student Name', key: 'name', width: 26 },
      { header: 'Phone Number', key: 'phone', width: 16 },
      { header: 'Segment', key: 'segment', width: 12 },
      { header: 'Assignment %', key: 'assignmentSubmissionPct', width: 15 },
      { header: 'Score %', key: 'assignmentScorePct', width: 12 },
      { header: 'Content %', key: 'totalConsumptionPct', width: 12 },
      { header: 'Live Att %', key: 'livePct', width: 14 },
      { header: 'Live+Rec %', key: 'liveOrRecPct', width: 14 },
      { header: 'At Risk?', key: 'isAtRisk', width: 12 },
      { header: 'Risk Reasons', key: 'reasons', width: 45 },
    ];

    rosterSheet.getRow(1).eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
    });

    atRiskData.forEach((student) => {
      rosterSheet.addRow({
        externalId: student.externalId,
        name: student.name,
        phone: student.phone,
        segment: student.segment.toUpperCase(),
        assignmentSubmissionPct: `${student.assignmentSubmissionPct}%`,
        assignmentScorePct: `${student.assignmentScorePct}%`,
        totalConsumptionPct: `${student.totalConsumptionPct}%`,
        livePct: `${student.livePct}%`,
        liveOrRecPct: `${student.liveOrRecPct}%`,
        isAtRisk: student.isAtRisk ? 'YES' : 'NO',
        reasons: student.reasons || '-',
      });
    });

    // --- Sheet 3: At-Risk Register ---
    const atRiskSheet = workbook.addWorksheet('At-Risk Register', {
      views: [{ showGridLines: true }],
    });

    atRiskSheet.columns = [
      { header: 'Student ID', key: 'externalId', width: 16 },
      { header: 'Student Name', key: 'name', width: 26 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Segment', key: 'segment', width: 12 },
      { header: 'Assignment %', key: 'assignmentSubmissionPct', width: 15 },
      { header: 'Content %', key: 'totalConsumptionPct', width: 15 },
      { header: 'Live %', key: 'livePct', width: 15 },
      { header: 'Triggered Risk Flags', key: 'reasons', width: 50 },
    ];

    atRiskSheet.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'DC2626' }, // Alert red
      };
      cell.font = headerFont;
    });

    atRiskStudents.forEach((student) => {
      atRiskSheet.addRow({
        externalId: student.externalId,
        name: student.name,
        phone: student.phone,
        segment: student.segment.toUpperCase(),
        assignmentSubmissionPct: `${student.assignmentSubmissionPct}%`,
        totalConsumptionPct: `${student.totalConsumptionPct}%`,
        livePct: `${student.livePct}%`,
        reasons: student.reasons,
      });
    });

    // --- Sheet 4: Attendance Summary ---
    const attendanceSheet = workbook.addWorksheet('Attendance Summary', {
      views: [{ showGridLines: true }],
    });

    attendanceSheet.columns = [
      { header: 'Session Title', key: 'title', width: 32 },
      { header: 'Session Date', key: 'date', width: 16 },
      { header: 'Live Attendees', key: 'liveAttended', width: 16 },
      { header: 'Live Attendance %', key: 'livePct', width: 18 },
      { header: 'Live + Rec Attendees', key: 'liveOrRecAttended', width: 22 },
      { header: 'Live + Rec Attendance %', key: 'liveOrRecPct', width: 24 },
    ];

    attendanceSheet.getRow(1).eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
    });

    sessionStats.forEach((sess) => {
      attendanceSheet.addRow({
        title: sess.title,
        date: sess.date,
        liveAttended: sess.liveAttended,
        livePct: `${sess.livePct}%`,
        liveOrRecAttended: sess.liveOrRecAttended,
        liveOrRecPct: `${sess.liveOrRecPct}%`,
      });
    });

    // Generate buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeBatchName = batch.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Batch_${safeBatchName}_Report_${snapshot.snapshotDate}.xlsx`;

    // Audit Log
    await AuditService.log({
      userId: options.userId,
      action: 'export_batch_report',
      entity: 'batches',
      entityId: batchId,
      meta: {
        snapshotId,
        filename,
        totalStudents,
      },
    });

    return { buffer, filename };
  }
}
