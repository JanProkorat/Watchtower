import { describe, it, expect } from 'vitest';
import { projectBreakdown } from '../../../../packages/shared/src/billing/reports/breakdown.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, rateCurrency: 'CZK', projectId: 1, projectName: 'P1',
    projectColor: '#fff', projectKind: 'work', isBillable: true,
    taskNumber: null, taskTitle: null, ...over,
  };
}

describe('projectBreakdown', () => {
  it('groups by project with minutes, CZK earnings, and share; sorted desc', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'A', effectiveMinutes: 180, earnedAmount: 3000 }),
      wl({ projectId: 2, projectName: 'B', effectiveMinutes: 60, earnedAmount: 1000 }),
    ];
    const out = projectBreakdown(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(out).toEqual([
      { projectId: 1, name: 'A', color: '#fff', minutes: 180, earnedCzk: 3000, share: 0.75 },
      { projectId: 2, name: 'B', color: '#fff', minutes: 60, earnedCzk: 1000, share: 0.25 },
    ]);
  });

  it('drops projects with zero minutes and ignores out-of-range rows', () => {
    const rows = [
      wl({ projectId: 1, effectiveMinutes: 60, workDate: '2026-05-31' }),
      wl({ projectId: 2, effectiveMinutes: 120, workDate: '2026-06-10' }),
    ];
    const out = projectBreakdown(rows, { from: '2026-06-01', to: '2026-06-30' });
    expect(out.map((s) => s.projectId)).toEqual([2]);
    expect(out[0].share).toBe(1);
  });
});
