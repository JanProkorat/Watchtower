import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BoardAuthPingPayload,
  BoardSnapshotPayload,
  BoardSyncResultPayload,
} from '../../../shared/ipcContract.js';

/** Auto-sync threshold: refetch on mount if local snapshot is older than this. */
const STALE_MS = 5 * 60 * 1000;

export interface BoardState {
  /** True only during the initial board:get + board:authPing. */
  loading: boolean;
  /** True while a board:sync is in flight (either auto or manual). */
  syncing: boolean;
  snapshot: BoardSnapshotPayload | null;
  auth: BoardAuthPingPayload | null;
  syncError: string | null;
  lastSyncResult: BoardSyncResultPayload | null;
}

export interface UseBoard extends BoardState {
  sync(): Promise<void>;
}

function isStale(snapshot: BoardSnapshotPayload | null, now: number): boolean {
  if (!snapshot?.syncedAt) return true;
  return now - Date.parse(snapshot.syncedAt) > STALE_MS;
}

/**
 * Owns the Kanban tab's state. On activation it loads from the local DB
 * (cheap), pings auth, and — if signed in and the snapshot is stale —
 * auto-syncs once. Manual sync via the returned `sync()` always fires
 * regardless of staleness.
 */
export function useBoard(active: boolean): UseBoard {
  const [state, setState] = useState<BoardState>({
    loading: true,
    syncing: false,
    snapshot: null,
    auth: null,
    syncError: null,
    lastSyncResult: null,
  });
  const autoSyncedOnceRef = useRef(false);

  const sync = useCallback(async () => {
    setState((s) => ({ ...s, syncing: true, syncError: null }));
    try {
      const { snapshot, result } = await window.watchtower.invoke('board:sync', {});
      const auth = await window.watchtower.invoke('board:authPing', {});
      setState((s) => ({
        ...s,
        snapshot,
        auth,
        syncing: false,
        lastSyncResult: result,
        syncError: result.error ?? null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        syncing: false,
        syncError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const [snapshot, auth] = await Promise.all([
        window.watchtower.invoke('board:get', {}),
        window.watchtower.invoke('board:authPing', {}),
      ]);
      if (cancelled) return;
      setState((s) => ({ ...s, snapshot, auth, loading: false }));
      if (
        !autoSyncedOnceRef.current &&
        auth.cookiePresent &&
        isStale(snapshot, Date.now())
      ) {
        autoSyncedOnceRef.current = true;
        await sync();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, sync]);

  return { ...state, sync };
}
