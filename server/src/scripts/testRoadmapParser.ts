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
  assignmentNumber: z.number().nullable().optional(),
  title: z.string(),
});

export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

export function parseRoadmap(worksheet: ExcelJS.Worksheet): RoadmapItem[] {
  const items: RoadmapItem[] = [];

  // Header is at row 4
  let currentWeek = '';
  let currentDay = '';
  let currentModule = '';

  for (let r = 5; r <= worksheet.rowCount; r++) {
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

    // If topic is empty, skip
    if (!rawTopic) continue;

    // Carry forward week, day, module if blank
    if (rawWeek) currentWeek = rawWeek;
    if (rawDay) currentDay = rawDay;
    if (rawModule) currentModule = rawModule;

    // Parse date
    let formattedDate: string | null = null;
    if (rawDate instanceof Date) {
      formattedDate = rawDate.toISOString().split('T')[0];
    } else if (rawDate && typeof rawDate === 'string' && rawDate.trim()) {
      formattedDate = rawDate.trim().split('T')[0];
    } else if (rawDate && typeof rawDate === 'object' && 'result' in rawDate && rawDate.result instanceof Date) {
      formattedDate = rawDate.result.toISOString().split('T')[0];
    }

    // Parse hours / duration
    let hours: number | null = null;
    if (typeof rawDuration === 'number') {
      hours = rawDuration;
    } else if (rawDuration) {
      const parsed = parseFloat(String(rawDuration));
      if (!isNaN(parsed)) hours = parsed;
    }

    // Classify kind
    let kind: RoadmapItemKind = 'live';
    const topicUpper = rawTopic.toUpperCase();
    const typeUpper = rawType.toUpperCase();

    let assignmentNumber: number | null = null;
    let title = rawTopic;

    // 1. Assignment check: pattern 'Assignment: N (title)' or 'Assignment:N'
    const assignMatch = rawTopic.match(/^Assignment\s*:\s*(\d+)\s*\((.*?)\)/i) ||
                        rawTopic.match(/^Assignment\s*:\s*(\d+)/i);
    if (assignMatch) {
      kind = 'assignment';
      assignmentNumber = parseInt(assignMatch[1], 10);
      title = assignMatch[2] ? assignMatch[2].trim() : rawTopic;
    }
    // 2. Module-End check: pattern 'Module-End N (title)' or 'Module-End'
    else if (rawTopic.match(/^Module-End\s*(\d+)?\s*\((.*?)\)/i) || rawTopic.match(/^Module-End/i)) {
      kind = 'module_end';
      const mEndMatch = rawTopic.match(/^Module-End\s*(\d+)?\s*\((.*?)\)/i);
      if (mEndMatch) {
        if (mEndMatch[1]) assignmentNumber = parseInt(mEndMatch[1], 10);
        title = mEndMatch[2] ? mEndMatch[2].trim() : rawTopic;
      }
    }
    // 3. Milestone check
    else if (topicUpper.includes('MILESTONE') || topicUpper.includes('REFLECTION')) {
      kind = 'milestone';
    }
    // 4. Assessment check
    else if (topicUpper.includes('ASSESSMENT') || topicUpper.includes('MCQ') || topicUpper.includes('CODEATHON')) {
      kind = 'assessment';
    }
    // 5. Self-Paced
    else if (typeUpper.includes('SELF-PACED') || typeUpper.includes('SELF PACED') || typeUpper.includes('ASYNC')) {
      kind = 'self_paced';
    }
    // 6. Live
    else {
      kind = 'live';
    }

    const item: RoadmapItem = {
      week: currentWeek || 'Week 1',
      day: currentDay || 'Day 1',
      module: currentModule || 'Module 1',
      topic: rawTopic,
      sessionType: rawType || (kind === 'assignment' || kind === 'self_paced' ? 'Self-Paced' : 'Live'),
      hours,
      date: formattedDate,
      resource: rawResource || null,
      status: rawStatus || null,
      kind,
      assignmentNumber,
      title,
    };

    // Validate with Zod
    const validated = RoadmapItemSchema.parse(item);
    items.push(validated);
  }

  return items;
}

async function testParse() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('D:/Resource/Agentic FSD-ANB49 _ V9.xlsx');
  const ws = wb.getWorksheet('Core session | Tracker')!;
  const parsed = parseRoadmap(ws);

  console.log(`\nSuccessfully parsed ${parsed.length} total roadmap items!`);

  const counts: Record<string, number> = {};
  for (const item of parsed) {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  }
  console.log('\nCounts per kind:');
  console.table(counts);

  console.log('\nParsed Assignment & Module-End items:');
  for (const item of parsed) {
    if (item.kind === 'assignment' || item.kind === 'module_end') {
      console.log(`- [${item.kind.toUpperCase()}] ${item.week} | ${item.day} | ${item.topic} | Title: "${item.title}" | Date: ${item.date}`);
    }
  }
}

testParse();

