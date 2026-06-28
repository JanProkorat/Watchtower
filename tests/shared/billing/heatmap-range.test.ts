import { describe, it, expect } from 'vitest';
import { activityHeatmap, activityHeatmapRange } from '../../../packages/shared/src/billing/heatmap.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';

function wl(date: string, minutes: number): WorklogRow {
  return {
    syncId: date, workDate: date, minutes, effectiveMinutes: minutes,
    earnedAmount: null, rateCurrency: null, projectId: 1, projectName: 'P',
    projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
  };
}

describe('activityHeatmapRange', () => {
  it('zero-fills the inclusive range and uses raw minutes per day', () => {
    const rows = [wl('2026-06-01', 60), wl('2026-06-03', 120)];
    const r = activityHeatmapRange(rows, { from: '2026-06-01', to: '2026-06-03' });
    expect(r.days).toEqual([
      { date: '2026-06-01', minutes: 60 },
      { date: '2026-06-02', minutes: 0 },
      { date: '2026-06-03', minutes: 120 },
    ]);
    expect(r.stats.activeDays).toBe(2);
    expect(r.stats.busiestDay).toBe('2026-06-03');
  });

  it('currentStreak counts consecutive active days ending at `to`', () => {
    const rows = [wl('2026-06-02', 30), wl('2026-06-03', 30)];
    const r = activityHeatmapRange(rows, { from: '2026-06-01', to: '2026-06-03' });
    expect(r.stats.currentStreak).toBe(2);
  });
});

describe('activityHeatmap (unchanged)', () => {
  it('still produces a windowDays-length series ending at today', () => {
    const rows = [wl('2026-06-10', 60)];
    const r = activityHeatmap(rows, { today: '2026-06-10', windowDays: 7 });
    expect(r.days).toHaveLength(7);
    expect(r.days[6]).toEqual({ date: '2026-06-10', minutes: 60 });
  });
});
