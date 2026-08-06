import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RateLimitsPayload } from '@watchtower/shared/rateLimitsFormat.js';
import { nextRateLimitResetMs, rollForwardRateLimits } from '@watchtower/shared/rateLimitsFormat.js';
import { invoke } from './ipc';

export interface RateLimitsState {
  data: RateLimitsPayload;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Latest statusline-captured rate-limit snapshot; live via `rateLimitsUsage`.
 *
 * `data` is aged to the current time — a window whose `resetsAt` has passed
 * reads as fresh (0%) rather than keeping its pre-reset percentage. That matters
 * because snapshots only arrive when some Claude session renders a statusline:
 * while the user is idle across a rollover, no push ever comes, so the hook
 * re-evaluates itself on a timer armed for the next reset instant.
 */
export function useRateLimits(): RateLimitsState {
  const [raw, setRaw] = useState<RateLimitsPayload>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => rollForwardRateLimits(raw, now), [raw, now]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRaw(await invoke('rateLimits:usage', {}));
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.watchtower.on('rateLimitsUsage', (payload) => {
      setRaw(payload);
      setNow(Date.now());
      setLoading(false);
      setError(null);
    });
    return off;
  }, [refresh]);

  useEffect(() => {
    const at = nextRateLimitResetMs(data, Date.now());
    if (at == null) return;
    // +1s so the wake-up is unambiguously past the boundary: landing exactly on
    // it could leave `rollForwardRateLimits` returning the same object, which
    // would not re-run this effect and so would never re-arm the timer.
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, at - Date.now()) + 1_000);
    return () => clearTimeout(id);
  }, [data]);

  return { data, loading, error, refresh };
}
