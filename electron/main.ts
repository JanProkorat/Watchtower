import { app } from 'electron';
import { createMainWindow } from './window.js';
import { registerIpc, pushToRenderer } from './ipc.js';
import { startOrchestrator } from './orchestratorHost.js';

app.setName('Watchtower');

app.whenReady().then(() => {
  startOrchestrator();
  registerIpc();
  const win = createMainWindow();
  win.webContents.once('did-finish-load', () => {
    pushToRenderer('hello', { version: app.getVersion() });
  });
});

app.on('window-all-closed', () => {
  // intentionally no-op — orchestrator + tray will keep the app alive
});
