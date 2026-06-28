import { describe, it, expect } from 'vitest';
import { buildDayOffUpsert, buildDayOffDelete, applyDayOffWrite, canEdit } from '../../apps/ipad/src/state/billingWrites.js';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';

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
