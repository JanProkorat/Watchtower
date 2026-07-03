import type { WorklogRow } from '../types.js';

export interface TaskGridRow {
  key: string;
  projectId: number;
  taskNumber: string | null;
  taskTitle: string | null;
  projectColor: string | null;
  perDay: number[];
  /**
   * Expected time for the task, in minutes. Manual estimate wins; falls back
   * to the estimate pulled from Jira (see `estimatesByKey`). Null when neither
   * is known. Mirrors the desktop grid's `estimatedMinutes`.
   */
  estimatedMinutes: number | null;
}

export interface TaskGridResult {
  tasks: TaskGridRow[];
  dailyTotals: number[];
  dailyEarnings: number[];
  monthTotalMinutes: number;
  monthTotalCzk: number;
  daysInMonth: number;
}

export function buildTaskGrid(
  rows: WorklogRow[],
  opts: {
    month: string;
    projectId?: number;
    /**
     * Expected-time lookup keyed by `${projectId}:${taskNumber ?? ''}` (the
     * same key this builder buckets tasks under). Value is the already-resolved
     * estimate in minutes (manual estimate with the Jira fallback applied by
     * the caller). Absent key → row.estimatedMinutes stays null.
     */
    estimatesByKey?: Map<string, number | null>;
  },
): TaskGridResult {
  const { month, projectId, estimatesByKey } = opts;
  const parts = month.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of m

  const byTask = new Map<string, TaskGridRow>();
  const dailyTotals: number[] = Array.from({ length: daysInMonth }, () => 0);
  const dailyEarnings: number[] = Array.from({ length: daysInMonth }, () => 0);
  let monthTotalMinutes = 0;
  let monthTotalCzk = 0;

  for (const r of rows) {
    if (r.workDate.slice(0, 7) !== month) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;
    const dayIdx = Number(r.workDate.slice(8, 10)) - 1;
    const key = `${r.projectId}:${r.taskNumber ?? ''}`;
    let row = byTask.get(key);
    if (!row) {
      const perDay: number[] = [];
      for (let i = 0; i < daysInMonth; i++) {
        perDay.push(0);
      }
      row = {
        key,
        projectId: r.projectId,
        taskNumber: r.taskNumber,
        taskTitle: r.taskTitle,
        projectColor: r.projectColor,
        perDay,
        estimatedMinutes: estimatesByKey?.get(key) ?? null,
      };
      byTask.set(key, row);
    }

    row.perDay[dayIdx]! += r.minutes;

    dailyTotals[dayIdx]! += r.minutes;
    monthTotalMinutes += r.minutes;
    // Earnings gate on isBillable (not just earnedAmount != null): earnedAmount is
    // resolved from any matching contract regardless of billability, so a non-billable
    // project with a rate would otherwise inflate the grid totals past the Earnings/Reports
    // tabs (earnings-summary.ts uses the same isBillable gate) and the desktop grid.
    if (r.isBillable && r.earnedAmount != null) {
      dailyEarnings[dayIdx]! += r.earnedAmount;
      monthTotalCzk += r.earnedAmount;
    }
  }

  const tasks = [...byTask.values()].sort((a, b) =>
    a.projectId !== b.projectId
      ? a.projectId - b.projectId
      : (a.taskNumber ?? '').localeCompare(b.taskNumber ?? '', undefined, { numeric: true }),
  );

  return { tasks, dailyTotals, dailyEarnings, monthTotalMinutes, monthTotalCzk, daysInMonth };
}
