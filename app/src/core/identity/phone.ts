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
