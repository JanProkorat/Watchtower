import type { WorklogRow } from '../types.js';

export interface WorklogDay {
  date: string;
  totalMinutes: number;
  entries: WorklogRow[];
}

export function groupWorklogsByDay(
  rows: WorklogRow[],
  opts: { month: string; projectId?: number },
): WorklogDay[] {
  const { month, projectId } = opts;
  const byDate = new Map<string, WorklogDay>();
  for (const r of rows) {
    if (r.workDate.slice(0, 7) !== month) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;
    const day = byDate.get(r.workDate) ?? { date: r.workDate, totalMinutes: 0, entries: [] };
    day.totalMinutes += r.minutes;
    day.entries.push(r);
    byDate.set(r.workDate, day);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
