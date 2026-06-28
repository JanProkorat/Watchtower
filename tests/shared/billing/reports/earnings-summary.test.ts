import { describe, it, expect } from 'vitest';
import { earningsSummary } from '../../../../packages/shared/src/billing/reports/earnings-summary.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1',
    projectColor: '#fff', projectKind: 'work', isBillable: true,
    taskNumber: null, taskTitle: null, ...over,
  };
}

describe('earningsSummary', () => {
  it('splits billable/unbillable minutes and sums CZK earnings', () => {
    const rows = [
      wl({ projectId: 1, isBillable: true, effectiveMinutes: 120, earnedAmount: 2000 }),
      wl({ projectId: 2, isBillable: false, effectiveMinutes: 60, earnedAmount: null, projectName: 'P2' }),
    ];
    const r = earningsSummary(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(r.billableMinutes).toBe(120);
    expect(r.unbillableMinutes).toBe(60);
    expect(r.totalCzk).toBe(2000);
    expect(r.avgEffectiveHourlyRateCzk).toBe(1000); // 2000 / (120/60)
    expect(r.perProject).toEqual([
      { projectId: 1, name: 'P1', color: '#fff', minutes: 120, earnedCzk: 2000 },
    ]);
  });

  it('avg rate is null when there are no CZK-billable minutes', () => {
    const rows = [wl({ isBillable: false, earnedAmount: null })];
    expect(earningsSummary(rows, { from: '2026-06-01', to: '2026-06-30' }).avgEffectiveHourlyRateCzk).toBeNull();
  });

  it('excludes time_off from billable/unbillable and rows with no earned amount from earnings', () => {
    const rows = [
      wl({ projectKind: 'time_off', isBillable: false, effectiveMinutes: 480 }),
      wl({ earnedAmount: null, effectiveMinutes: 60 }),
    ];
    const r = earningsSummary(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(r.unbillableMinutes).toBe(0);
    expect(r.totalCzk).toBe(0);
    expect(r.perProject).toEqual([]);
  });
});
