import { app } from 'electron';
import { createMainWindow } from './window.js';
import { registerIpc, pushToRenderer } from './ipc.js';
import { startOrchestrator, getOrchestrator } from './orchestratorHost.js';
import {
  focusInstanceTab,
  refreshTrayFromOrchestrator,
  setTrayBadge,
  startTray,
} from './tray.js';

app.setName('Watchtower');

app.whenReady().then(() => {
  const orch = startOrchestrator();
  registerIpc();
  const win = createMainWindow();
  win.webContents.once('did-finish-load', () => {
    pushToRenderer('hello', { version: app.getVersion() });
  });

  startTray({
    onSelectInstance: (id) => focusInstanceTab(id),
    onSnoozeAll: (ms) =>
      void orch.invoke('snooze', { instanceId: '*', untilMs: Date.now() + ms }),
    onNewInstance: () => {
      const w = createMainWindow();
      w.show();
      w.focus();
      pushToRenderer('triggerNewInstance', {});
    },
  });

  // The orchestrator already broadcasts state-changed / ptyExit / badge —
  // intercept them here to keep the tray in sync without the renderer
  // needing to be the source of truth.
  orch.onPush((msg) => {
    if (msg.kind === 'badge') {
      setTrayBadge((msg.payload as { count: number }).count);
    }
    if (msg.kind === 'stateChanged' || msg.kind === 'ptyExit') {
      void refreshTrayFromOrchestrator((kind, payload) =>
        orch.invoke(kind as 'listInstances', payload as never),
      );
    }
  });
  // Initial population.
  void refreshTrayFromOrchestrator((kind, payload) =>
    orch.invoke(kind as 'listInstances', payload as never),
  );
});

app.on('window-all-closed', () => {
  // intentionally no-op — orchestrator + tray keep the app alive
});
