import { describe, it, expect } from 'vitest';
import { groupWorklogsByDay } from '../../../../packages/shared/src/billing/records/worklog-list.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1', projectColor: '#fff',
    projectKind: 'work', isBillable: true, taskNumber: 'X-1', taskTitle: 'T',
    source: 'manual', ...over,
  };
}

describe('groupWorklogsByDay', () => {
  it('groups by day descending with tracked-minute totals', () => {
    const rows = [
      wl({ workDate: '2026-06-01', minutes: 60 }),
      wl({ workDate: '2026-06-01', minutes: 30 }),
      wl({ workDate: '2026-06-03', minutes: 45 }),
    ];
    const out = groupWorklogsByDay(rows, { month: '2026-06' });
    expect(out.map((d) => d.date)).toEqual(['2026-06-03', '2026-06-01']);
    expect(out[0].totalMinutes).toBe(45);
    expect(out[1].totalMinutes).toBe(90);
    expect(out[1].entries).toHaveLength(2);
  });

  it('filters by month and project', () => {
    const rows = [
      wl({ workDate: '2026-05-31', minutes: 60 }),
      wl({ workDate: '2026-06-02', projectId: 2, minutes: 60 }),
      wl({ workDate: '2026-06-02', projectId: 1, minutes: 15 }),
    ];
    const out = groupWorklogsByDay(rows, { month: '2026-06', projectId: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].totalMinutes).toBe(15);
  });
});
