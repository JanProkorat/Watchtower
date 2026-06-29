import { describe, it, expect } from 'vitest';
import { buildDayOffUpsert, buildDayOffDelete, applyDayOffWrite, canEdit } from '../../apps/ipad/src/state/billingWrites.js';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import {
  computeDerivedForWrite, buildWorklogInsert, buildWorklogUpdate, buildWorklogDelete,
  buildOptimisticWorklogRow, buildEditedWorklogRow, applyWorklogWrite,
} from '../../apps/ipad/src/state/billingWrites.js';
import type { ContractRow, TaskRow, WorklogRow } from '@watchtower/shared/billing/types.js';

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
  projectId, effectiveFrom: '2026-01-01', endDate: null, rateType: 'hourly', rateAmount: 100, hoursPerDay: 8, mdLimit: null,
});
const task: TaskRow = { taskId: 7, taskNumber: 'X-9', taskTitle: 'T', projectId: 3, projectName: 'P', projectColor: '#abc', projectKind: 'work', isBillable: true };
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
