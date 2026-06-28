import { describe, it, expect } from 'vitest';
import { aggregateMonthEarnings, trailingMonths, topProjects } from '../../../packages/shared/src/billing/earnings.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';

const wl = (o: Partial<WorklogRow>): WorklogRow => ({
  syncId: Math.random().toString(36).slice(2), workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
  earnedAmount: 1500, projectId: 1, projectName: 'A', projectColor: null,
  projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null, ...o,
});

describe('aggregateMonthEarnings', () => {
  it('sums CZK earned per project within the month, sorted desc', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'A', workDate: '2026-06-02', earnedAmount: 1000, minutes: 60 }),
      wl({ projectId: 1, projectName: 'A', workDate: '2026-06-10', earnedAmount: 2000, minutes: 120 }),
      wl({ projectId: 2, projectName: 'B', workDate: '2026-06-05', earnedAmount: 500, minutes: 30 }),
      wl({ projectId: 2, projectName: 'B', workDate: '2026-05-31', earnedAmount: 9999, minutes: 600 }), // other month
    ];
    const r = aggregateMonthEarnings(rows, '2026-06');
    expect(r.totalCzk).toBe(3500);
    expect(r.perProject.map(p => [p.name, p.earnedCzk])).toEqual([['A', 3000], ['B', 500]]);
  });

  it('ignores null earned rows for totalCzk but still counts minutes', () => {
    const rows = [
      wl({ earnedAmount: 1000 }),
      wl({ earnedAmount: 50 }),
      wl({ earnedAmount: null }),
    ];
    expect(aggregateMonthEarnings(rows, '2026-06').totalCzk).toBe(1050);
  });

  it('includes project in perProject with minutes counted even when earnedAmount is null', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'A', earnedAmount: null, minutes: 45 }),
    ];
    const r = aggregateMonthEarnings(rows, '2026-06');
    expect(r.totalCzk).toBe(0);
    expect(r.perProject).toHaveLength(1);
    expect(r.perProject[0]).toMatchObject({ name: 'A', minutes: 45, earnedCzk: 0 });
  });

  it('counts all minutes and sums all earned amounts for a project', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'Alpha', earnedAmount: 1500, minutes: 60 }),
      wl({ projectId: 1, projectName: 'Alpha', earnedAmount: 50, minutes: 30 }),
    ];
    const r = aggregateMonthEarnings(rows, '2026-06');
    expect(r.totalCzk).toBe(1550);
    expect(r.perProject).toHaveLength(1);
    expect(r.perProject[0]).toMatchObject({ name: 'Alpha', minutes: 90, earnedCzk: 1550 });
  });
});

describe('trailingMonths', () => {
  it('returns n months ending inclusive, oldest first, zero-filled', () => {
    const rows = [wl({ workDate: '2026-06-01', earnedAmount: 100 }), wl({ workDate: '2026-04-01', earnedAmount: 50 })];
    const r = trailingMonths(rows, '2026-06', 3);
    expect(r).toEqual([
      { month: '2026-04', earnedCzk: 50 },
      { month: '2026-05', earnedCzk: 0 },
      { month: '2026-06', earnedCzk: 100 },
    ]);
  });

  it('ignores a CZK row outside the n-month window', () => {
    const rows = [
      wl({ workDate: '2026-03-15', earnedAmount: 9999 }), // outside 3-month window ending 2026-06
      wl({ workDate: '2026-06-01', earnedAmount: 200 }),
    ];
    const r = trailingMonths(rows, '2026-06', 3);
    expect(r.find(e => e.month === '2026-03')).toBeUndefined();
    expect(r.find(e => e.month === '2026-06')?.earnedCzk).toBe(200);
    expect(r.reduce((acc, e) => acc + e.earnedCzk, 0)).toBe(200);
  });
});

describe('topProjects', () => {
  it('ranks by raw minutes desc then name, excludes zero-minute', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'A', minutes: 60, earnedAmount: 1000 }),
      wl({ projectId: 2, projectName: 'B', minutes: 120, earnedAmount: 500 }),
      wl({ projectId: 3, projectName: 'C', minutes: 0, earnedAmount: 0 }),
    ];
    const r = topProjects(rows, '2026-06', 5);
    expect(r.map(p => p.name)).toEqual(['B', 'A']); // B has more minutes
  });

  it('tie-breaks equal minutes by name ascending', () => {
    const rows = [
      wl({ projectId: 1, projectName: 'Zebra', minutes: 60, earnedAmount: 1000 }),
      wl({ projectId: 2, projectName: 'Alpha', minutes: 60, earnedAmount: 500 }),
    ];
    const r = topProjects(rows, '2026-06', 5);
    expect(r.map(p => p.name)).toEqual(['Alpha', 'Zebra']);
  });
});
