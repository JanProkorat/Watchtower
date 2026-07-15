import { ipcMain, dialog, shell, nativeTheme } from 'electron';
import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { type IpcRequest, type IpcResponse, type IpcPush, ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';
import { getMainWindow, createMainWindow } from './window.js';
import { getOrchestrator } from './orchestratorHost.js';
import { fireMacNotification, fireTestNotification } from './notifications.js';
import { runBoardSignIn } from './boardSignIn.js';
import { setPat, hasPat, getPats } from './devopsPat.js';
import { getCloudSyncConfig, setCloudSyncConfig } from './cloudSync.js';

type DeepLinkPayload = Extract<IpcPush, { kind: 'deep-link' }>['payload'];

// A macOS notification click can recreate a previously-closed main window
// (the app stays alive in the tray). The deep-link would then be sent before
// the renderer has mounted and subscribed, and get dropped. So buffer the
// latest deep-link and only deliver it to a renderer that has signalled ready
// via `deepLink:ready`. Readiness is keyed on webContents id, so a recreated
// window is "not ready" until its fresh renderer signals again.
let pendingDeepLink: DeepLinkPayload | null = null;
let readyWebContentsId: number | null = null;

function flushDeepLink(): void {
  const win = getMainWindow();
  if (pendingDeepLink && win && !win.isDestroyed() && win.webContents.id === readyWebContentsId) {
    win.webContents.send('deep-link', pendingDeepLink);
    pendingDeepLink = null;
  }
}

function queueDeepLink(payload: DeepLinkPayload): void {
  pendingDeepLink = payload;
  flushDeepLink(); // delivers immediately if the current window already signalled ready
}

export function registerIpc(): void {
  // Seed the orchestrator's in-memory DevOps PAT map so the autonomous
  // PrWatcher poll can watch Azure DevOps PRs from boot onward — the
  // orchestrator can't safeStorage.decryptString itself (main-process only),
  // so main pushes the already-decrypted map once here; the devops:setPat
  // handler below re-sends it on every change.
  void getPats()
    .then((pats) => getOrchestrator().invoke('prWatch:setPats', { pats }))
    .catch((err) => console.error('[ipc] initial prWatch:setPats failed:', err));

  // Push events from the orchestrator are forwarded to the renderer verbatim;
  // a few also trigger native side-effects (macOS notifications) in main.
  getOrchestrator().onPush((msg) => {
    if (msg.kind === 'notify') {
      const p = msg.payload;
      if (p.target === 'pr') {
        fireMacNotification({
          target: 'pr',
          host: p.host,
          repoKey: p.repoKey,
          prNumber: p.prNumber,
          title: p.title,
          repoLabel: p.repoLabel,
          event: p.event,
          body: p.body,
          onClick: () => {
            // fireMacNotification already restores/focuses the main window (or
            // recreates it) before invoking onClick. Buffer + deliver on ready
            // so a freshly-recreated window doesn't miss the deep link. Use the
            // typed notify payload `p` (PrHost) rather than the stringly-typed
            // onClick callback arg.
            queueDeepLink({ module: 'reviews', host: p.host, repoKey: p.repoKey, prNumber: p.prNumber });
          },
        });
      } else {
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

      if (kind === 'openInVSCode') {
        const { path: rawPath } = payload as { path: string };
        const expanded = rawPath.startsWith('~/')
          ? path.join(homedir(), rawPath.slice(2))
          : rawPath === '~'
            ? homedir()
            : rawPath;
        // Try `code <path>` first (the canonical VS Code CLI); fall back to
        // `shell.openPath` which opens the folder in Finder so the user at
        // least gets *something* if `code` isn't on PATH.
        return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          exec(`code ${JSON.stringify(expanded)}`, async (err) => {
            if (!err) return resolve({ ok: true });
            const fallback = await shell.openPath(expanded);
            if (fallback === '') return resolve({ ok: true });
            resolve({ ok: false, error: `code: ${err.message}; openPath: ${fallback}` });
          });
        });
      }

      if (kind === 'board:signIn') {
        return await runBoardSignIn();
      }

      if (kind === 'appearance:set') {
        const { mode } = payload as { mode: 'dark' | 'light' };
        nativeTheme.themeSource = mode;
        return { ok: true };
      }

      if (kind === 'openExternalUrl') {
        const { url } = payload as { url: string };
        // https-only guard: refuse anything else so a malicious payload
        // can't launch local apps via custom URL schemes (file://, mailto:,
        // tel:, vscode://, etc.).
        if (!/^https:\/\//.test(url)) {
          return { ok: false, error: 'openExternalUrl: only https:// URLs are allowed' };
        }
        await shell.openExternal(url);
        return { ok: true };
      }

      if (kind === 'devops:setPat') {
        const { host, pat } = payload as { host: string; pat: string };
        await setPat(host, pat);
        // Keep the orchestrator's in-memory PAT bridge (used by the autonomous
        // PrWatcher poll, which can't safeStorage.decryptString itself) current.
        void orch.invoke('prWatch:setPats', { pats: await getPats() }).catch((err) => {
          console.error('[ipc] prWatch:setPats re-send failed:', err);
        });
        return { ok: true };
      }

      if (kind === 'devops:hasPat') {
        return { hasPat: await hasPat((payload as { host: string }).host) };
      }

      if (kind === 'cloudSync:getConfig') {
        return getCloudSyncConfig();
      }

      if (kind === 'cloudSync:setConfig') {
        setCloudSyncConfig(payload as { enabled: boolean });
        return { ok: true, needsRestart: true };
      }

      if (kind === 'prs:refresh' || kind === 'prs:diff' || kind === 'prs:comments' || kind === 'prReview:postComments'
        || kind === 'prs:merge' || kind === 'prs:reviewState' || kind === 'prs:approve' || kind === 'prs:close') {
        return orch.invoke(kind as 'prs:refresh', {
          ...(payload as object),
          devopsPats: await getPats(),
        } as never);
      }

      if (kind === 'deepLink:ready') {
        readyWebContentsId = getMainWindow()?.webContents.id ?? null;
        flushDeepLink();
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
