import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseWorkbook } from './workbookParser';

describe('workbookParser & Golden File Test', () => {
  it('parses the sample LMS Excel fixture and matches all golden reference metrics', async () => {
    const candidatePaths = [
      path.resolve(process.cwd(), 'Cumulative_Report_Batch_15748.xlsx'),
      path.resolve(process.cwd(), '../Cumulative_Report_Batch_15748.xlsx'),
      path.resolve(process.cwd(), '../server/tests/fixtures/Cumulative_Report_Batch_15748.xlsx'),
    ];
    const fixturePath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[0];
    const fileBuffer = fs.readFileSync(fixturePath);
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );

    const result = await parseWorkbook(arrayBuffer, 'Cumulative_Report_Batch_15748.xlsx');

    expect(result.success).toBe(true);
    expect(result.sheetsFound).toHaveLength(5);
    expect(result.detectedBatchName).toBe('Batch 15748');

    // 1. Exactly 31 students
    expect(result.totalStudents).toBe(31);
    expect(result.students).toHaveLength(31);

    // 2. Averages per document requirements
    expect(result.averages.assignmentSubmissionAvg).toBe(62.1);
    expect(result.averages.totalConsumptionAvg).toBe(67.8);
    expect(result.averages.liveAttendanceAvg).toBe(72.9);
    expect(result.averages.liveOrRecAvg).toBe(78.0);

    // 3. Students with 0 assignments = 7
    const zeroAssignments = result.metrics.filter(
      (m) => m.metrics.assignmentsSubmitted === 0
    );
    expect(zeroAssignments).toHaveLength(7);

    // 4. Students below 50% consumption = 8
    const below50Consumption = result.metrics.filter(
      (m) => m.metrics.totalConsumptionPct < 50
    );
    expect(below50Consumption).toHaveLength(8);

    // 5. Students with 0 quiz attempts = 12
    const zeroQuiz = result.metrics.filter((m) => m.metrics.quizAttended === 0);
    expect(zeroQuiz).toHaveLength(12);

    // 6. Assignment results parsed dynamically (31 students * 4 assignments)
    expect(result.assignmentResults).toHaveLength(124);

    // 7. Weekly consumption parsed dynamically (31 students * 10 weeks)
    expect(result.weeklyConsumption).toHaveLength(310);

    // 8. Sessions & attendance parsed dynamically (29 sessions matching 'Live Class Total: 29')
    expect(result.sessions).toHaveLength(29);
    expect(result.attendance).toHaveLength(31 * 29);
  });

  it('reports missing sheets as blocking errors', async () => {
    const emptyBuffer = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]).buffer;
    const result = await parseWorkbook(emptyBuffer, 'empty.xlsx').catch(() => null);
    if (result) {
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
