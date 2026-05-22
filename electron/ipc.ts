import { ipcMain } from 'electron';
import type { IpcRequest, IpcResponse } from '../shared/ipcContract.js';
import { getMainWindow } from './window.js';
import { getOrchestrator } from './orchestratorHost.js';

export function registerIpc(): void {
  ipcMain.handle('watchtower:invoke', async (_event, kind: IpcRequest['kind'], payload: unknown) => {
    switch (kind) {
      case 'ping': {
        const { now } = payload as { now: number };
        const orchRes = await getOrchestrator().invoke('ping', { now });
        const response: Extract<IpcResponse, { kind: 'ping' }>['payload'] = {
          now,
          main: Date.now(),
          orch: orchRes.orch,
        };
        return response;
      }
      default: {
        const exhaustive: never = kind;
        throw new Error(`Unknown IPC kind: ${exhaustive as string}`);
      }
    }
  });
}

export function pushToRenderer(kind: string, payload: unknown): void {
  getMainWindow()?.webContents.send('watchtower:push', kind, payload);
}
