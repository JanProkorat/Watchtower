import { useEffect, useState } from 'react';

/** Settings key holding the inclusive worklog-lock date (ISO YYYY-MM-DD). */
export const WORKLOG_LOCK_SETTING_KEY = 'worklogs.locked_through';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the current lock date (ISO YYYY-MM-DD) or null when no lock is set.
 * Mirrors the orchestrator's `WorklogsRepo.lockedThrough()` so the UI can
 * pre-empt locked-error responses with disabled inputs and tooltips.
 *
 * The hook listens for `setSetting` round-trips and refreshes on the
 * `worklog-lock-changed` window event, dispatched after the Settings card
 * persists a new value.
 */
export function useWorklogLock(): string | null {
  const [lock, setLock] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      void window.watchtower
        .invoke('getSetting', { key: WORKLOG_LOCK_SETTING_KEY })
        .then((r) => {
          if (cancelled) return;
          const v = r.value?.trim();
          setLock(v && DATE_RE.test(v) ? v : null);
        });
    };

    load();
    const handler = () => load();
    window.addEventListener('worklog-lock-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('worklog-lock-changed', handler);
    };
  }, []);

  return lock;
}

/** True when `workDate` is on or before `lock`. Null lock = nothing is locked. */
export function isLocked(
  workDate: string | null | undefined,
  lock: string | null,
): boolean {
  if (!lock || !workDate) return false;
  return workDate <= lock;
}
