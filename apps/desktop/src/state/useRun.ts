import { useEffect, useState } from 'react';
import type { RunState } from '@watchtower/shared/runServers.js';
import { invoke } from './ipc';

export interface RunControls {
  /** null while the pane's repo has no `.watchtower/run.json`. */
  state: RunState | null;
  start(serverId?: string): Promise<void>;
  stop(serverId?: string): Promise<void>;
  /** Re-reads run.json, e.g. after the user edited it. */
  reload(): Promise<void>;
}

/** The dev servers of the repo this instance's cwd belongs to. */
export function useRun(instanceId: string, cwd: string): RunControls {
  const [state, setState] = useState<RunState | null>(null);

  const reload = async () => {
    const s = await invoke('run:state', { instanceId }).catch(() => null);
    setState(s);
  };

  useEffect(() => {
    let alive = true;
    setState(null);
    invoke('run:state', { instanceId })
      .then((s) => {
        if (alive) setState(s);
      })
      .catch(() => {});
    // Pushes are per repo; adopt only the one this pane already resolved to.
    const off = window.watchtower.on('runChanged', (payload) => {
      setState((prev) => (prev && prev.root === payload.root ? payload : prev));
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId, cwd]);

  const act = (kind: 'run:start' | 'run:stop') => async (serverId?: string) => {
    const s = await invoke(kind, { instanceId, serverId }).catch(() => null);
    if (s) setState(s);
  };

  return { state, start: act('run:start'), stop: act('run:stop'), reload };
}
