import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_HUB_CONFIG, type HubConfig } from '@watchtower/shared/hubConfig.js';
import { invoke } from './ipc';

export interface HubConfigState {
  config: HubConfig;
  loading: boolean;
  error: string | null;
  save(next: HubConfig): Promise<void>;
  refresh(): Promise<void>;
}

export function useHubConfig(): HubConfigState {
  const [config, setConfig] = useState<HubConfig>(DEFAULT_HUB_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke('hub:getConfig', {});
      setConfig(res.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (next: HubConfig) => {
      await invoke('hub:setConfig', { config: next });
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, loading, error, save, refresh };
}
