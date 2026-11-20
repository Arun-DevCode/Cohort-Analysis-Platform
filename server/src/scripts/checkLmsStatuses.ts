import ExcelJS from 'exceljs';

async function checkLmsStatuses() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('../app/Cumulative_Report_Batch_15748.xlsx');
  const ws = wb.getWorksheet('Assignments');
  if (!ws) {
    console.log('Assignments sheet not found');
    return;
  }

  const rawStatuses = new Set<string>();
  const parsedStatuses = new Set<string>();

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    // columns 5 to 8 are the 4 assignments
    for (let c = 5; c <= 8; c++) {
      const val = String(row.getCell(c).value || '');
      rawStatuses.add(val);
      // Status is before the " / " (e.g. "PASSED / 10" or "SUBMISSION_PENDING / -")
      const statusPart = val.split('/')[0].trim();
      parsedStatuses.add(statusPart);
    }
  });

  console.log('Distinct raw cell values in Assignments sheet:');
  console.log(Array.from(rawStatuses));

  console.log('\nDistinct status prefixes:');
  console.log(Array.from(parsedStatuses));
}

checkLmsStatuses();

