/**
 * PII Masking helpers for privacy during demos or shared screens.
 */

export function maskName(name: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts
    .map((part) => {
      if (part.length <= 2) return part;
      return part[0] + '*'.repeat(Math.max(2, part.length - 2)) + part[part.length - 1];
    })
    .join(' ');
}

export function maskPhone(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.trim();
  if (cleaned.length < 6) return '******';
  const prefix = cleaned.slice(0, 3);
  const suffix = cleaned.slice(-4);
  return `${prefix} ****** ${suffix}`;
}

export function formatStudentName(name: string, mask: boolean): string {
  return mask ? maskName(name) : name;
}

export function formatStudentPhone(phone: string, mask: boolean): string {
  return mask ? maskPhone(phone) : phone;
}
