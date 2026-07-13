import { contextBridge, ipcRenderer } from 'electron';

const listeners = new Map<string, Set<(payload: unknown) => void>>();

ipcRenderer.on('watchtower:push', (_event, kind: string, payload: unknown) => {
  listeners.get(kind)?.forEach((h) => h(payload));
});

// electron/ipc.ts sends the notification-click deep link on its own raw
// 'deep-link' channel (not multiplexed through 'watchtower:push'), so bridge
// it separately into the same `listeners` map that `on()` reads from.
ipcRenderer.on('deep-link', (_event, payload: unknown) => {
  listeners.get('deep-link')?.forEach((h) => h(payload));
});

contextBridge.exposeInMainWorld('watchtower', {
  invoke(kind: string, payload: unknown) {
    return ipcRenderer.invoke('watchtower:invoke', kind, payload);
  },
  on(kind: string, handler: (payload: unknown) => void) {
    let set = listeners.get(kind);
    if (!set) {
      set = new Set();
      listeners.set(kind, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  },
});
