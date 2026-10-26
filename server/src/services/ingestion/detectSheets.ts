export const REQUIRED_SHEETS = [
  'Cumulative Report',
  'Assignments',
  'Content Consumption',
  'Live Attendance',
  'Attendance (Live+Recording)',
] as const;

export type RequiredSheetName = (typeof REQUIRED_SHEETS)[number];

export interface SheetDetectionResult {
  matchedSheets: Record<RequiredSheetName, string>;
  missingSheets: RequiredSheetName[];
  errors: string[];
}

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function detectSheets(availableSheets: string[]): SheetDetectionResult {
  const matchedSheets = {} as Record<RequiredSheetName, string>;
  const missingSheets: RequiredSheetName[] = [];
  const errors: string[] = [];

  for (const req of REQUIRED_SHEETS) {
    const reqClean = clean(req);
    const found = availableSheets.find((sheet) => {
      const sClean = clean(sheet);
      return sClean === reqClean || sClean.includes(reqClean) || reqClean.includes(sClean);
    });

    if (found) {
      matchedSheets[req] = found;
    } else {
      missingSheets.push(req);
      errors.push(`Required sheet "${req}" is missing from workbook. Found: [${availableSheets.join(', ')}]`);
    }
  }

  return {
    matchedSheets,
    missingSheets,
    errors,
  };
}
