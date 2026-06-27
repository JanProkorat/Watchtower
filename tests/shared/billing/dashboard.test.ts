import { describe, it, expect } from 'vitest';
import { sprintWindow, dashboardKpis } from '../../../packages/shared/src/billing/dashboard.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';

const wl = (workDate: string, minutes: number, earnedAmount: number | null = minutes * 25): WorklogRow => ({
  syncId: workDate + minutes, workDate, minutes, effectiveMinutes: minutes, earnedAmount, rateCurrency: 'CZK',
  projectId: 1, projectName: 'A', projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
});

describe('sprintWindow', () => {
  it('computes the 14-day window containing the anchor (defaults)', () => {
    // start 2026-01-05, len 14, anchor 2026-06-27 → from 2026-06-22, to 2026-07-05
    expect(sprintWindow('2026-06-27')).toEqual({ from: '2026-06-22', to: '2026-07-05' });
  });
});

describe('dashboardKpis', () => {
  it('sums raw minutes + CZK earned for today, sprint, month', () => {
    const rows = [
      wl('2026-06-27', 120, 3000), // today (= anchor)
      wl('2026-06-23', 60, 1500),  // in sprint, in month, not today
      wl('2026-06-02', 30, 750),   // in month, not sprint
      wl('2026-05-31', 600, 9999), // other month
    ];
    const r = dashboardKpis(rows, { today: '2026-06-27' });
    expect(r.today).toEqual({ minutes: 120, earnedCzk: 3000 });
    expect(r.sprint.from).toBe('2026-06-22');
    expect(r.sprint.minutes).toBe(180);   // 120 + 60
    expect(r.month.minutes).toBe(210);     // 120 + 60 + 30
    expect(r.month.earnedCzk).toBe(5250);  // 3000 + 1500 + 750
  });
});
