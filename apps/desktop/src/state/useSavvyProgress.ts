import { useEffect, useState } from 'react';
import type { SavvyProgressState } from '@watchtower/shared/savvyProgress.js';
import { invoke } from './ipc';

/**
 * The savvy-progress mod's latest snapshot for one instance; live via the
 * `savvyProgress` push. Null until the mod (plugins/savvy-progress) has posted
 * from that instance's Claude session — i.e. the mod isn't installed there.
 */
export function useSavvyProgress(instanceId: string): SavvyProgressState | null {
  const [state, setState] = useState<SavvyProgressState | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    // Silent: a miss only means no panel; there's nothing for the user to act on.
    invoke('savvyProgress:get', { instanceId }, { silent: true })
      .then((s) => {
        // A push may have landed while the fetch was in flight — it's newer.
        if (alive) setState((prev) => prev ?? s);
      })
      .catch(() => {});
    const off = window.watchtower.on('savvyProgress', (payload) => {
      if (payload.instanceId === instanceId) setState(payload);
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);

  return state;
}
