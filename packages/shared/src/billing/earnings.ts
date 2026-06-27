import type { WorklogRow, ProjectEarning } from './types.js';
export type { ProjectEarning } from './types.js';

const inMonth = (workDate: string, month: string) => workDate.slice(0, 7) === month;
const isCzkEarned = (r: WorklogRow) => r.rateCurrency === 'CZK' && r.earnedAmount != null;

export function aggregateMonthEarnings(rows: WorklogRow[], month: string) {
  const byProject = new Map<number, ProjectEarning>();
  let totalCzk = 0;
  for (const r of rows) {
    if (!inMonth(r.workDate, month) || !isCzkEarned(r)) continue;
    totalCzk += r.earnedAmount!;
    const cur = byProject.get(r.projectId) ?? { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.minutes;
    cur.earnedCzk += r.earnedAmount!;
    byProject.set(r.projectId, cur);
  }
  const perProject = [...byProject.values()].sort((a, b) => b.earnedCzk - a.earnedCzk);
  return { totalCzk, perProject };
}

function addMonths(month: string, delta: number): string {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function trailingMonths(rows: WorklogRow[], endMonth: string, n: number) {
  const months = Array.from({ length: n }, (_, i) => addMonths(endMonth, -(n - 1 - i)));
  const totals = new Map(months.map((m) => [m, 0]));
  for (const r of rows) {
    if (!isCzkEarned(r)) continue;
    const m = r.workDate.slice(0, 7);
    if (totals.has(m)) totals.set(m, totals.get(m)! + r.earnedAmount!);
  }
  return months.map((month) => ({ month, earnedCzk: totals.get(month)! }));
}

export function topProjects(rows: WorklogRow[], month: string, limit: number) {
  const by = new Map<number, { projectId: number; name: string; color: string | null; minutes: number; earnedCzk: number }>();
  for (const r of rows) {
    if (!inMonth(r.workDate, month)) continue;
    const cur = by.get(r.projectId) ?? { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.minutes;
    if (isCzkEarned(r)) cur.earnedCzk += r.earnedAmount!;
    by.set(r.projectId, cur);
  }
  return [...by.values()]
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
    .slice(0, limit);
}
