import { app, dialog, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMainWindow, getMainWindow } from './window.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { registerIpc, pushToRenderer } from './ipc.js';
import { startOrchestrator, getOrchestrator, onOrchestratorCrash } from './orchestratorHost.js';
import { applyUserShellPath } from './shellPath.js';
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

// GUI-launched macOS apps inherit a stripped PATH from launchd, missing
// every user-installed bin dir — including ~/.local/bin where `claude`
// lives. Repair PATH from the user's login+interactive shell before
// startOrchestrator() forks the utilityProcess so the orchestrator (and
// any exec'd `code <path>` for openInVSCode) sees the same lookup paths
// the user has in Terminal. No-op in dev — npm run dev already inherits
// the right PATH.
if (process.platform === 'darwin' && app.isPackaged) {
  applyUserShellPath();
}

// In dev (unpackaged) macOS shows Electron's default Dock icon. Packaged
// builds get the icon from electron-builder via Info.plist. Point the Dock
// at our .icns explicitly when unpackaged so dev matches the shipped look.
if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
  const icnsPath = path.resolve(__dirname, '../../build-resources/icon.icns');
  const img = nativeImage.createFromPath(icnsPath);
  if (!img.isEmpty()) app.dock.setIcon(img);
}

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

// macOS: dock-icon click (and "Show" from the dock menu) fires `activate`.
// Without this handler the window stays hidden after a Cmd+H / red-close,
// because window-all-closed is a no-op and nothing else re-shows it.
app.on('activate', () => {
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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
