import { useCallback, useEffect, useState } from 'react';

export interface CloudSyncState {
  enabled: boolean;
  configured: boolean;
  loading: boolean;
  error: string | null;
  needsRestart: boolean;
  save(next: { enabled: boolean; url?: string | null }): Promise<void>;
  refresh(): Promise<void>;
}

export function useCloudSyncConfig(): CloudSyncState {
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('cloudSync:getConfig', {});
      setEnabled(res.enabled);
      setConfigured(res.configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (next: { enabled: boolean; url?: string | null }) => {
      setError(null);
      try {
        const res = await window.watchtower.invoke('cloudSync:setConfig', next);
        setNeedsRestart(res.needsRestart);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { enabled, configured, loading, error, needsRestart, save, refresh };
}
