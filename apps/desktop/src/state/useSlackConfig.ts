import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SLACK_CONFIG, type SlackConfig } from '@watchtower/shared/slackConfig.js';

export interface SlackConfigState {
  config: SlackConfig;
  connected: boolean;
  loading: boolean;
  error: string | null;
  save(next: SlackConfig): Promise<void>;
  sendTest(): Promise<{ ok: boolean; error?: string }>;
  refresh(): Promise<void>;
}

export function useSlackConfig(): SlackConfigState {
  const [config, setConfig] = useState<SlackConfig>(DEFAULT_SLACK_CONFIG);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('slack:getConfig', {});
      setConfig(res.config);
      setConnected(res.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (next: SlackConfig) => {
      await window.watchtower.invoke('slack:setConfig', { config: next });
      await refresh();
    },
    [refresh],
  );

  const sendTest = useCallback(() => window.watchtower.invoke('slack:test', {}), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, connected, loading, error, save, sendTest, refresh };
}
