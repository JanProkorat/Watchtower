import { useEffect, useState } from 'react';
import type { FileTreeActivityState } from '@watchtower/shared/fileTree.js';
import { invoke } from './ipc';

/** The filetree mod's latest activity for one instance; null until the mod posts. */
export function useFileTreeActivity(instanceId: string): FileTreeActivityState | null {
  const [state, setState] = useState<FileTreeActivityState | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    invoke('fileTreeActivity:get', { instanceId })
      .then((s) => {
        if (alive) setState((prev) => prev ?? s);
      })
      .catch(() => {});
    const off = window.watchtower.on('fileTreeActivity', (payload) => {
      if (payload.instanceId === instanceId) setState(payload);
    });
    return () => {
      alive = false;
      off();
    };
  }, [instanceId]);
  return state;
}
