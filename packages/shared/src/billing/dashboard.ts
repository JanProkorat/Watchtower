import type { WorklogRow } from './types.js';

const DAY = 86_400_000;
const toUTC = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmt = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

export function sprintWindow(anchor: string, startDate = '2026-01-05', lengthDays = 14) {
  const len = Math.min(56, Math.max(1, lengthDays));
  const days = Math.floor((toUTC(anchor) - toUTC(startDate)) / DAY);
  const idx = Math.floor(days / len);
  const from = toUTC(startDate) + idx * len * DAY;
  return { from: fmt(from), to: fmt(from + (len - 1) * DAY) };
}

const isCzk = (r: WorklogRow) => r.rateCurrency === 'CZK' && r.earnedAmount != null;
function agg(rows: WorklogRow[], pred: (r: WorklogRow) => boolean) {
  let minutes = 0, earnedCzk = 0;
  for (const r of rows) { if (!pred(r)) continue; minutes += r.minutes; if (isCzk(r)) earnedCzk += r.earnedAmount!; }
  return { minutes, earnedCzk };
}

export function dashboardKpis(rows: WorklogRow[], opts: { today: string; sprint?: { startDate?: string; lengthDays?: number } }) {
  const month = opts.today.slice(0, 7);
  const sw = sprintWindow(opts.today, opts.sprint?.startDate, opts.sprint?.lengthDays);
  return {
    today: agg(rows, (r) => r.workDate === opts.today),
    sprint: { ...agg(rows, (r) => r.workDate >= sw.from && r.workDate <= sw.to), from: sw.from, to: sw.to },
    month: agg(rows, (r) => r.workDate.slice(0, 7) === month),
  };
}
