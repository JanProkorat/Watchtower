import { describe, it, expect } from 'vitest';
import { buildDayOffUpsert, buildDayOffDelete, applyDayOffWrite, canEdit } from '@watchtower/data-supabase';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import {
  computeDerivedForWrite, buildWorklogInsert, buildWorklogUpdate, buildWorklogDelete,
  buildOptimisticWorklogRow, buildEditedWorklogRow, applyWorklogWrite,
} from '@watchtower/data-supabase';
import type { ContractRow, TaskRow, WorklogRow } from '@watchtower/shared/billing/types.js';
import {
  buildTaskInsert, buildTaskUpdate, buildTaskDelete,
  buildOptimisticTaskRow, buildEditedTaskRow, applyTaskWrite, canEditTask,
} from '@watchtower/data-supabase';
import type { ProjectRow, TaskRow as TaskRowT } from '@watchtower/shared/billing/types.js';

describe('buildDayOffUpsert', () => {
  it('shapes a full upsert row with tombstone cleared + stamped updated_at', () => {
    expect(buildDayOffUpsert('2026-07-06', 'sick', { syncId: 's1', now: '2026-06-28T10:00:00.000Z' })).toEqual({
      sync_id: 's1', date: '2026-07-06', kind: 'sick', note: null, deleted_at: null, updated_at: '2026-06-28T10:00:00.000Z',
    });
  });
});

describe('buildDayOffDelete', () => {
  it('soft-deletes by stamping deleted_at + updated_at', () => {
    expect(buildDayOffDelete('2026-06-28T10:00:00.000Z')).toEqual({
      deleted_at: '2026-06-28T10:00:00.000Z', updated_at: '2026-06-28T10:00:00.000Z',
    });
  });
});

describe('applyDayOffWrite', () => {
  const base: DayOffRow[] = [{ date: '2026-07-06', kind: 'vacation', syncId: 's1' }];
  it('replaces the kind of an existing date on set', () => {
    expect(applyDayOffWrite(base, { type: 'set', row: { date: '2026-07-06', kind: 'sick', syncId: 's1' } }))
      .toEqual([{ date: '2026-07-06', kind: 'sick', syncId: 's1' }]);
  });
  it('adds a new date on set, sorted is not required', () => {
    const out = applyDayOffWrite(base, { type: 'set', row: { date: '2026-07-08', kind: 'other', syncId: 's2' } });
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.date === '2026-07-08')?.kind).toBe('other');
  });
  it('removes the date on clear', () => {
    expect(applyDayOffWrite(base, { type: 'clear', date: '2026-07-06' })).toEqual([]);
  });
});

describe('canEdit', () => {
  it('only fresh state is editable', () => {
    expect(canEdit('fresh')).toBe(true);
    expect(canEdit('cached')).toBe(false);
    expect(canEdit('offline')).toBe(false);
    expect(canEdit('loading')).toBe(false);
  });
});

const contract = (projectId: number): ContractRow => ({
  syncId: 'c-test', projectId, effectiveFrom: '2026-01-01', endDate: null, rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
});
const task: TaskRow = { taskId: 7, syncId: 'task-sync', epicId: 1, taskNumber: 'X-9', taskTitle: 'T', status: 'open', estimatedMinutes: null, description: null, projectId: 3, projectName: 'P', projectColor: '#abc', projectKind: 'work', isBillable: true };
const input = { taskId: 7, workDate: '2026-06-01', minutes: 120, reportedMinutes: 90, description: 'note' };

describe('computeDerivedForWrite', () => {
  it('filters contracts to the project and derives via the shared formula', () => {
    const b = computeDerivedForWrite([contract(3), contract(999)], 3, input);
    expect(b.effectiveMinutes).toBe(90);
    expect(b.resolvedRate).toBe(100);
    expect(b.earnedAmount).toBeCloseTo(150);
  });
  it('null rate/earned when no contract for the project', () => {
    const b = computeDerivedForWrite([contract(999)], 3, input);
    expect(b.resolvedRate).toBeNull();
    expect(b.earnedAmount).toBeNull();
  });
});

describe('buildWorklogInsert', () => {
  it('shapes a full insert row: manual source, null external_id, derived merged', () => {
    const b = computeDerivedForWrite([contract(3)], 3, input);
    expect(buildWorklogInsert(input, { syncId: 'w1', now: '2026-06-28T10:00:00.000Z', billing: b })).toEqual({
      sync_id: 'w1', task_id: 7, work_date: '2026-06-01', minutes: 120, reported_minutes: 90,
      description: 'note', source: 'manual', external_id: null, jira_uploaded: false, deleted_at: null,
      updated_at: '2026-06-28T10:00:00.000Z', effective_minutes: 90, resolved_rate: 100, earned_amount: 150,
    });
  });
});

describe('buildWorklogUpdate', () => {
  it('shapes an update row WITHOUT task_id', () => {
    const b = computeDerivedForWrite([contract(3)], 3, input);
    const row = buildWorklogUpdate({ workDate: '2026-06-02', minutes: 60, reportedMinutes: null, description: null }, { now: '2026-06-28T10:00:00.000Z', billing: b });
    expect(row).not.toHaveProperty('task_id');
    expect(row.work_date).toBe('2026-06-02');
    expect(row.updated_at).toBe('2026-06-28T10:00:00.000Z');
    expect(row.effective_minutes).toBe(90);
  });
});

describe('buildWorklogDelete', () => {
  it('soft-deletes via deleted_at + updated_at', () => {
    expect(buildWorklogDelete('2026-06-28T10:00:00.000Z')).toEqual({ deleted_at: '2026-06-28T10:00:00.000Z', updated_at: '2026-06-28T10:00:00.000Z' });
  });
});

describe('buildOptimisticWorklogRow', () => {
  it('builds a denormalized WorklogRow from the picked task', () => {
    const b = computeDerivedForWrite([contract(3)], 3, input);
    const row = buildOptimisticWorklogRow(task, input, b, 'w1');
    expect(row).toEqual({
      syncId: 'w1', workDate: '2026-06-01', minutes: 120, reportedMinutes: 90, effectiveMinutes: 90,
      earnedAmount: 150, description: 'note', projectId: 3, projectName: 'P', projectColor: '#abc',
      projectKind: 'work', isBillable: true, taskNumber: 'X-9', taskTitle: 'T', source: 'manual',
    });
  });
});

describe('applyWorklogWrite', () => {
  const base: WorklogRow = buildOptimisticWorklogRow(task, input, computeDerivedForWrite([contract(3)], 3, input), 'w1');
  it('upsert replaces by syncId', () => {
    const edited = { ...base, minutes: 30 };
    expect(applyWorklogWrite([base], { type: 'upsert', row: edited })).toEqual([edited]);
  });
  it('upsert adds a new syncId', () => {
    const other = { ...base, syncId: 'w2' };
    expect(applyWorklogWrite([base], { type: 'upsert', row: other }).map((w) => w.syncId).sort()).toEqual(['w1', 'w2']);
  });
  it('remove filters by syncId', () => {
    expect(applyWorklogWrite([base], { type: 'remove', syncId: 'w1' })).toEqual([]);
  });
});

const project: ProjectRow = { id: 3, name: 'Proj', color: '#abc', kind: 'work', isBillable: true };
const taskInput = { epicId: 5, number: 'X-9', title: 'Nine', status: 'open', estimatedMinutes: 120, description: 'note' };

describe('buildTaskInsert', () => {
  it('shapes a full insert row (sync_id, epic_id, status, tombstone clear, stamped updated_at; no jira_* / created_at)', () => {
    expect(buildTaskInsert(taskInput, { syncId: 't1', now: '2026-06-29T10:00:00.000Z' })).toEqual({
      sync_id: 't1', epic_id: 5, number: 'X-9', title: 'Nine', status: 'open',
      estimated_minutes: 120, description: 'note', deleted_at: null, updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildTaskUpdate', () => {
  it('shapes an update row WITHOUT sync_id; includes epic_id (reparent) + stamped updated_at', () => {
    const row = buildTaskUpdate(taskInput, { now: '2026-06-29T10:00:00.000Z' });
    expect(row).not.toHaveProperty('sync_id');
    expect(row).toEqual({
      epic_id: 5, number: 'X-9', title: 'Nine', status: 'open',
      estimated_minutes: 120, description: 'note', updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildTaskDelete', () => {
  it('soft-deletes via deleted_at + updated_at', () => {
    expect(buildTaskDelete('2026-06-29T10:00:00.000Z')).toEqual({ deleted_at: '2026-06-29T10:00:00.000Z', updated_at: '2026-06-29T10:00:00.000Z' });
  });
});

describe('buildOptimisticTaskRow', () => {
  it('builds a denormalized TaskRow from input + picked project', () => {
    expect(buildOptimisticTaskRow(taskInput, { syncId: 't1', taskId: 0, project })).toEqual({
      taskId: 0, syncId: 't1', epicId: 5, taskNumber: 'X-9', taskTitle: 'Nine', status: 'open',
      estimatedMinutes: 120, description: 'note', projectId: 3, projectName: 'Proj',
      projectColor: '#abc', projectKind: 'work', isBillable: true, jiraStatus: null,
    });
  });
});

describe('buildEditedTaskRow', () => {
  it('preserves taskId/syncId, updates mutable fields + project refs', () => {
    const existing: TaskRowT = buildOptimisticTaskRow(taskInput, { syncId: 't1', taskId: 42, project });
    const edited = buildEditedTaskRow(existing, { ...taskInput, title: 'Renamed', status: 'in_progress' }, project);
    expect(edited.taskId).toBe(42);
    expect(edited.syncId).toBe('t1');
    expect(edited.taskTitle).toBe('Renamed');
    expect(edited.status).toBe('in_progress');
  });
});

describe('applyTaskWrite', () => {
  const base: TaskRowT = buildOptimisticTaskRow(taskInput, { syncId: 't1', taskId: 42, project });
  it('upsert replaces by syncId', () => {
    const edited = { ...base, taskTitle: 'X' };
    expect(applyTaskWrite([base], { type: 'upsert', row: edited })).toEqual([edited]);
  });
  it('upsert adds a new syncId', () => {
    const other = { ...base, syncId: 't2' };
    expect(applyTaskWrite([base], { type: 'upsert', row: other }).map((t) => t.syncId).sort()).toEqual(['t1', 't2']);
  });
  it('remove filters by syncId', () => {
    expect(applyTaskWrite([base], { type: 'remove', syncId: 't1' })).toEqual([]);
  });
});

describe('canEditTask', () => {
  it('locks done tasks', () => {
    expect(canEditTask('done')).toBe(false);
    expect(canEditTask('open')).toBe(true);
    expect(canEditTask('in_progress')).toBe(true);
  });
});

import {
  buildContractInsert, buildContractUpdate, buildContractEndDateUpdate, buildContractDelete,
  buildOptimisticContractRow, applyContractWrite, rebillProjectWorklogs,
} from '@watchtower/data-supabase';
import type { ContractRow as ContractRowT, WorklogRow as WorklogRowT } from '@watchtower/shared/billing/types.js';

const cInput = { projectId: 3, effectiveFrom: '2026-01-01', endDate: null, rateType: 'hourly' as const, rateAmount: 100, hoursPerDay: 8, mdLimit: null };

describe('buildContractInsert', () => {
  it('shapes a full insert row (sync_id, project_id, tombstone clear, stamped updated_at)', () => {
    expect(buildContractInsert(cInput, { syncId: 'c1', now: '2026-06-29T10:00:00.000Z' })).toEqual({
      sync_id: 'c1', project_id: 3, effective_from: '2026-01-01', rate_type: 'hourly',
      rate_amount: 100, hours_per_day: 8, end_date: null, md_limit: null,
      deleted_at: null, updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildContractUpdate', () => {
  it('shapes an update row WITHOUT sync_id/project_id', () => {
    const row = buildContractUpdate({ ...cInput, rateAmount: 150 }, { now: '2026-06-29T10:00:00.000Z' });
    expect(row).not.toHaveProperty('sync_id');
    expect(row).not.toHaveProperty('project_id');
    expect(row).toEqual({
      effective_from: '2026-01-01', rate_type: 'hourly', rate_amount: 150, hours_per_day: 8,
      end_date: null, md_limit: null, updated_at: '2026-06-29T10:00:00.000Z',
    });
  });
});

describe('buildContractEndDateUpdate', () => {
  it('shapes the auto-close write', () => {
    expect(buildContractEndDateUpdate('2025-12-31', '2026-06-29T10:00:00.000Z')).toEqual({ end_date: '2025-12-31', updated_at: '2026-06-29T10:00:00.000Z' });
  });
});

describe('buildContractDelete', () => {
  it('soft-deletes', () => {
    expect(buildContractDelete('2026-06-29T10:00:00.000Z')).toEqual({ deleted_at: '2026-06-29T10:00:00.000Z', updated_at: '2026-06-29T10:00:00.000Z' });
  });
});

describe('buildOptimisticContractRow', () => {
  it('builds a ContractRow from input + syncId', () => {
    expect(buildOptimisticContractRow(cInput, 'c1')).toEqual({
      syncId: 'c1', projectId: 3, effectiveFrom: '2026-01-01', endDate: null,
      rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
    });
  });
});

describe('applyContractWrite', () => {
  const base: ContractRowT = buildOptimisticContractRow(cInput, 'c1');
  it('upsert replaces by syncId', () => {
    const edited = { ...base, rateAmount: 150 };
    expect(applyContractWrite([base], { type: 'upsert', row: edited })).toEqual([edited]);
  });
  it('remove filters by syncId', () => {
    expect(applyContractWrite([base], { type: 'remove', syncId: 'c1' })).toEqual([]);
  });
});

describe('rebillProjectWorklogs', () => {
  const wl = (syncId: string, projectId: number): WorklogRowT => ({
    syncId, workDate: '2026-06-01', minutes: 60, reportedMinutes: null, effectiveMinutes: 60,
    earnedAmount: 0, description: null, projectId, projectName: 'P', projectColor: null,
    projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null, source: 'manual',
  });
  const contract: ContractRowT = buildOptimisticContractRow(cInput, 'c1'); // hourly 100 from 2026-01-01
  it('recomputes earnedAmount only for the project worklogs', () => {
    const result = rebillProjectWorklogs([wl('a', 3), wl('b', 9)], 3, [contract]);
    const a = result.find((w) => w.syncId === 'a')!;
    const b = result.find((w) => w.syncId === 'b')!;
    expect(a.earnedAmount).toBeCloseTo(100); // 60min * 100/60
    expect(b.earnedAmount).toBe(0);          // untouched (different project)
  });
  it('null earnedAmount when no contract covers the project', () => {
    const result = rebillProjectWorklogs([wl('a', 3)], 3, []);
    expect(result[0].earnedAmount).toBeNull();
  });
});
