export function computeAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return Number((sum / values.length).toFixed(1));
}

export function computeDelta(current: number, previous: number | null): number | null {
  if (previous === null || previous === undefined) return null;
  return Number((current - previous).toFixed(1));
}

export function getTrendDirection(
  delta: number | null,
  tolerance = 0.05
): 'up' | 'down' | 'flat' | null {
  if (delta === null) return null;
  if (delta >= tolerance) return 'up';
  if (delta <= -tolerance) return 'down';
  return 'flat';
}

export type MovementType = 'IMPROVED' | 'SAME' | 'DECLINED';

export function classifyMovement(delta: number, tolerance = 2): MovementType {
  if (delta >= tolerance) return 'IMPROVED';
  if (delta <= -tolerance) return 'DECLINED';
  return 'SAME';
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const val = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Number(val.toFixed(1));
}

