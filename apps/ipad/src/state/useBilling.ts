import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
import type { ContractRow, DayOffRow, ProjectRow, TaskRow, WorklogRow, EpicRow } from '@watchtower/shared/billing/types.js';
import {
  mapWorklogRow,
  mapDayOffRow,
  mapTaskRow,
  mapEpicRow,
  loadCache,
  saveCache,
  type BillingDataset,
  type BillingStore,
  type RawWorklogRow,
  type RawDayOffRow,
  type RawTaskRow,
  type RawEpicRow,
} from './billingCache.js';
import { fetchAllPaged, type PageResult } from './paginate.js';

// ---------------------------------------------------------------------------
// Public hook return type
// ---------------------------------------------------------------------------

export type BillingState = 'loading' | 'fresh' | 'cached' | 'offline';

export interface BillingHookResult {
  data: BillingDataset | null;
  state: BillingState;
  lastUpdated: string | null;
  refresh(): void;
  patchDaysOff(next: DayOffRow[]): void;
  patchWorklogs(next: WorklogRow[]): void;
  patchTasks(next: TaskRow[]): void;
}

// ---------------------------------------------------------------------------
// Pure state-reducer helpers (extracted for unit-testability)
// ---------------------------------------------------------------------------

export interface BillingReducerState {
  data: BillingDataset | null;
  state: BillingState;
  lastUpdated: string | null;
}

export type BillingAction =
  | { type: 'CACHE_HIT'; dataset: BillingDataset }
  | { type: 'CACHE_MISS' }
  | { type: 'FETCH_SUCCESS'; dataset: BillingDataset }
  | { type: 'FETCH_ERROR' }
  | { type: 'PATCH_DAYS_OFF'; daysOff: DayOffRow[] }
  | { type: 'PATCH_WORKLOGS'; worklogs: WorklogRow[] }
  | { type: 'PATCH_TASKS'; tasks: TaskRow[] };

export function billingReducer(
  prev: BillingReducerState,
  action: BillingAction,
): BillingReducerState {
  switch (action.type) {
    case 'CACHE_HIT':
      return {
        data: action.dataset,
        state: 'cached',
        lastUpdated: action.dataset.fetchedAt,
      };
    case 'CACHE_MISS':
      // Keep loading; we'll resolve once the fetch completes (or fails).
      return prev;
    case 'FETCH_SUCCESS':
      return {
        data: action.dataset,
        state: 'fresh',
        lastUpdated: action.dataset.fetchedAt,
      };
    case 'FETCH_ERROR':
      // If we already have cached data, stay 'cached'. Otherwise go 'offline'.
      if (prev.data != null) {
        return { ...prev, state: 'cached' };
      }
      return { data: null, state: 'offline', lastUpdated: null };
    case 'PATCH_DAYS_OFF':
      return prev.data ? { ...prev, data: { ...prev.data, daysOff: action.daysOff } } : prev;
    case 'PATCH_WORKLOGS':
      return prev.data ? { ...prev, data: { ...prev.data, worklogs: action.worklogs } } : prev;
    case 'PATCH_TASKS':
      return prev.data ? { ...prev, data: { ...prev.data, tasks: action.tasks } } : prev;
    default:
      return prev;
  }
}

// ---------------------------------------------------------------------------
// Supabase fetch logic
// ---------------------------------------------------------------------------

async function fetchBillingDataset(): Promise<BillingDataset> {
  const supabase = getSupabase();
  // Worklog history exceeds PostgREST's 1000-row "Max rows" cap, so page through
  // it; an unpaginated fetch silently returns only the first 1000 rows. A stable
  // unique-key order keeps .range() pages from skipping or duplicating rows.
  const worklogsPromise = fetchAllPaged<RawWorklogRow>(
    (from, to) =>
      supabase
        .from('worklogs')
        .select(
          'sync_id,work_date,minutes,effective_minutes,earned_amount,reported_minutes,description,source,' +
            'tasks(number,title,epics(projects(id,name,color,kind,is_billable)))',
        )
        .is('deleted_at', null)
        .order('sync_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<RawWorklogRow>>,
  );

  const tasksPromise = fetchAllPaged<RawTaskRow>(
    (from, to) =>
      supabase
        .from('tasks')
        .select('id,sync_id,epic_id,number,title,status,estimated_minutes,description,epics(projects(id,name,color,kind,is_billable))')
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<RawTaskRow>>,
  );

  const epicsPromise = fetchAllPaged<RawEpicRow>(
    (from, to) =>
      supabase
        .from('epics')
        .select('id,name,project_id,status')
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<RawEpicRow>>,
  );

  const [worklogsRaw, contractsResult, daysOffResult, projectsResult, tasksRaw, epicsRaw] = await Promise.all([
    worklogsPromise,
    /* contracts */ supabase.from('contracts').select('project_id,effective_from,end_date,rate_type,rate_amount,hours_per_day,md_limit').is('deleted_at', null),
    supabase.from('days_off').select('date,kind,sync_id').is('deleted_at', null),
    supabase.from('projects').select('id,name,color,kind,is_billable').is('deleted_at', null),
    tasksPromise,
    epicsPromise,
  ]);

  if (contractsResult.error) throw contractsResult.error;
  if (daysOffResult.error) throw daysOffResult.error;
  if (projectsResult.error) throw projectsResult.error;

  const worklogs = worklogsRaw.map((r) => mapWorklogRow(r));

  const contracts: ContractRow[] = (contractsResult.data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any): ContractRow => ({
      projectId: r.project_id,
      effectiveFrom: r.effective_from,
      endDate: r.end_date ?? null,
      rateType: r.rate_type,
      rateAmount: r.rate_amount,
      hoursPerDay: r.hours_per_day,
      mdLimit: r.md_limit ?? null,
    }),
  );

  const daysOff: DayOffRow[] = (daysOffResult.data ?? []).map((r) => mapDayOffRow(r as RawDayOffRow));

  const projects: ProjectRow[] = (projectsResult.data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any): ProjectRow => ({ id: r.id, name: r.name, color: r.color ?? null, kind: r.kind, isBillable: r.is_billable }),
  );

  const tasks: TaskRow[] = tasksRaw.map((r) => mapTaskRow(r));

  const epics: EpicRow[] = epicsRaw.map((r) => mapEpicRow(r));

  return {
    worklogs,
    contracts,
    daysOff,
    projects,
    tasks,
    epics,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

// Default Capacitor Preferences-backed store used in production.
// Tests inject their own store via the optional parameter.
let _defaultStore: BillingStore | null = null;

async function getDefaultStore(): Promise<BillingStore> {
  if (_defaultStore) return _defaultStore;
  // Dynamic import so Capacitor isn't required in the test environment.
  const { Preferences } = await import('@capacitor/preferences');
  _defaultStore = {
    get: async (key) => {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    },
    set: async (key, value) => {
      await Preferences.set({ key, value });
    },
  };
  return _defaultStore;
}

const INITIAL_STATE: BillingReducerState = {
  data: null,
  state: 'loading',
  lastUpdated: null,
};

/**
 * useBilling — stale-while-revalidate billing dataset hook.
 *
 * On mount:
 *  1. Load cache → if present, state = 'cached'.
 *  2. Fetch fresh → state = 'fresh', update cache.
 *  3. Fetch error + cache → state stays 'cached'.
 *  4. Fetch error + no cache → state = 'offline'.
 *
 * The optional `storeOverride` parameter is for tests only.
 */
export function useBilling(storeOverride?: BillingStore): BillingHookResult {
  const [bState, setBState] = useState<BillingReducerState>(INITIAL_STATE);

  const dispatch = useCallback((action: BillingAction) => {
    setBState((prev) => billingReducer(prev, action));
  }, []);

  const runFetch = useCallback(
    async (store: BillingStore) => {
      try {
        const dataset = await fetchBillingDataset();
        await saveCache(store, dataset);
        dispatch({ type: 'FETCH_SUCCESS', dataset });
      } catch {
        dispatch({ type: 'FETCH_ERROR' });
      }
    },
    [dispatch],
  );

  const refresh = useCallback(() => {
    void (async () => {
      const store = storeOverride ?? (await getDefaultStore());
      await runFetch(store);
    })();
  }, [storeOverride, runFetch]);

  const patchDaysOff = useCallback((next: DayOffRow[]) => dispatch({ type: 'PATCH_DAYS_OFF', daysOff: next }), [dispatch]);
  const patchWorklogs = useCallback((next: WorklogRow[]) => dispatch({ type: 'PATCH_WORKLOGS', worklogs: next }), [dispatch]);
  const patchTasks = useCallback((next: TaskRow[]) => dispatch({ type: 'PATCH_TASKS', tasks: next }), [dispatch]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const store = storeOverride ?? (await getDefaultStore());
      if (cancelled) return;

      // Step 1: try cache.
      const cached = await loadCache(store);
      if (cancelled) return;

      if (cached) {
        dispatch({ type: 'CACHE_HIT', dataset: cached });
      } else {
        dispatch({ type: 'CACHE_MISS' });
      }

      // Step 2: fetch fresh regardless.
      await runFetch(store);
    })();

    return () => {
      cancelled = true;
    };
  }, [storeOverride, dispatch, runFetch]);

  return {
    data: bState.data,
    state: bState.state,
    lastUpdated: bState.lastUpdated,
    refresh,
    patchDaysOff,
    patchWorklogs,
    patchTasks,
  };
}
