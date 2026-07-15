import { useCallback, useEffect, useState } from 'react';
import type { AgentRowPayload } from '@watchtower/shared/ipcContract.js';
import { invoke } from './ipc';

interface State {
  loading: boolean;
  agents: AgentRowPayload[];
  error: string | null;
}

export function useAgents(): State & { refresh(): Promise<void> } {
  const [state, setState] = useState<State>({ loading: true, agents: [], error: null });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await invoke('agents:list', {});
      setState({ loading: false, agents: res.agents, error: null });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
