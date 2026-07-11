import { useCallback, useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';

export interface InstanceView {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
  kind: string;
  taskId: number | null;
}

export function useInstances(): { instances: InstanceView[] } {
  const { bridge, status } = useConnection();
  const [instances, setInstances] = useState<InstanceView[]>([]);

  const refetch = useCallback(() => {
    void bridge
      .invoke('listInstances', {})
      .then((r) => setInstances((r as { instances: InstanceView[] }).instances))
      .catch(() => { /* not connected yet; a later (re)connect refetch covers it */ });
  }, [bridge]);

  // Live updates while connected.
  useEffect(() => {
    return bridge.on('stateChanged', () => refetch());
  }, [bridge, refetch]);

  // Refetch on every (re)connect. The `stateChanged` push isn't emitted when a
  // client merely reconnects, and the bridge object is stable across
  // reconnects, so without this the list stays stale (often empty, if the app
  // launched before the Mac was up) until the component remounts.
  useEffect(() => {
    if (status === 'connected') refetch();
  }, [status, refetch]);

  return { instances };
}
