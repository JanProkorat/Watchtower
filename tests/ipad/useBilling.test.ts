import { describe, it, expect } from 'vitest';
import {
  billingReducer,
  type BillingReducerState,
  type BillingAction,
} from '../../apps/ipad/src/state/useBilling.js';
import type { BillingDataset } from '../../apps/ipad/src/state/billingCache.js';
import type { WorklogRow, TaskRow } from '@watchtower/shared/billing/types.js';

// ---------------------------------------------------------------------------
// Pure billingReducer — no DOM, no React, no mocks
// ---------------------------------------------------------------------------

const EMPTY_DATASET: BillingDataset = {
  worklogs: [],
  contracts: [],
  daysOff: [],
  projects: [],
  tasks: [],
  fetchedAt: '2026-06-26T10:00:00.000Z',
};

const FRESH_DATASET: BillingDataset = {
  ...EMPTY_DATASET,
  fetchedAt: '2026-06-26T11:00:00.000Z',
};

const INITIAL: BillingReducerState = {
  data: null,
  state: 'loading',
  lastUpdated: null,
};

function dispatch(state: BillingReducerState, action: BillingAction): BillingReducerState {
  return billingReducer(state, action);
}

describe('billingReducer', () => {
  // -------------------------------------------------------------------------
  // CACHE_HIT
  // -------------------------------------------------------------------------
  it('CACHE_HIT transitions loading → cached', () => {
    const next = dispatch(INITIAL, { type: 'CACHE_HIT', dataset: EMPTY_DATASET });
    expect(next.state).toBe('cached');
    expect(next.data).toEqual(EMPTY_DATASET);
    expect(next.lastUpdated).toBe(EMPTY_DATASET.fetchedAt);
  });

  // -------------------------------------------------------------------------
  // CACHE_MISS
  // -------------------------------------------------------------------------
  it('CACHE_MISS leaves state unchanged (still loading, null data)', () => {
    const next = dispatch(INITIAL, { type: 'CACHE_MISS' });
    expect(next.state).toBe('loading');
    expect(next.data).toBeNull();
  });

  // -------------------------------------------------------------------------
  // FETCH_SUCCESS
  // -------------------------------------------------------------------------
  it('FETCH_SUCCESS transitions to fresh with new dataset', () => {
    const next = dispatch(INITIAL, { type: 'FETCH_SUCCESS', dataset: FRESH_DATASET });
    expect(next.state).toBe('fresh');
    expect(next.data).toEqual(FRESH_DATASET);
    expect(next.lastUpdated).toBe(FRESH_DATASET.fetchedAt);
  });

  it('FETCH_SUCCESS after CACHE_HIT → transitions cached → fresh (replaces data)', () => {
    const afterCache = dispatch(INITIAL, { type: 'CACHE_HIT', dataset: EMPTY_DATASET });
    const afterFetch = dispatch(afterCache, { type: 'FETCH_SUCCESS', dataset: FRESH_DATASET });
    expect(afterFetch.state).toBe('fresh');
    expect(afterFetch.lastUpdated).toBe(FRESH_DATASET.fetchedAt);
  });

  // -------------------------------------------------------------------------
  // FETCH_ERROR — with existing cache
  // -------------------------------------------------------------------------
  it('FETCH_ERROR with cached data → stays cached', () => {
    const afterCache = dispatch(INITIAL, { type: 'CACHE_HIT', dataset: EMPTY_DATASET });
    const afterError = dispatch(afterCache, { type: 'FETCH_ERROR' });
    expect(afterError.state).toBe('cached');
    expect(afterError.data).toEqual(EMPTY_DATASET);
    expect(afterError.lastUpdated).toBe(EMPTY_DATASET.fetchedAt);
  });

  // -------------------------------------------------------------------------
  // FETCH_ERROR — no cache
  // -------------------------------------------------------------------------
  it('FETCH_ERROR with no cache (after CACHE_MISS) → offline', () => {
    const afterMiss = dispatch(INITIAL, { type: 'CACHE_MISS' });
    const afterError = dispatch(afterMiss, { type: 'FETCH_ERROR' });
    expect(afterError.state).toBe('offline');
    expect(afterError.data).toBeNull();
    expect(afterError.lastUpdated).toBeNull();
  });

  it('FETCH_ERROR from initial loading state (no cache loaded yet) → offline', () => {
    const afterError = dispatch(INITIAL, { type: 'FETCH_ERROR' });
    expect(afterError.state).toBe('offline');
    expect(afterError.data).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Full happy-path sequence: CACHE_HIT → FETCH_SUCCESS
  // -------------------------------------------------------------------------
  it('full happy-path: loading → cached → fresh', () => {
    let s = INITIAL;
    s = dispatch(s, { type: 'CACHE_HIT', dataset: EMPTY_DATASET });
    expect(s.state).toBe('cached');
    s = dispatch(s, { type: 'FETCH_SUCCESS', dataset: FRESH_DATASET });
    expect(s.state).toBe('fresh');
    expect(s.data).toEqual(FRESH_DATASET);
  });

  // -------------------------------------------------------------------------
  // Full error-with-cache sequence: CACHE_HIT → FETCH_ERROR → stays cached
  // -------------------------------------------------------------------------
  it('error-with-cache: loading → cached → (network error) → still cached', () => {
    let s = INITIAL;
    s = dispatch(s, { type: 'CACHE_HIT', dataset: EMPTY_DATASET });
    s = dispatch(s, { type: 'FETCH_ERROR' });
    expect(s.state).toBe('cached');
    expect(s.data).toEqual(EMPTY_DATASET);
  });

  // -------------------------------------------------------------------------
  // Full error-no-cache sequence: CACHE_MISS → FETCH_ERROR → offline
  // -------------------------------------------------------------------------
  it('error-no-cache: loading → (no cache) → (network error) → offline', () => {
    let s = INITIAL;
    s = dispatch(s, { type: 'CACHE_MISS' });
    s = dispatch(s, { type: 'FETCH_ERROR' });
    expect(s.state).toBe('offline');
  });
});

describe('billingReducer — PATCH_WORKLOGS', () => {
  const wl = (syncId: string): WorklogRow => ({
    syncId, workDate: '2026-06-01', minutes: 60, reportedMinutes: null, effectiveMinutes: 60,
    earnedAmount: null, description: null, projectId: 1, projectName: 'P', projectColor: null,
    projectKind: 'work', isBillable: true, taskNumber: null, taskTitle: null, source: 'manual',
  });
  it('swaps worklogs in the existing dataset', () => {
    const start = { data: { worklogs: [wl('a')], contracts: [], daysOff: [], projects: [], tasks: [], fetchedAt: 'x' }, state: 'fresh' as const, lastUpdated: 'x' };
    const next = billingReducer(start, { type: 'PATCH_WORKLOGS', worklogs: [wl('a'), wl('b')] });
    expect(next.data?.worklogs.map((w) => w.syncId)).toEqual(['a', 'b']);
  });
  it('is a no-op when there is no data', () => {
    const start = { data: null, state: 'offline' as const, lastUpdated: null };
    expect(billingReducer(start, { type: 'PATCH_WORKLOGS', worklogs: [wl('a')] })).toBe(start);
  });
});

describe('billingReducer — PATCH_TASKS', () => {
  const tk = (syncId: string): TaskRow => ({
    taskId: 1, syncId, epicId: 1, taskNumber: 'T-1', taskTitle: 'T', status: 'open',
    estimatedMinutes: null, description: null, projectId: 1, projectName: 'P',
    projectColor: null, projectKind: 'work', isBillable: true,
  });
  it('swaps tasks in the existing dataset', () => {
    const start = { data: { worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [tk('a')], epics: [], fetchedAt: 'x' }, state: 'fresh' as const, lastUpdated: 'x' };
    const next = billingReducer(start, { type: 'PATCH_TASKS', tasks: [tk('a'), tk('b')] });
    expect(next.data?.tasks.map((t) => t.syncId)).toEqual(['a', 'b']);
  });
  it('is a no-op when there is no data', () => {
    const start = { data: null, state: 'offline' as const, lastUpdated: null };
    expect(billingReducer(start, { type: 'PATCH_TASKS', tasks: [tk('a')] })).toBe(start);
  });
});
