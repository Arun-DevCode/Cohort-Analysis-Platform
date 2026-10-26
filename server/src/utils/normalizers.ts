import crypto from 'crypto';

/**
 * Phone number normalization to E.164 standard.
 */
export function normalizePhone(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const str = String(raw).trim();
  if (!str) return '';

  // Remove whitespace, dashes, parens, dots
  let cleaned = str.replace(/[\s\-().]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // If 10 digits without country code, assume India (+91)
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // If 12 digits starting with 91
  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  // Fallback: prepend + if only digits
  if (/^\d+$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return cleaned;
}

/**
 * Standardize names for fallback matching.
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Normalize percentages from number or string like "20.7%" into float.
 */
export function parsePercentage(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    return isNaN(value) ? 0 : Number(value.toFixed(2));
  }
  const str = String(value).trim();
  if (!str) return 0;
  const cleaned = str.replace('%', '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Number(num.toFixed(2));
}

/**
 * Parse numeric count or float with default.
 */
export function parseNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined || value === '') return defaultValue;
  if (typeof value === 'number') {
    return isNaN(value) ? defaultValue : value;
  }
  const str = String(value).trim();
  const num = parseFloat(str);
  return isNaN(num) ? defaultValue : num;
}

export interface ParsedAssignmentCell {
  status: string;
  score: number | null;
}

/**
 * Parse assignment cell formatted as "STATUS / score" (e.g. "PASSED / 10" or "SUBMISSION_PENDING / -")
 */
export function parseAssignmentCell(value: unknown): ParsedAssignmentCell {
  if (value === null || value === undefined || value === '') {
    return { status: 'NOT_SUBMITTED', score: null };
  }
  const str = String(value).trim();
  if (!str.includes('/')) {
    return { status: str.toUpperCase(), score: null };
  }
  const [statusPart, scorePart] = str.split('/').map((s) => s.trim());
  const status = (statusPart || 'UNKNOWN').toUpperCase();
  if (!scorePart || scorePart === '-' || scorePart.toLowerCase() === 'na' || scorePart.toLowerCase() === 'null') {
    return { status, score: null };
  }
  const parsedScore = parseFloat(scorePart);
  return {
    status,
    score: isNaN(parsedScore) ? null : parsedScore,
  };
}

export interface ParsedWeekCell {
  consumed: number;
  total: number;
}

/**
 * Parse week cell formatted as "a/b" into consumed and total
 */
export function parseWeekCell(value: unknown): ParsedWeekCell {
  if (value === null || value === undefined || value === '') {
    return { consumed: 0, total: 0 };
  }
  const str = String(value).trim();
  if (str.includes('/')) {
    const [c, t] = str.split('/').map((s) => s.trim());
    const consumed = parseInt(c, 10);
    const total = parseInt(t, 10);
    return {
      consumed: isNaN(consumed) ? 0 : Math.max(0, consumed),
      total: isNaN(total) ? 0 : Math.max(0, total),
    };
  }
  const single = parseInt(str, 10);
  return {
    consumed: isNaN(single) ? 0 : single,
    total: 0,
  };
}

/**
 * Extract session date in ISO YYYY-MM-DD from column names like
 * "TN-AFSD-ANB49-21OCT-Phase 2 Reflection  Over-21-10-2026"
 */
export function extractSessionDate(columnHeader: string): string | null {
  if (!columnHeader) return null;
  const match = columnHeader.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3];
  return `${year}-${month}-${day}`;
}

/**
 * Compute SHA-256 hash of buffer for file deduplication
 */
export function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
