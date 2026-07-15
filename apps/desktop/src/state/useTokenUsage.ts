import { useCallback, useEffect, useState } from 'react';
import type { TokenUsagePayload } from '@watchtower/shared/tokenUsageFormat.js';
import { invoke } from './ipc';

export interface TokenUsageState {
  data: TokenUsagePayload | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/**
 * Fetches the active 5h-block token usage once on mount and then stays live via
 * the orchestrator's `tokenUsage` push (emitted every 5 minutes). The countdown
 * itself is recomputed in the card from `block.endTime`, so this hook only needs
 * to re-render when fresh ccusage data arrives.
 */
export function useTokenUsage(): TokenUsageState {
  const [data, setData] = useState<TokenUsagePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke('tokens:usage', {});
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.watchtower.on('tokenUsage', (payload) => {
      setData(payload);
      setLoading(false);
      setError(null);
    });
    return off;
  }, [refresh]);

  return { data, loading, error, refresh };
}
