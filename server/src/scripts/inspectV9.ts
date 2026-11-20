import ExcelJS from 'exceljs';
import fs from 'fs';

async function inspectV9() {
  const path = 'D:/Resource/Agentic FSD-ANB49 _ V9.xlsx';
  if (!fs.existsSync(path)) {
    console.log('Not found:', path);
    return;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  console.log(`\n=== Inspecting ${path} ===`);
  console.log('Worksheets:', wb.worksheets.map((w) => w.name));

  const tracker = wb.getWorksheet('Core session | Tracker');
  if (tracker) {
    console.log(`\nTracker row count: ${tracker.rowCount}, col count: ${tracker.columnCount}`);
    for (let r = 1; r <= Math.min(25, tracker.rowCount); r++) {
      const row = tracker.getRow(r);
      const values: any[] = [];
      for (let c = 1; c <= 12; c++) {
        values.push(row.getCell(c).value);
      }
      console.log(`Row ${r}:`, JSON.stringify(values));
    }
  }

  const courseInfo = wb.getWorksheet('Course info');
  if (courseInfo) {
    console.log(`\nCourse info row count: ${courseInfo.rowCount}`);
    courseInfo.eachRow((row, r) => {
      console.log(`Row ${r}:`, JSON.stringify(row.values));
    });
  }

  const scoreCard = wb.getWorksheet('Score Card | Core session');
  if (scoreCard) {
    console.log(`\nScore Card row count: ${scoreCard.rowCount}, col count: ${scoreCard.columnCount}`);
    for (let r = 1; r <= Math.min(6, scoreCard.rowCount); r++) {
      console.log(`Row ${r}:`, JSON.stringify(scoreCard.getRow(r).values));
    }
  }
}

inspectV9();

