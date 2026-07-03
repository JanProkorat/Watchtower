import { describe, it, expect } from 'vitest';
import { buildBoard, columnForStatus } from '../../../../packages/shared/src/billing/board/board.js';
import type { TaskRow, WorklogRow } from '../../../../packages/shared/src/billing/types.js';

function task(over: Partial<TaskRow>): TaskRow {
  return {
    taskId: 1, syncId: 's', epicId: 1, taskNumber: 'X-1', taskTitle: 'T',
    status: 'in_progress', estimatedMinutes: null, description: null,
    projectId: 1, projectName: 'P', projectColor: '#fff', projectKind: 'work',
    isBillable: true, jiraStatus: 'In Progress', ...over,
  };
}
function wl(over: Partial<WorklogRow>): WorklogRow {
  return {
    syncId: 's', workDate: '2026-06-01', minutes: 60, reportedMinutes: null,
    effectiveMinutes: 60, earnedAmount: null, description: null,
    projectId: 1, projectName: 'P', projectColor: '#fff', projectKind: 'work',
    isBillable: true, taskNumber: 'X-1', taskTitle: 'T', source: 'manual', ...over,
  };
}

describe('columnForStatus', () => {
  it('maps known statuses and defaults unknown to doing', () => {
    expect(columnForStatus('New')).toBe('todo');
    expect(columnForStatus('To Accept')).toBe('to_accept');
    expect(columnForStatus('Weird Custom')).toBe('doing');
  });
});

describe('buildBoard', () => {
  it('returns the three visible columns in order', () => {
    const g = buildBoard([], []);
    expect(g.columns.map((c) => c.key)).toEqual(['todo', 'doing', 'to_accept']);
  });

  it('groups tasks into columns by jiraStatus', () => {
    const g = buildBoard(
      [
        task({ taskNumber: 'A-1', jiraStatus: 'New' }),
        task({ taskNumber: 'A-2', jiraStatus: 'In Progress' }),
        task({ taskNumber: 'A-3', jiraStatus: 'To Accept' }),
      ],
      [],
    );
    const byCol = Object.fromEntries(g.columns.map((c) => [c.key, c.cards.map((x) => x.taskNumber)]));
    expect(byCol.todo).toEqual(['A-1']);
    expect(byCol.doing).toEqual(['A-2']);
    expect(byCol.to_accept).toEqual(['A-3']);
  });

  it('excludes tasks with no jiraStatus, hidden statuses, and the done column', () => {
    const g = buildBoard(
      [
        task({ taskNumber: 'A-1', jiraStatus: null }), // not on a board
        task({ taskNumber: 'A-2', jiraStatus: 'Waiting' }), // hidden
        task({ taskNumber: 'A-3', jiraStatus: 'Done' }), // hidden + done column
        task({ taskNumber: 'A-4', jiraStatus: 'In Progress' }), // shown
      ],
      [],
    );
    const all = g.columns.flatMap((c) => c.cards.map((x) => x.taskNumber));
    expect(all).toEqual(['A-4']);
  });

  it('sums loggedMinutes from worklogs by taskNumber and carries the estimate', () => {
    const g = buildBoard(
      [task({ taskNumber: 'A-1', jiraStatus: 'In Progress', estimatedMinutes: 120 })],
      [
        wl({ taskNumber: 'A-1', minutes: 30 }),
        wl({ taskNumber: 'A-1', minutes: 45 }),
        wl({ taskNumber: 'B-9', minutes: 99 }), // other task, ignored
      ],
    );
    const card = g.columns.find((c) => c.key === 'doing')!.cards[0]!;
    expect(card.loggedMinutes).toBe(75);
    expect(card.estimateMinutes).toBe(120);
  });

  it('filters by projectId when given', () => {
    const g = buildBoard(
      [
        task({ taskNumber: 'A-1', projectId: 1, jiraStatus: 'In Progress' }),
        task({ taskNumber: 'B-1', projectId: 2, jiraStatus: 'In Progress' }),
      ],
      [],
      { projectId: 2 },
    );
    const all = g.columns.flatMap((c) => c.cards.map((x) => x.taskNumber));
    expect(all).toEqual(['B-1']);
  });

  it('sorts cards within a column naturally by taskNumber', () => {
    const g = buildBoard(
      [
        task({ taskNumber: 'FIE-19100', jiraStatus: 'In Progress' }),
        task({ taskNumber: 'FIE-19000', jiraStatus: 'In Progress' }),
        task({ taskNumber: 'FIE-2000', jiraStatus: 'In Progress' }),
      ],
      [],
    );
    expect(g.columns.find((c) => c.key === 'doing')!.cards.map((x) => x.taskNumber)).toEqual([
      'FIE-2000',
      'FIE-19000',
      'FIE-19100',
    ]);
  });
});
