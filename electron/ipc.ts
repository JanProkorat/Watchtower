import { ipcMain, dialog } from 'electron';
import type { IpcRequest, IpcResponse } from '../shared/ipcContract.js';
import { getMainWindow } from './window.js';
import { getOrchestrator } from './orchestratorHost.js';

const ELECTRON_ONLY_KINDS = new Set<IpcRequest['kind']>(['chooseDirectory']);

export function registerIpc(): void {
  // Push events from the orchestrator are forwarded to the renderer verbatim.
  getOrchestrator().onPush((msg) => {
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
        const win = getMainWindow() ?? undefined;
        const res = await dialog.showOpenDialog(win as Electron.BrowserWindow, {
          properties: ['openDirectory', 'createDirectory'],
          defaultPath,
        });
        return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
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
