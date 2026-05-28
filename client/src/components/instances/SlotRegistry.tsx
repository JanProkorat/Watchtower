import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

interface RegistryAPI {
  registerSlot(instanceId: string, el: HTMLElement | null): () => void;
  subscribe(cb: () => void): () => void;
  getSlot(instanceId: string): HTMLElement | null;
}

const SlotRegistryContext = createContext<RegistryAPI | null>(null);

export function SlotRegistryProvider({ children }: { children: ReactNode }) {
  const slots = useRef(new Map<string, HTMLElement | null>());
  const subscribers = useRef(new Set<() => void>());

  const notify = () => {
    for (const cb of subscribers.current) cb();
  };

  const registerSlot = useCallback((instanceId: string, el: HTMLElement | null) => {
    slots.current.set(instanceId, el);
    notify();
    return () => {
      if (slots.current.get(instanceId) === el) {
        slots.current.delete(instanceId);
        notify();
      }
    };
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    subscribers.current.add(cb);
    return () => {
      subscribers.current.delete(cb);
    };
  }, []);

  const getSlot = useCallback(
    (instanceId: string) => slots.current.get(instanceId) ?? null,
    [],
  );

  const api = useMemo<RegistryAPI>(
    () => ({ registerSlot, subscribe, getSlot }),
    [registerSlot, subscribe, getSlot],
  );
  return <SlotRegistryContext.Provider value={api}>{children}</SlotRegistryContext.Provider>;
}

export function useSlotForInstance(instanceId: string): HTMLElement | null {
  const api = useContext(SlotRegistryContext);
  if (!api) throw new Error('useSlotForInstance must be inside SlotRegistryProvider');
  return useSyncExternalStore(
    api.subscribe,
    () => api.getSlot(instanceId),
    () => null,
  );
}

export function useSlotRegistration() {
  const api = useContext(SlotRegistryContext);
  if (!api) throw new Error('useSlotRegistration must be inside SlotRegistryProvider');
  return api.registerSlot;
}
