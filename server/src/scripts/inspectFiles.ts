import ExcelJS from 'exceljs';
import fs from 'fs';

async function inspect(path: string) {
  if (!fs.existsSync(path)) {
    console.log(`[NOT FOUND] ${path}`);
    return;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  console.log(`\n=== ${path} ===`);
  console.log('Worksheets:', wb.worksheets.map((w) => w.name));
  for (const ws of wb.worksheets) {
    console.log(`- Sheet "${ws.name}": ${ws.rowCount} rows, ${ws.columnCount} columns`);
    if (ws.rowCount > 0) {
      const row1 = ws.getRow(1).values;
      const row2 = ws.getRow(2).values;
      console.log(`  Row 1:`, JSON.stringify(row1));
      console.log(`  Row 2:`, JSON.stringify(row2));
    }
  }
}

async function run() {
  await inspect('../app/Cumulative_Report_Batch_15748.xlsx');
  await inspect('tests/fixtures/Cumulative_Report_Batch_15748.xlsx');
  await inspect('D:/Entri-Session/Batch-Assignments.xlsx');
  await inspect('D:/Entri-Session/Tracker/FSD Course/AN B47/Master-B47.xlsx');
}

run();

