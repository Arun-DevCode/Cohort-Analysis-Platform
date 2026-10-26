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
import { cumulativeStudentRowSchema, RowValidationError } from '../../validators/excelRow.validator.js';

export function getCellValue(cell: ExcelJS.Cell): unknown {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if ('result' in val && val.result !== undefined) return val.result;
    if ('text' in val && val.text !== undefined) return val.text;
  }
  return val;
}

export function worksheetToRows(worksheet: ExcelJS.Worksheet): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  if (worksheet.rowCount === 0) return rows;

  const headerRow = worksheet.getRow(1);
  const headers: { colIndex: number; name: string }[] = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const val = String(getCellValue(cell) || '').trim();
    if (val) {
      headers.push({ colIndex: colNumber, name: val });
    }
  });

  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const rowObj: Record<string, unknown> = {};
    let hasData = false;

    for (const h of headers) {
      const cell = row.getCell(h.colIndex);
      const val = getCellValue(cell);
      rowObj[h.name] = val;
      if (val !== '' && val !== null && val !== undefined) {
        hasData = true;
      }
    }

    if (hasData) {
      rows.push(rowObj);
    }
  }

  return rows;
}
