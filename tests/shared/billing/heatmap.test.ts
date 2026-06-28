import { describe, it, expect } from 'vitest';
import { activityHeatmap } from '../../../packages/shared/src/billing/heatmap.js';
import type { WorklogRow } from '../../../packages/shared/src/billing/types.js';
const wl = (workDate: string, minutes: number): WorklogRow => ({
  syncId: workDate, workDate, minutes, effectiveMinutes: minutes, earnedAmount: 0,
  projectId: 1, projectName: 'A', projectColor: null, projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null,
});

describe('activityHeatmap', () => {
  it('zero-fills the window and computes streak stats', () => {
    // window 7 days ending 2026-06-07; active: 06-05,06-06,06-07 (streak to today=3), plus 06-01
    const rows = [wl('2026-06-01', 60), wl('2026-06-05', 120), wl('2026-06-06', 30), wl('2026-06-07', 90)];
    const r = activityHeatmap(rows, { today: '2026-06-07', windowDays: 7 });
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toEqual({ date: '2026-06-01', minutes: 60 });
    expect(r.stats.activeDays).toBe(4);
    expect(r.stats.currentStreak).toBe(3);   // 06-05,06,07
    expect(r.stats.longestStreak).toBe(3);
    expect(r.stats.busiestDay).toBe('2026-06-05'); // 120 min
    expect(r.stats.weeklyAvgMinutes).toBe(Math.round((300 / 7) * 7)); // total 300
  });
});
