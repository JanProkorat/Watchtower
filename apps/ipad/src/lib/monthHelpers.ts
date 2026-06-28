// Pure helpers for month arithmetic and Czech month labels.
// No DOM, no React, no side-effects — safe to unit-test directly.

const CZECH_MONTHS = [
  'Leden',
  'Únor',
  'Březen',
  'Duben',
  'Květen',
  'Červen',
  'Červenec',
  'Srpen',
  'Září',
  'Říjen',
  'Listopad',
  'Prosinec',
] as const;

/**
 * Returns a Czech month label for the given YYYY-MM string.
 * Example: '2026-06' → 'Červen 2026'
 */
export function czechMonthLabel(month: string): string {
  const parts = month.split('-');
  const year = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '1', 10);
  const name = CZECH_MONTHS[m - 1] ?? '';
  return `${name} ${year}`;
}

/**
 * Shifts a YYYY-MM string by `delta` months (negative = earlier).
 * Uses UTC arithmetic so DST cannot cause off-by-one.
 * Example: addMonths('2026-01', -1) → '2025-12'
 */
export function addMonths(month: string, delta: number): string {
  const parts = month.split('-');
  const y = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '1', 10);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
