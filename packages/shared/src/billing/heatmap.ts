import type { WorklogRow } from './types.js';

export interface HeatmapResult {
  days: { date: string; minutes: number }[];
  stats: {
    currentStreak: number;
    longestStreak: number;
    activeDays: number;
    weeklyAvgMinutes: number;
    busiestDay: string | null;
  };
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Mirrors dashboardOverview.ts:heatmap30d + computeStats.
 *
 * window = [today-(windowDays-1), today] inclusive; days has one entry per
 * date, zero-filled, using raw `minutes` (sum per date).
 */
export function activityHeatmap(
  rows: WorklogRow[],
  opts: { today: string; windowDays?: number },
): HeatmapResult {
  const windowDays = opts.windowDays ?? 30;
  const fromDate = addDays(opts.today, -(windowDays - 1));
  const toDate = opts.today;

  // Aggregate raw minutes per date (mirrors SQL SUM(w.minutes) GROUP BY work_date).
  const grouped = new Map<string, number>();
  for (const row of rows) {
    if (row.workDate >= fromDate && row.workDate <= toDate) {
      grouped.set(row.workDate, (grouped.get(row.workDate) ?? 0) + row.minutes);
    }
  }

  // Zero-fill the full window (mirrors the for-loop in heatmap30d).
  const days: { date: string; minutes: number }[] = [];
  for (let i = 0; i < windowDays; i++) {
    const date = addDays(fromDate, i);
    days.push({ date, minutes: grouped.get(date) ?? 0 });
  }

  // computeStats mirror — uses windowDays instead of hardcoded 30.
  const map = new Map(days.map((d) => [d.date, d.minutes]));

  const activeDays = days.filter((d) => d.minutes > 0).length;
  const totalMinutes = days.reduce((acc, d) => acc + d.minutes, 0);
  const weeklyAvgMinutes = Math.round((totalMinutes / windowDays) * 7);

  // currentStreak: walk backward from today while minutes>0 (cap = windowDays).
  let cursor = toDate;
  let currentStreak = 0;
  while (map.has(cursor) && (map.get(cursor) ?? 0) > 0) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  // longestStreak: longest run of minutes>0 in the window.
  let longestStreak = 0;
  let run = 0;
  for (const d of days) {
    if (d.minutes > 0) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  // busiestDay: first date with max minutes>0; null if none.
  let busiestDay: string | null = null;
  let busiestMinutes = 0;
  for (const d of days) {
    if (d.minutes > 0 && (busiestDay === null || d.minutes > busiestMinutes)) {
      busiestDay = d.date;
      busiestMinutes = d.minutes;
    }
  }

  return {
    days,
    stats: { currentStreak, longestStreak, activeDays, weeklyAvgMinutes, busiestDay },
  };
}
