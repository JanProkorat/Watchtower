
export type Granularity = 'day' | 'week' | 'month';

function addDay(date: string): string {
  const parts = date.split('-').map(Number);
  const [y, m, d] = [parts[0]!, parts[1]!, parts[2]!];
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

export function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  // week: mirror SQLite strftime('%Y-W%W') — Monday-first, week 00 before first Monday.
  const parts = date.split('-').map(Number);
  const [y, m, d] = [parts[0]!, parts[1]!, parts[2]!];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const yday = Math.floor((dt.getTime() - jan1.getTime()) / 86_400_000); // 0-based day of year
  const daysSinceMonday = (dt.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const week = Math.floor((yday - daysSinceMonday + 7) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

export function enumerateBuckets(from: string, to: string, granularity: Granularity): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cursor = from;
  while (cursor <= to) {
    const key = bucketKey(cursor, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    cursor = addDay(cursor);
  }
  return out;
}
