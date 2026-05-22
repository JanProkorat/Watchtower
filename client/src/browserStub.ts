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

import type { WatchtowerBridge, IpcRequest, IpcResponse, IpcPush } from '../../shared/ipcContract.js';

declare global {
  interface Window {
    watchtower: WatchtowerBridge;
  }
}

function installStub(): void {
  if (typeof window === 'undefined' || window.watchtower) return;

  console.warn(
    '[watchtower] Running outside Electron — installing a no-op bridge. ' +
      'Spawn/kill/IPC calls will be ignored. Launch with `npm run dev` to get a real app window.',
  );

  const stub: WatchtowerBridge = {
    async invoke<T extends IpcRequest['kind']>(
      kind: T,
      _payload: Extract<IpcRequest, { kind: T }>['payload'],
    ): Promise<Extract<IpcResponse, { kind: T }>['payload']> {
      type Out = Extract<IpcResponse, { kind: T }>['payload'];
      switch (kind) {
        case 'ping':
          return { now: Date.now(), main: Date.now(), orch: Date.now() } as Out;
        case 'listInstances':
          return { instances: [] } as Out;
        case 'spawnInstance':
          return { instanceId: 'stub-not-spawned' } as Out;
        default:
          return { ok: true } as Out;
      }
    },
    on<T extends IpcPush['kind']>(
      _kind: T,
      _handler: (payload: Extract<IpcPush, { kind: T }>['payload']) => void,
    ): () => void {
      return () => undefined;
    },
  };

  Object.defineProperty(window, 'watchtower', { value: stub, configurable: true });
}

installStub();
