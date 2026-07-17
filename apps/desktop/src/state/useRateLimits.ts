import { useCallback, useEffect, useState } from 'react';
import type { RateLimitsPayload } from '@watchtower/shared/rateLimitsFormat.js';
import { invoke } from './ipc';

export interface RateLimitsState {
  data: RateLimitsPayload;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/** Latest statusline-captured rate-limit snapshot; live via `rateLimitsUsage`. */
export function useRateLimits(): RateLimitsState {
  const [data, setData] = useState<RateLimitsPayload>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await invoke('rateLimits:usage', {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.watchtower.on('rateLimitsUsage', (payload) => {
      setData(payload);
      setLoading(false);
      setError(null);
    });
    return off;
  }, [refresh]);

  return { data, loading, error, refresh };
}
