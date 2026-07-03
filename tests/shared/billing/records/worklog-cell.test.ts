import { describe, it, expect } from 'vitest';
import { worklogsForCell } from '../../../../packages/shared/src/billing/records/worklog-cell.js';
import type { WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, effectiveMinutes: 60,
    earnedAmount: 1000, projectId: 1, projectName: 'P1', projectColor: '#fff',
    projectKind: 'work', isBillable: true, taskNumber: 'X-1', taskTitle: 'T',
    source: 'manual', ...over,
  };
}

describe('worklogsForCell', () => {
  it('returns only worklogs matching project + taskNumber + workDate', () => {
    const rows = [
      wl({ syncId: 'a', taskNumber: 'X-1', workDate: '2026-06-01' }),
      wl({ syncId: 'b', taskNumber: 'X-1', workDate: '2026-06-01' }),
      wl({ syncId: 'c', taskNumber: 'X-1', workDate: '2026-06-02' }), // wrong day
      wl({ syncId: 'd', taskNumber: 'X-2', workDate: '2026-06-01' }), // wrong task
      wl({ syncId: 'e', projectId: 2, taskNumber: 'X-1', workDate: '2026-06-01' }), // wrong project
    ];
    const got = worklogsForCell(rows, { projectId: 1, taskNumber: 'X-1', workDate: '2026-06-01' });
    expect(got.map((w) => w.syncId)).toEqual(['a', 'b']);
  });

  it('matches null taskNumber cells (buckets same as buildTaskGrid)', () => {
    const rows = [
      wl({ syncId: 'a', taskNumber: null, workDate: '2026-06-05' }),
      wl({ syncId: 'b', taskNumber: 'X-1', workDate: '2026-06-05' }),
    ];
    const got = worklogsForCell(rows, { projectId: 1, taskNumber: null, workDate: '2026-06-05' });
    expect(got.map((w) => w.syncId)).toEqual(['a']);
  });

  it('returns empty array when nothing matches', () => {
    const rows = [wl({ taskNumber: 'X-1', workDate: '2026-06-01' })];
    expect(worklogsForCell(rows, { projectId: 1, taskNumber: 'X-9', workDate: '2026-06-01' })).toEqual([]);
  });
});
