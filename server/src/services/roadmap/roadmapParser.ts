import ExcelJS from 'exceljs';
import { z } from 'zod';

export const RoadmapItemKindSchema = z.enum([
  'live',
  'self_paced',
  'assignment',
  'module_end',
  'milestone',
  'assessment',
]);

export type RoadmapItemKind = z.infer<typeof RoadmapItemKindSchema>;

export const RoadmapItemSchema = z.object({
  id: z.string(),
  week: z.string(),
  day: z.string(),
  module: z.string(),
  topic: z.string(),
  sessionType: z.string(),
  hours: z.number().nullable(),
  date: z.string().nullable(), // YYYY-MM-DD
  resource: z.string().nullable(),
  status: z.string().nullable(),
  kind: RoadmapItemKindSchema,
  assignmentNumber: z.number().nullable(),
  normalizedTitle: z.string(),
  rawTopic: z.string(),
});

export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

/**
 * Normalizes title for fuzzy auto-matching:
 * lowercase, removes prefixes like 'M1 -', '2 -', 'Assignment: 1', 'Assignment 1-', 'Mini Project -', punctuation, and dashes
 */
export function normalizeAssignmentTitle(title: string): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^assignment\s*[:\-]?\s*\d+\s*[-:—]?\s*/i, '')
    .replace(/^module\s*[-–—]?\s*end\s*\d*\s*[-:—]?\s*/i, '')
    .replace(/^mini\s*project\s*[-–—]?\s*/i, '')
    .replace(/^m\d+\s*[-–—]\s*/i, '')
    .replace(/^\d+\s*[-–—]\s*/i, '')
    .replace(/[()[\]{}—–\-_:.,/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses Session Tracker worksheet into Zod-validated RoadmapItem array
 */
export function parseRoadmapWorksheet(worksheet: ExcelJS.Worksheet): RoadmapItem[] {
  const items: RoadmapItem[] = [];

  let currentWeek = 'Week 1';
  let currentDay = 'Day 1';
  let currentModule = 'Module 1';
  let currentDate: string | null = null;
  let itemCounter = 0;

  // Find header row dynamically (usually row 5)
  let startRow = 6;
  for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
    const row = worksheet.getRow(r);
    const text = row.values ? String(row.values).toLowerCase() : '';
    if (text.includes('week') && (text.includes('topic') || text.includes('session'))) {
      startRow = r + 1;
      break;
    }
  }

  for (let r = startRow; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);

    const rawWeek = String(row.getCell(1).value || '').trim();
    const rawDay = String(row.getCell(2).value || '').trim();
    const rawModule = String(row.getCell(3).value || '').trim();
    const rawTopic = String(row.getCell(4).value || '').trim();
    const rawType = String(row.getCell(5).value || '').trim();
    const rawDuration = row.getCell(6).value;
    const rawDate = row.getCell(7).value;
    const rawResource = String(row.getCell(8).value || '').trim();
    const rawStatus = String(row.getCell(9).value || '').trim();

    // Skip empty topic rows
    if (!rawTopic) continue;

    // Carry forward week, day, module if blank
    if (rawWeek) currentWeek = rawWeek;
    if (rawDay) currentDay = rawDay;
    if (rawModule) currentModule = rawModule;

    // Parse date safely
    let formattedDate: string | null = null;
    if (rawDate instanceof Date) {
      formattedDate = rawDate.toISOString().split('T')[0];
    } else if (rawDate && typeof rawDate === 'string' && rawDate.trim()) {
      formattedDate = rawDate.trim().split('T')[0];
    } else if (
      rawDate &&
      typeof rawDate === 'object' &&
      'result' in rawDate &&
      rawDate.result instanceof Date
    ) {
      formattedDate = rawDate.result.toISOString().split('T')[0];
    }

    if (formattedDate) {
      currentDate = formattedDate;
    }

    // Parse hours
    let hours: number | null = null;
    if (typeof rawDuration === 'number') {
      hours = rawDuration;
    } else if (rawDuration) {
      const parsed = parseFloat(String(rawDuration));
      if (!isNaN(parsed)) hours = parsed;
    }

    // Classify kind & assignment number
    let kind: RoadmapItemKind = 'live';
    const topicUpper = rawTopic.toUpperCase();
    const typeUpper = rawType.toUpperCase();

    let assignmentNumber: number | null = null;

    // 1. Assignment check: pattern 'Assignment: N (title)' or 'Assignment 1- title' or 'Assignment:N'
    const assignMatch =
      rawTopic.match(/^Assignment\s*[:\-]?\s*(\d+)\s*[-:(]?(.*?)[)]?$/i) ||
      rawTopic.match(/^Assignment\s*[:\-]?\s*(\d+)/i);

    // 2. Module-End check: pattern 'Module-End N (title)' or 'Module-End'
    const mEndMatch =
      rawTopic.match(/^Module-End\s*(\d+)?\s*\((.*?)\)/i) ||
      rawTopic.match(/^Module-End/i) ||
      rawTopic.match(/^Mini\s*Project/i);

    if (assignMatch) {
      kind = 'assignment';
      assignmentNumber = parseInt(assignMatch[1], 10);
    } else if (mEndMatch) {
      kind = 'module_end';
      if (mEndMatch[1]) assignmentNumber = parseInt(mEndMatch[1], 10);
    } else if (topicUpper.includes('MILESTONE') || topicUpper.includes('REFLECTION')) {
      kind = 'milestone';
    } else if (
      topicUpper.includes('ASSESSMENT') ||
      topicUpper.includes('MCQ') ||
      topicUpper.includes('CODEATHON')
    ) {
      kind = 'assessment';
    } else if (
      typeUpper.includes('SELF-PACED') ||
      typeUpper.includes('SELF PACED') ||
      typeUpper.includes('ASYNC')
    ) {
      kind = 'self_paced';
    } else {
      kind = 'live';
    }

    // For assignments or module ends that have no explicit date cell,
    // inherit the session date from the day/session row they belong to
    if (!formattedDate && (kind === 'assignment' || kind === 'module_end' || kind === 'self_paced')) {
      formattedDate = currentDate;
    }

    itemCounter++;
    const id =
      kind === 'assignment' && assignmentNumber
        ? `assignment_${assignmentNumber}`
        : kind === 'module_end' && assignmentNumber
        ? `module_end_${assignmentNumber}`
        : `item_${itemCounter}`;

    const normalizedTitle = normalizeAssignmentTitle(rawTopic);

    const rawItem = {
      id,
      week: currentWeek,
      day: currentDay,
      module: currentModule,
      topic: rawTopic,
      sessionType: rawType || (kind === 'assignment' || kind === 'self_paced' ? 'Self-Paced' : 'Live'),
      hours,
      date: formattedDate,
      resource: rawResource || null,
      status: rawStatus || null,
      kind,
      assignmentNumber,
      normalizedTitle,
      rawTopic,
    };

    const validated = RoadmapItemSchema.parse(rawItem);
    items.push(validated);
  }

  return items;
}

/**
 * Loads workbook from binary Buffer and parses Session Tracker worksheet
 */
export async function parseRoadmapFromBuffer(buffer: Buffer): Promise<RoadmapItem[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const trackerSheet = workbook.worksheets.find((ws) => {
    const n = normalize(ws.name);
    return (
      n === 'core session | tracker' ||
      n === 'session tracker | core' ||
      (n.includes('tracker') && n.includes('core')) ||
      n.includes('roadmap')
    );
  });

  if (!trackerSheet) {
    const available = workbook.worksheets.map((w) => w.name).join(', ');
    throw new Error(`Missing Session Tracker worksheet in academic workbook. Found: ${available}`);
  }

  return parseRoadmapWorksheet(trackerSheet);
}

