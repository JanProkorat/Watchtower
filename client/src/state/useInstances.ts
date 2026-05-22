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

  const remove = useCallback(
    async (instanceId: string) => {
      await window.watchtower.invoke('removeInstance', { instanceId });
      setActiveId((curr) => (curr === instanceId ? null : curr));
      await refresh();
    },
    [refresh],
  );

  const reorder = useCallback(async (orderedIds: string[]) => {
    // Optimistic local update so the drop lands instantly. The server is the
    // source of truth and will confirm on the next refresh; if it disagrees,
    // a subsequent listInstances rolls us back.
    setInstances((curr) => {
      const byId = new Map(curr.map((i) => [i.id, i] as const));
      const reordered: InstanceView[] = [];
      for (const id of orderedIds) {
        const inst = byId.get(id);
        if (inst) reordered.push(inst);
      }
      // Any instances not present in the ordered list keep their relative
      // order at the end — shouldn't happen in practice but is a safe fallback.
      for (const inst of curr) {
        if (!orderedIds.includes(inst.id)) reordered.push(inst);
      }
      return reordered;
    });
    await window.watchtower.invoke('reorderInstances', { orderedIds });
  }, []);

  return { instances, activeId, setActive: setActiveId, spawn, kill, remove, reorder, refresh };
}
