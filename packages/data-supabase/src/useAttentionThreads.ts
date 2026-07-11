import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabase } from './supabaseClient.js';
import { mapAttentionRow, groupThreads, ATTENTION_CACHE_KEY, type AttentionThread } from './attentionCache.js';

// ---------------------------------------------------------------------------
// Public hook return type
// ---------------------------------------------------------------------------

export type AttentionThreadsState = 'loading' | 'fresh' | 'cached' | 'offline';

export interface AttentionThreadsHookResult {
  threads: AttentionThread[];
  unansweredCount: number;
  /** Re-fetch in the background. Returns a promise that resolves when the
   *  fetch settles, so callers (pull-to-refresh, poll timer) can await it. */
  refresh(): Promise<void>;
  state: AttentionThreadsState;
}

// ---------------------------------------------------------------------------
// Cache store — mirrors billingCache.ts's BillingStore shape
// ---------------------------------------------------------------------------

export interface AttentionThreadsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

async function loadCache(store: AttentionThreadsStore): Promise<AttentionThread[] | null> {
  const raw = await store.get(ATTENTION_CACHE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as AttentionThread[];
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function saveCache(store: AttentionThreadsStore, threads: AttentionThread[]): Promise<void> {
  await store.set(ATTENTION_CACHE_KEY, JSON.stringify(threads));
}

// ---------------------------------------------------------------------------
// Supabase fetch logic
// ---------------------------------------------------------------------------

async function fetchAttentionThreads(): Promise<AttentionThread[]> {
  const supabase = getSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await supabase
    .from('attention_messages')
    .select('*')
    .order('created_at')) as { data: any[] | null; error: unknown };
  if (error) throw error;
  const rows = (data ?? []).map((r) => mapAttentionRow(r));
  return groupThreads(rows);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

// Default Capacitor Preferences-backed store used in production.
// Tests inject their own store via mocking '@capacitor/preferences'.
let _defaultStore: AttentionThreadsStore | null = null;

async function getDefaultStore(): Promise<AttentionThreadsStore> {
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

const POLL_INTERVAL_MS = 5000;

/**
 * useAttentionThreads — stale-while-revalidate escalation-thread hook.
 *
 * On mount:
 *  1. Load offline cache → if present, state = 'cached'.
 *  2. Fetch fresh from `attention_messages` → state = 'fresh', update cache.
 *  3. Fetch error + cache → state stays 'cached'.
 *  4. Fetch error + no cache → state = 'offline'.
 *
 * When `opts.pollWhileOpen` is true, `refresh()` is re-run every 5s while the
 * hook is mounted (cleared on unmount) — for a screen that's actively open
 * and wants near-live escalation updates without a push channel.
 */
export function useAttentionThreads(opts?: { pollWhileOpen?: boolean }): AttentionThreadsHookResult {
  const [threads, setThreads] = useState<AttentionThread[]>([]);
  const [state, setState] = useState<AttentionThreadsState>('loading');
  const hasDataRef = useRef(false);

  const runFetch = useCallback(async (store: AttentionThreadsStore) => {
    try {
      const fresh = await fetchAttentionThreads();
      await saveCache(store, fresh);
      hasDataRef.current = true;
      setThreads(fresh);
      setState('fresh');
    } catch {
      setState((prev) => (hasDataRef.current ? 'cached' : 'offline'));
    }
  }, []);

  const refresh = useCallback((): Promise<void> => {
    return (async () => {
      const store = await getDefaultStore();
      await runFetch(store);
    })();
  }, [runFetch]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const store = await getDefaultStore();
      if (cancelled) return;

      // Step 1: try cache.
      const cached = await loadCache(store);
      if (cancelled) return;

      if (cached) {
        hasDataRef.current = true;
        setThreads(cached);
        setState('cached');
      }

      // Step 2: fetch fresh regardless.
      await runFetch(store);
    })();

    return () => {
      cancelled = true;
    };
  }, [runFetch]);

  const pollWhileOpen = opts?.pollWhileOpen ?? false;

  useEffect(() => {
    if (!pollWhileOpen) return;
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollWhileOpen, refresh]);

  const unansweredCount = threads.filter((t) => t.unanswered).length;

  return { threads, unansweredCount, refresh, state };
}
