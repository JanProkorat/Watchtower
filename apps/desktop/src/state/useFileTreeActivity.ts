import { useEffect, useMemo, useState } from 'react';
import { flashMap, type FileTreeActivityState } from '@watchtower/shared/fileTree.js';
import { invoke } from './ipc';

// A touch flashes only for this long after it arrives; older snapshots must not replay on remount.
const FLASH_MS = 4_000;

/** Flash map for the latest activity; empty once the snapshot is older than FLASH_MS. */
export function useFreshFlash(
  activity: FileTreeActivityState | null,
  cwd: string,
): ReadonlyMap<string, { kind: 'read' | 'write'; at: number }> {
  const receivedAt = activity?.receivedAt;
  const [, bump] = useState(0);
  useEffect(() => {
    if (receivedAt === undefined) return;
    const left = FLASH_MS - (Date.now() - receivedAt);
    if (left <= 0) return;
    const t = setTimeout(() => bump((n) => n + 1), left);
    return () => clearTimeout(t);
  }, [receivedAt]);
  const fresh = receivedAt !== undefined && Date.now() - receivedAt < FLASH_MS;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `fresh` is recomputed per render on purpose
  return useMemo(() => flashMap(fresh ? (activity?.snapshot ?? null) : null, cwd), [activity, cwd, fresh]);
}

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
