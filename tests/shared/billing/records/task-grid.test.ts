import { describe, it, expect } from 'vitest';
import { buildTaskGrid } from '../../../../packages/shared/src/billing/records/task-grid.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1', projectColor: '#fff',
    projectKind: 'work', isBillable: true, taskNumber: 'X-1', taskTitle: 'T',
    source: 'manual', ...over,
  };
}

describe('buildTaskGrid', () => {
  it('builds tasks×days with per-day minutes, totals, and CZK earnings', () => {
    const rows = [
      wl({ taskNumber: 'X-2', workDate: '2026-06-01', minutes: 60, earnedAmount: 1000 }),
      wl({ taskNumber: 'X-2', workDate: '2026-06-02', minutes: 30, earnedAmount: 500 }),
      wl({ taskNumber: 'X-10', workDate: '2026-06-01', minutes: 45, earnedAmount: 750 }),
    ];
    const g = buildTaskGrid(rows, { month: '2026-06' });
    expect(g.daysInMonth).toBe(30);
    // natural-numeric sort: X-2 before X-10
    expect(g.tasks.map((t) => t.taskNumber)).toEqual(['X-2', 'X-10']);
    expect(g.tasks[0].perDay[0]).toBe(60); // X-2, June 1
    expect(g.tasks[0].perDay[1]).toBe(30); // X-2, June 2
    expect(g.dailyTotals[0]).toBe(105);    // 60 + 45
    expect(g.dailyEarnings[0]).toBe(1750); // 1000 + 750
    expect(g.monthTotalMinutes).toBe(135);
    expect(g.monthTotalCzk).toBe(2250);
  });

  it('attaches estimatedMinutes from estimatesByKey (null when absent)', () => {
    const rows = [
      wl({ projectId: 1, taskNumber: 'X-2', workDate: '2026-06-01', minutes: 60 }),
      wl({ projectId: 1, taskNumber: 'X-10', workDate: '2026-06-01', minutes: 45 }),
    ];
    const estimatesByKey = new Map<string, number | null>([['1:X-2', 120]]);
    const g = buildTaskGrid(rows, { month: '2026-06', estimatesByKey });
    const byNum = Object.fromEntries(g.tasks.map((t) => [t.taskNumber, t.estimatedMinutes]));
    expect(byNum['X-2']).toBe(120); // keyed 1:X-2
    expect(byNum['X-10']).toBe(null); // no entry
  });

  it('leaves estimatedMinutes null when no estimatesByKey is passed', () => {
    const g = buildTaskGrid([wl({ taskNumber: 'X-1', workDate: '2026-06-01' })], { month: '2026-06' });
    expect(g.tasks[0].estimatedMinutes).toBeNull();
  });

  it('buckets null taskNumber into one row per project and filters month/project', () => {
    const rows = [
      wl({ projectId: 1, taskNumber: null, workDate: '2026-06-05', minutes: 20 }),
      wl({ projectId: 2, taskNumber: 'Y-1', workDate: '2026-06-05', minutes: 60 }),
      wl({ taskNumber: 'X-1', workDate: '2026-05-30', minutes: 99 }),
    ];
    const g = buildTaskGrid(rows, { month: '2026-06', projectId: 1 });
    expect(g.tasks).toHaveLength(1);
    expect(g.tasks[0].taskNumber).toBeNull();
    expect(g.tasks[0].perDay[4]).toBe(20); // June 5
    expect(g.monthTotalMinutes).toBe(20);
  });

  it('excludes non-billable earnings from totals but still counts the minutes', () => {
    const rows = [
      wl({ taskNumber: 'X-1', workDate: '2026-06-01', minutes: 60, earnedAmount: 1000, isBillable: true }),
      // non-billable project with a resolved earnedAmount must NOT add to earnings
      wl({ projectId: 2, taskNumber: 'Y-1', workDate: '2026-06-01', minutes: 30, earnedAmount: 500, isBillable: false }),
    ];
    const g = buildTaskGrid(rows, { month: '2026-06' });
    expect(g.tasks).toHaveLength(2);          // both tasks present (minutes shown)
    expect(g.dailyTotals[0]).toBe(90);        // 60 + 30 minutes
    expect(g.monthTotalMinutes).toBe(90);
    expect(g.dailyEarnings[0]).toBe(1000);    // only the billable 1000, not 1500
    expect(g.monthTotalCzk).toBe(1000);
  });
});
