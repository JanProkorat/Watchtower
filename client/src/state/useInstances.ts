import { useCallback, useEffect, useState } from 'react';

export interface InstanceView {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
}

export function useInstances(): {
  instances: InstanceView[];
  activeId: string | null;
  setActive(id: string | null): void;
  spawn(cwd: string, args?: string[]): Promise<string>;
  kill(instanceId: string): Promise<void>;
  refresh(): Promise<void>;
} {
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await window.watchtower.invoke('listInstances', {});
    setInstances(res.instances);
  }, []);

  useEffect(() => {
    void refresh();
    const offState = window.watchtower.on('stateChanged', () => {
      void refresh();
    });
    const offExit = window.watchtower.on('ptyExit', () => {
      void refresh();
    });
    return () => {
      offState();
      offExit();
    };
  }, [refresh]);

  const spawn = useCallback(
    async (cwd: string, args?: string[]) => {
      const res = await window.watchtower.invoke('spawnInstance', { cwd, args });
      if (res.instanceId) {
        // Refresh the instance list BEFORE activating the new tab — otherwise
        // MUI's Tabs validator runs against stale children and warns:
        // "value provided to Tabs is invalid, none of children match <uuid>".
        await refresh();
        setActiveId(res.instanceId);
      }
      return res;
    },
    [refresh],
  );

  const kill = useCallback(
    async (instanceId: string) => {
      await window.watchtower.invoke('killInstance', { instanceId });
      await refresh();
    },
    [refresh],
  );

  return { instances, activeId, setActive: setActiveId, spawn, kill, refresh };
}
