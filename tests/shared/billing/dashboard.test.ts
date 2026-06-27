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
    expect(r.sprint.minutes).toBe(180);        // 120 + 60
    expect(r.sprint.earnedCzk).toBe(4500);     // 3000 + 1500 (today + in-sprint row)
    expect(r.month.minutes).toBe(210);          // 120 + 60 + 30
    expect(r.month.earnedCzk).toBe(5250);       // 3000 + 1500 + 750
  });
});

describe('sprintWindow — custom args and clamp', () => {
  it('custom startDate/lengthDays produces correct window', () => {
    // anchor 2026-06-27, default start 2026-01-05, len 7
    // days = 173, idx = 24, from = 2026-01-05 + 168d = 2026-06-22, to = 2026-06-28
    expect(sprintWindow('2026-06-27', '2026-01-05', 7)).toEqual({ from: '2026-06-22', to: '2026-06-28' });
  });

  it('clamps lengthDays: 0 to 1 (single-day window)', () => {
    // len clamps to 1; days = 173, idx = 173, from = to = 2026-06-27
    expect(sprintWindow('2026-06-27', '2026-01-05', 0)).toEqual({ from: '2026-06-27', to: '2026-06-27' });
  });

  it('clamps lengthDays: 100 to 56 (to = from + 55 days)', () => {
    // len clamps to 56; days = 173, idx = 3, from = 2026-01-05 + 168d = 2026-06-22, to = 2026-06-22 + 55d = 2026-08-16
    expect(sprintWindow('2026-06-27', '2026-01-05', 100)).toEqual({ from: '2026-06-22', to: '2026-08-16' });
  });
});

describe('sprintWindow — negative anchor (documented edge)', () => {
  it('anchor before epoch yields an earlier window by design (call site always passes today >= epoch)', () => {
    // anchor 2025-12-31 is 5 days before epoch 2026-01-05
    // days = -5, idx = floor(-5/14) = -1, from = 2026-01-05 - 14d = 2025-12-22, to = 2026-01-04
    expect(sprintWindow('2025-12-31')).toEqual({ from: '2025-12-22', to: '2026-01-04' });
  });
});
