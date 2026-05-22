import { ipcMain, dialog } from 'electron';
import type { IpcRequest, IpcResponse } from '../shared/ipcContract.js';
import { getMainWindow, createMainWindow } from './window.js';
import { getOrchestrator } from './orchestratorHost.js';
import { fireMacNotification, fireTestNotification } from './notifications.js';

const ELECTRON_ONLY_KINDS = new Set<IpcRequest['kind']>([
  'chooseDirectory',
  'sendTestNotification',
]);

export function registerIpc(): void {
  // Push events from the orchestrator are forwarded to the renderer verbatim;
  // a few also trigger native side-effects (macOS notifications) in main.
  getOrchestrator().onPush((msg) => {
    if (msg.kind === 'notify') {
      const p = msg.payload as { instanceId: string; cwd: string; kind: 'waiting-permission' | 'idle-notify' };
      fireMacNotification({
        instanceId: p.instanceId,
        cwd: p.cwd,
        kind: p.kind,
        onClick: (instanceId) => {
          // Tell the renderer to activate this tab.
          pushToRenderer('activateInstance', { instanceId });
        },
      });
    }
    pushToRenderer(msg.kind, msg.payload);
  });

  ipcMain.handle(
    'watchtower:invoke',
    async (_event, kind: IpcRequest['kind'], payload: unknown) => {
      const orch = getOrchestrator();

      if (kind === 'ping') {
        const { now } = payload as { now: number };
        const res = await orch.invoke('ping', { now });
        const response: Extract<IpcResponse, { kind: 'ping' }>['payload'] = {
          now,
          main: Date.now(),
          orch: res.orch,
        };
        return response;
      }

      if (kind === 'chooseDirectory') {
        const { defaultPath } = payload as { defaultPath?: string };
        const win = getMainWindow() ?? createMainWindow();
        const res = await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory'],
          defaultPath,
        });
        return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
      }

      if (kind === 'sendTestNotification') {
        fireTestNotification();
        return { ok: true };
      }

      if (ELECTRON_ONLY_KINDS.has(kind)) {
        throw new Error(`unhandled electron-only kind: ${kind}`);
      }

      // All remaining kinds proxy through to the orchestrator unchanged.
      return orch.invoke(kind as 'spawnInstance', payload as never);
    },
  );
}

export function pushToRenderer(kind: string, payload: unknown): void {
  getMainWindow()?.webContents.send('watchtower:push', kind, payload);
}
