import { useCallback, useState } from 'react';
import type { RunningInstancePayload } from '../../../shared/ipcContract.js';

export interface LaunchState {
  /** When set, render the choice modal — there's at least one running instance. */
  pending: {
    projectName: string;
    cwd: string;
    runningInstances: RunningInstancePayload[];
  } | null;
  /**
   * Kick off the launch for the given project + cwd. Fetches matching
   * instances first; if none → calls `onSpawnNew` directly; if any → opens
   * the choice modal.
   */
  launch(projectName: string, cwd: string): Promise<void>;
  dismiss(): void;
}

interface Opts {
  onActivateInstance(id: string): void;
  onSpawnNew(cwd: string): void;
}

export function useInstanceLauncher({ onActivateInstance, onSpawnNew }: Opts): LaunchState {
  const [pending, setPending] = useState<LaunchState['pending']>(null);

  const launch = useCallback(
    async (projectName: string, cwd: string) => {
      try {
        const res = await window.watchtower.invoke('instances:findByCwd', { cwd });
        if (res.instances.length === 0) {
          onSpawnNew(cwd);
          return;
        }
        setPending({ projectName, cwd, runningInstances: res.instances });
      } catch {
        // If the lookup fails, fall back to spawning — better to spawn a
        // duplicate than to silently swallow the click.
        onSpawnNew(cwd);
      }
    },
    [onSpawnNew],
  );

  const dismiss = useCallback(() => setPending(null), []);

  return { pending, launch, dismiss };
}
