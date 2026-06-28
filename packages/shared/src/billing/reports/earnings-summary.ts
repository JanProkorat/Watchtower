import type { WorklogRow, ProjectEarning } from '../types.js';

const isCzkEarned = (r: WorklogRow) => r.rateCurrency === 'CZK' && r.earnedAmount != null;

export interface EarningsSummaryResult {
  totalCzk: number;
  billableMinutes: number;
  unbillableMinutes: number;
  avgEffectiveHourlyRateCzk: number | null;
  perProject: ProjectEarning[];
}

export function earningsSummary(
  rows: WorklogRow[],
  opts: { from: string; to: string; projectId?: number },
): EarningsSummaryResult {
  const { from, to, projectId } = opts;
  let totalCzk = 0;
  let czkBillableMinutes = 0;
  let billableMinutes = 0;
  let unbillableMinutes = 0;
  const byProject = new Map<number, ProjectEarning>();

  for (const r of rows) {
    if (r.workDate < from || r.workDate > to) continue;
    if (projectId !== undefined && r.projectId !== projectId) continue;

    if (r.projectKind === 'work' && r.isBillable) billableMinutes += r.effectiveMinutes;
    if (r.projectKind === 'work' && !r.isBillable) unbillableMinutes += r.effectiveMinutes;

    if (r.isBillable && isCzkEarned(r)) {
      totalCzk += r.earnedAmount!;
      czkBillableMinutes += r.effectiveMinutes;
      const cur =
        byProject.get(r.projectId) ??
        { projectId: r.projectId, name: r.projectName, color: r.projectColor, minutes: 0, earnedCzk: 0 };
      cur.minutes += r.effectiveMinutes;
      cur.earnedCzk += r.earnedAmount!;
      byProject.set(r.projectId, cur);
    }
  }

  const avgEffectiveHourlyRateCzk = czkBillableMinutes > 0 ? totalCzk / (czkBillableMinutes / 60) : null;
  const perProject = [...byProject.values()].sort((a, b) => b.earnedCzk - a.earnedCzk);
  return { totalCzk, billableMinutes, unbillableMinutes, avgEffectiveHourlyRateCzk, perProject };
}
