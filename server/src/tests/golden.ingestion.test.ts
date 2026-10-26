import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processWorkbook } from '../services/ingestion/identityResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Golden Test: Batch 15748 Sample LMS Excel Fixture', () => {
  it('correctly parses and calculates all baseline reference metrics', async () => {
    const fixturePath = path.join(__dirname, '../../tests/fixtures/Cumulative_Report_Batch_15748.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fixturePath);

    const result = await processWorkbook(workbook);

    // 1. Success & Sheets Validation
    expect(result.success).toBe(true);
    expect(result.sheetsFound).toEqual([
      'Cumulative Report',
      'Assignments',
      'Content Consumption',
      'Live Attendance',
      'Attendance (Live+Recording)',
    ]);
    expect(result.errors.filter((e) => e.blocking)).toHaveLength(0);

    // 2. Cohort Size: Exactly 31 Students
    expect(result.totalStudents).toBe(31);
    expect(result.students).toHaveLength(31);

    // 3. Golden Benchmark Averages
    expect(result.averages.assignmentSubmissionAvg).toBe(62.1);
    expect(result.averages.totalConsumptionAvg).toBe(67.8);
    expect(result.averages.liveAttendanceAvg).toBe(72.9);
    expect(result.averages.liveOrRecAvg).toBe(78.0);

    // 4. Cohort Distributions
    const zeroSubmitters = result.students.filter((s) => s.assignmentsSubmitted === 0);
    expect(zeroSubmitters).toHaveLength(7);

    const lowConsumption = result.students.filter((s) => s.totalConsumptionPct < 50);
    expect(lowConsumption).toHaveLength(8);

    const zeroQuiz = result.students.filter((s) => s.quizPct === 0);
    expect(zeroQuiz).toHaveLength(12);

    // 5. Deep-Dive Fact Records
    expect(result.assignmentItems).toHaveLength(4);
    expect(result.assignmentResults).toHaveLength(124); // 31 students * 4 assignments
    expect(result.weeklyConsumption).toHaveLength(310); // 31 students * 10 weeks
    expect(result.sessions).toHaveLength(29); // 29 sessions
    expect(result.attendance).toHaveLength(899); // 31 students * 29 sessions
  });
});
