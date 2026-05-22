import { app, dialog } from 'electron';
import path from 'node:path';
import { createMainWindow, getMainWindow } from './window.js';
import { registerIpc, pushToRenderer } from './ipc.js';
import { startOrchestrator, getOrchestrator, onOrchestratorCrash } from './orchestratorHost.js';
import {
  focusInstanceTab,
  refreshTrayFromOrchestrator,
  setTrayBadge,
  startTray,
} from './tray.js';

const LIVE_STATUSES = new Set([
  'spawning',
  'working',
  'waiting-permission',
  'waiting-input',
  'idle-notify',
  'resuming',
]);
let quitting = false;

app.setName('Watchtower');

app.whenReady().then(() => {
  const orch = startOrchestrator();
  registerIpc();
  onOrchestratorCrash((info) => {
    pushToRenderer('orchestratorCrashed', info);
  });
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

// Cmd+Q / "Quit" menu items / app.quit() all funnel through before-quit. If
// any claude tab is currently running we want to confirm before tearing it
// down. The respawn-on-launch path will bring everything back next time
// regardless, so this is mostly a "you sure?" guard against accidental quit
// rather than a hard data-loss prevention. Suspended rows are detected by
// status alone (LIVE_STATUSES set above).
app.on('before-quit', async (event) => {
  if (quitting) return;
  const orch = getOrchestrator();
  let live: Array<{ id: string; cwd: string; status: string }> = [];
  try {
    const res = await orch.invoke('listInstances', {});
    live = res.instances.filter((i) => LIVE_STATUSES.has(i.status));
  } catch {
    // Orchestrator unreachable — let the quit proceed; nothing useful to
    // preserve when we can't see DB state anyway.
    quitting = true;
    return;
  }

  if (live.length === 0) {
    quitting = true;
    return;
  }

  event.preventDefault();
  const win = getMainWindow();
  const lines = live
    .map((i) => `  • ${path.basename(i.cwd) || i.cwd} (${i.status})`)
    .join('\n');
  const result = await dialog.showMessageBox(win ?? undefined!, {
    type: 'question',
    buttons: ['Suspend & quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Quit Watchtower',
    message: `${live.length} Claude Code session${live.length === 1 ? ' is' : 's are'} still running.`,
    detail: `${lines}\n\nThey will be respawned on next launch.`,
  });
  if (result.response === 0) {
    quitting = true;
    app.quit();
  }
});
