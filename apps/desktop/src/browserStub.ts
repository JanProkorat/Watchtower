// Install a no-op `window.watchtower` bridge when the renderer is loaded
// in a plain browser (vite dev at localhost:5173) instead of inside Electron.
//
// The real bridge lives in electron/preload.ts and is wired via contextBridge
// when Electron loads the renderer. Without it, useInstances would throw
// during its first effect and React 18 would silently unmount the tree —
// producing the dreaded blank dark page.
//
// In browser mode the stub returns "empty" results (no instances, no pushes)
// so the Dashboard renders with a 0-instance message. Any invoke beyond
// listInstances logs a console.warn so devs notice they're running standalone.

import type { WatchtowerBridge, IpcRequest, IpcResponse, IpcPush } from '@watchtower/shared/ipcContract.js';
import { readWsConfig } from '@watchtower/transport';
import { createWebSocketTransport } from '@watchtower/transport';

declare global {
  interface Window {
    watchtower: WatchtowerBridge;
  }
}

function installStub(): void {
  if (typeof window === 'undefined' || window.watchtower) return;

  const wsCfg = readWsConfig(window.location, window.localStorage);
  if (wsCfg) {
    window.watchtower = createWebSocketTransport(wsCfg);
    return;
  }

  console.warn(
    '[watchtower] Running outside Electron — installing a no-op bridge. ' +
      'Spawn/kill/IPC calls will be ignored. Launch with `npm run dev` to get a real app window.',
  );

  // Cast through unknown: TypeScript cannot verify the discriminated-union generic
  // signatures structurally (TS2719), but the runtime behaviour is correct for
  // a no-op stub.
  const stub = {
    async invoke(kind: string, _payload: unknown): Promise<unknown> {
      switch (kind) {
        case 'ping':
          return { now: Date.now(), main: Date.now(), orch: Date.now() };
        case 'listInstances':
          return { instances: [] };
        case 'spawnInstance':
          // Returning an instanceId would make the renderer activate a tab
          // that has no matching <Tab /> child — MUI's Tabs validator
          // complains. The error path (null id + message) routes through
          // App.tsx's Snackbar instead.
          return {
            instanceId: null,
            error: 'Running in browser preview — launch the Watchtower app to spawn real claude instances.',
          };
        case 'chooseDirectory':
          // No native picker in plain browser. Returning null cancels the spawn flow.
          return { path: null };
        default:
          return { ok: true };
      }
    },
    on(_kind: string, _handler: unknown): () => void {
      return () => undefined;
    },
  } as unknown as WatchtowerBridge;

  Object.defineProperty(window, 'watchtower', { value: stub, configurable: true });
}

installStub();
