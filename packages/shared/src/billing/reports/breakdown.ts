import type { WorklogRow } from '../types.js';

export interface ProjectBreakdownSlice {
  projectId: number;
  name: string;
  color: string | null;
  minutes: number;
  earnedCzk: number;
  share: number;
}

export function projectBreakdown(
  rows: WorklogRow[],
  opts: { from: string; to: string },
): ProjectBreakdownSlice[] {
  const { from, to } = opts;
  const map = new Map<number, Omit<ProjectBreakdownSlice, 'share'>>();
  for (const r of rows) {
    if (r.workDate < from || r.workDate > to) continue;
    const cur =
      map.get(r.projectId) ??
      { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
    cur.minutes += r.effectiveMinutes;
    // Post-#108 the app is CZK-only (rate_currency dropped); every earned amount is CZK.
    if (r.earnedAmount != null) cur.earnedCzk += r.earnedAmount;
    map.set(r.projectId, cur);
  }
  const slices = [...map.values()].filter((s) => s.minutes > 0);
  const total = slices.reduce((acc, s) => acc + s.minutes, 0);
  return slices
    .map((s) => ({ ...s, share: total > 0 ? s.minutes / total : 0 }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}
