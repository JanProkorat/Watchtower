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
  /**
   * Open Jira in the system browser, poll Brave/Chrome for the resulting
   * cookies, store them in Watchtower's Keychain, and sync on success.
   */
  signInAndSync(): Promise<void>;
  /**
   * Drop a single card from the board (clears its jira_* mirror columns).
   * The task itself stays in TimeTracker; the next sync will bring it back
   * if it still matches the board.
   */
  remove(taskId: number): Promise<void>;
}

/** Exported for unit tests — pure, no DOM access. */
export function isStale(snapshot: BoardSnapshotPayload | null, now: number): boolean {
  if (!snapshot?.syncedAt) return true;
  return now - Date.parse(snapshot.syncedAt) > STALE_MS;
}

/** Stale threshold, exported for tests that need to pin the boundary. */
export const STALE_THRESHOLD_MS = STALE_MS;

/**
 * Owns the Kanban tab's state for a single project. On activation it loads
 * from the local DB (cheap), pings auth, and — if signed in and the snapshot
 * is stale — auto-syncs once. Manual sync via `sync()` always fires.
 *
 * Pass `projectId = null` (no project selected, or none have a board URL)
 * and the hook stays idle: no DB read, no sync, just an empty state.
 */
export function useBoard(active: boolean, projectId: number | null): UseBoard {
  const [state, setState] = useState<BoardState>({
    loading: true,
    syncing: false,
    snapshot: null,
    auth: null,
    syncError: null,
    lastSyncResult: null,
  });
  // Auto-sync gate is per-project — switching projects should allow a fresh
  // auto-sync against the new board.
  const autoSyncedForRef = useRef<number | null>(null);

  const sync = useCallback(async () => {
    if (projectId === null) return;
    setState((s) => ({ ...s, syncing: true, syncError: null }));
    try {
      const { snapshot, result } = await window.watchtower.invoke('board:sync', { projectId });
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
  }, [projectId]);

  const signInAndSync = useCallback(async () => {
    setState((s) => ({ ...s, syncing: true, syncError: null }));
    try {
      const r = await window.watchtower.invoke('board:signIn', {});
      if (!r.ok) {
        setState((s) => ({ ...s, syncing: false, syncError: r.error ?? 'Sign-in failed' }));
        return;
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        syncing: false,
        syncError: err instanceof Error ? err.message : String(err),
      }));
      return;
    }
    // Cookie landed in Keychain — sync immediately. sync() flips `syncing` back.
    await sync();
  }, [sync]);

  useEffect(() => {
    if (!active) return;
    if (projectId === null) {
      setState((s) => ({ ...s, loading: false, snapshot: null, syncError: null, lastSyncResult: null }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const [snapshot, auth] = await Promise.all([
        window.watchtower.invoke('board:get', { projectId }),
        window.watchtower.invoke('board:authPing', {}),
      ]);
      if (cancelled) return;
      setState((s) => ({ ...s, snapshot, auth, loading: false }));
      // Auto-sync only when:
      //   * we haven't already auto-synced this project in this session
      //   * the user has a cookie stored
      //   * the board has been populated before (i.e. not first-ever load — we
      //     don't want to silently fire an HTTP call against a possibly-stale
      //     cookie without the user knowing)
      //   * the snapshot is stale
      const hasData = (snapshot.cards.length ?? 0) > 0;
      if (
        autoSyncedForRef.current !== projectId &&
        auth.cookiePresent &&
        hasData &&
        isStale(snapshot, Date.now())
      ) {
        autoSyncedForRef.current = projectId;
        await sync();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, projectId, sync]);

  const remove = useCallback(
    async (taskId: number) => {
      if (projectId === null) return;
      // Optimistic: drop the card locally first so the UI feels instant.
      setState((s) => {
        if (!s.snapshot) return s;
        const filtered = s.snapshot.cards.filter((c) => c.taskId !== taskId);
        if (filtered.length === s.snapshot.cards.length) return s;
        return { ...s, snapshot: { ...s.snapshot, cards: filtered } };
      });
      try {
        const { snapshot } = await window.watchtower.invoke('board:remove', {
          taskId,
          projectId,
        });
        setState((s) => ({ ...s, snapshot }));
      } catch (err) {
        setState((s) => ({
          ...s,
          syncError: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [projectId],
  );

  return { ...state, sync, signInAndSync, remove };
}
