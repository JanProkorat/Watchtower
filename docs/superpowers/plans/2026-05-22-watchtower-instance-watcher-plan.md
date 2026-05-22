# Watchtower — Instance Watcher MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS Electron app — Watchtower — that runs Claude Code instances in embedded terminals, watches their state via Claude Code hooks, and notifies the user when one needs attention. Sessions survive app restarts via `claude --resume <session-id>`.

**Architecture:** Three processes inside one Electron app. **Electron main** owns windowing, tray, and macOS notifications. A **Node `utilityProcess` child (orchestrator)** owns the pty sessions, a localhost HTTP listener for hook callbacks, SQLite state, and the state machine. **Renderer** is React + MUI + xterm.js. A bundled **`watchtower-hook` helper** script is installed into `~/.claude/settings.json` and POSTs hook payloads to the orchestrator. Main ↔ orchestrator communicate over `MessagePort` (in-process). Renderer ↔ main communicate over `contextBridge` IPC.

**Tech stack:** Electron 33, Node 22, TypeScript 5, React 18, MUI v5, `xterm.js` 5, `node-pty` 1.x, `better-sqlite3` 11, `zod` 3, `fastify` 4 (for the hook listener), `vitest` 2, `electron-builder` 25, `vite` 5.

**Key design facts (carried from the spec):**
- Use `claude --session-id <uuid>` at spawn so our UUID *is* the Claude session ID. Pairing hook events to instance rows is trivial: match by `session_id`. (Replaces the spec's `WATCHTOWER_INSTANCE_ID` env-var pairing — same intent, cleaner mechanism.)
- Hook helper is a single JS file invoked as `node <abs-path>/watchtower-hook.js <event>`. It reads payload from stdin, token from `~/Library/Application Support/Watchtower/hook-token`, port from `~/Library/Application Support/Watchtower/listener.json`, and POSTs to `http://127.0.0.1:<port>/hooks/<event>` with bearer auth.
- App support dir: `~/Library/Application Support/Watchtower/`.
- Bundle ID: `cz.greencode.watchtower`.

**Spec reference:** [`../specs/2026-05-22-watchtower-instance-watcher-design.md`](../specs/2026-05-22-watchtower-instance-watcher-design.md)

---

## File Structure

```
Watchtower/
├── package.json
├── tsconfig.base.json
├── vitest.config.ts
├── .gitignore
├── electron/
│   ├── main.ts                       # Electron entry: lifecycle, window, tray hook-up
│   ├── preload.ts                    # contextBridge IPC surface for renderer
│   ├── window.ts                     # Main window creation/show/hide
│   ├── tray.ts                       # Tray icon + menu builder
│   ├── notifications.ts              # Wrapper around Electron Notification API
│   ├── orchestratorHost.ts           # utilityProcess.fork + MessagePort plumbing
│   ├── ipc.ts                        # ipcMain handlers (proxy renderer ↔ orchestrator)
│   └── tsconfig.json
├── orchestrator/
│   ├── index.ts                      # Child entry: wire DB, listener, state, MessagePort
│   ├── db/
│   │   ├── connection.ts             # better-sqlite3 setup, app-support-dir resolver
│   │   ├── migrations.ts             # Migration runner
│   │   ├── schema.sql                # CREATE TABLE statements
│   │   └── repositories/
│   │       ├── instances.ts
│   │       ├── hookEvents.ts
│   │       ├── notifications.ts
│   │       └── settings.ts
│   ├── stateMachine.ts               # Pure transition(state, event) → {state, outputs}
│   ├── notificationRules.ts          # Pure decide(...) → action
│   ├── hookListener.ts               # fastify server, token auth, Zod schemas
│   ├── listenerSidecar.ts            # listener.json read/write atomically
│   ├── ptyManager.ts                 # node-pty wrappers + lifecycle
│   ├── notifier.ts                   # Macro-decisions: emit state-change events to main
│   ├── suspendResume.ts              # Quit-suspend + start-resume + crash-recovery
│   ├── messagePort.ts                # Request/response framing over MessagePort
│   └── tsconfig.json
├── helper/
│   ├── watchtower-hook.ts            # Hook helper source
│   ├── build.mjs                     # esbuild → single watchtower-hook.js
│   └── tsconfig.json
├── client/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── theme.ts                  # MUI dark theme + tokens
│       ├── ipc.ts                    # window.watchtower bridge consumer
│       ├── state/
│       │   └── useInstances.ts       # React state hook backed by orchestrator events
│       └── components/
│           ├── ModuleRail.tsx
│           ├── StatusBar.tsx
│           ├── Terminal.tsx          # xterm.js wrapper
│           ├── TabStrip.tsx
│           ├── NewInstanceModal.tsx
│           ├── DashboardTab.tsx
│           ├── FirstRunWizard.tsx
│           └── SettingsPanel.tsx
├── shared/
│   ├── ipcContract.ts                # Types shared across processes
│   ├── events.ts                     # Event union types (hook events, state events)
│   ├── stateModel.ts                 # InstanceState enum + helpers
│   └── tsconfig.json
├── tests/
│   ├── orchestrator/
│   │   ├── stateMachine.test.ts
│   │   ├── notificationRules.test.ts
│   │   ├── migrations.test.ts
│   │   ├── repositories.test.ts
│   │   ├── hookListener.test.ts
│   │   ├── ptyManager.test.ts
│   │   ├── suspendResume.test.ts
│   │   └── helpers/echoBin.mjs       # Tiny echo binary used as a pty fixture
│   └── helper/
│       └── watchtowerHook.test.ts
├── build-resources/
│   ├── icon.icns
│   ├── tray-template.png             # macOS template image (auto-adapts to menu bar)
│   └── entitlements.mac.plist
├── docs/
│   └── superpowers/
│       ├── specs/2026-05-22-watchtower-instance-watcher-design.md
│       └── plans/2026-05-22-watchtower-instance-watcher-plan.md
└── PROTOTYPE.md
```

**File responsibility cheatsheet (one-liners):**
- `stateMachine.ts` — pure logic, no I/O, no time. All side effects expressed as "outputs" the caller acts on.
- `notificationRules.ts` — pure logic, takes a state-change + context, returns `{ notify?: {...}, snooze?: {...} }`.
- `hookListener.ts` — only translates HTTP to typed events; no business decisions.
- `ptyManager.ts` — only spawns/destroys ptys and pipes I/O; no decisions.
- `notifier.ts` — composes state machine + notification rules + emits MessagePort events.
- `suspendResume.ts` — knows DB and ptyManager; called on quit and on boot.

---

## Phase 1 — Foundation: scaffold the repo and an empty window

### Task 1: Scaffold package.json, TypeScript config, .gitignore

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "watchtower",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "concurrently -k -n main,renderer,orch -c blue,magenta,cyan \"npm:dev:main\" \"npm:dev:renderer\" \"npm:dev:orch\"",
    "dev:main": "tsc -p electron/tsconfig.json --watch --preserveWatchOutput",
    "dev:renderer": "vite --config client/vite.config.ts",
    "dev:orch": "tsc -p orchestrator/tsconfig.json --watch --preserveWatchOutput",
    "build:main": "tsc -p electron/tsconfig.json",
    "build:orch": "tsc -p orchestrator/tsconfig.json && node -e \"require('node:fs').copyFileSync('orchestrator/db/schema.sql','dist-orchestrator/db/schema.sql')\"",
    "build:renderer": "vite build --config client/vite.config.ts",
    "build:helper": "node helper/build.mjs",
    "build": "npm run build:main && npm run build:orch && npm run build:renderer && npm run build:helper",
    "start": "npm run build && electron .",
    "electron:rebuild": "electron-rebuild -f -w better-sqlite3",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p electron/tsconfig.json --noEmit && tsc -p orchestrator/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit",
    "dist:mac": "npm run build && electron-builder --mac"
  },
  "dependencies": {
    "@emotion/react": "^11.13.3",
    "@emotion/styled": "^11.13.0",
    "@fastify/cors": "^9.0.1",
    "@mui/icons-material": "^5.16.7",
    "@mui/material": "^5.16.7",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",
    "@xterm/xterm": "^5.5.0",
    "better-sqlite3": "^11.3.0",
    "fastify": "^4.28.1",
    "node-pty": "^1.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "uuid": "^10.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.4",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@types/uuid": "^10.0.0",
    "@vitejs/plugin-react": "^4.3.2",
    "concurrently": "^9.0.1",
    "cross-env": "^7.0.3",
    "electron": "^33.0.0",
    "electron-builder": "^25.1.8",
    "esbuild": "^0.24.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.8",
    "vitest": "^2.1.0"
  },
  "build": {
    "appId": "cz.greencode.watchtower",
    "productName": "Watchtower",
    "directories": {
      "buildResources": "build-resources",
      "output": "release"
    },
    "files": [
      "dist-electron/**/*",
      "dist-orchestrator/**/*",
      "dist-renderer/**/*",
      "dist-helper/**/*",
      "node_modules/**/*",
      "package.json",
      "!**/*.map",
      "!**/test/**",
      "!**/tests/**"
    ],
    "asarUnpack": [
      "node_modules/better-sqlite3/**/*",
      "node_modules/node-pty/**/*",
      "dist-helper/**/*"
    ],
    "mac": {
      "category": "public.app-category.developer-tools",
      "icon": "build-resources/icon.icns",
      "hardenedRuntime": true,
      "entitlements": "build-resources/entitlements.mac.plist"
    }
  }
}
```

- [ ] **Step 2: Run `npm install`**

Run: `npm install`
Expected: completes without error. `node_modules/` populated.

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist-electron/
dist-orchestrator/
dist-renderer/
dist-helper/
release/
*.log
.DS_Store
.vscode/
.idea/
coverage/
data.db*
```

- [ ] **Step 5: Create `.nvmrc`**

```
22
```

- [ ] **Step 6: Run `electron-rebuild` once for native modules**

Run: `npm run electron:rebuild`
Expected: rebuilds `better-sqlite3` and `node-pty` against Electron's Node version. No errors.

- [ ] **Step 7: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add package.json tsconfig.base.json .gitignore .nvmrc package-lock.json
git -C /Users/jan/Projects/Watchtower commit -m "chore: scaffold package.json, tsconfig, gitignore"
```

---

### Task 2: Bootstrap Electron main + empty window

**Files:**
- Create: `electron/tsconfig.json`
- Create: `electron/main.ts`
- Create: `electron/window.ts`

- [ ] **Step 1: Create `electron/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-electron",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Create `electron/window.ts`**

```typescript
import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow) {
    mainWindow.show();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Watchtower',
    backgroundColor: '#0e0f12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.env.WATCHTOWER_DEV_URL) {
    void mainWindow.loadURL(process.env.WATCHTOWER_DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

export function toggleMainWindow(): void {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    createMainWindow().show();
  }
}
```

- [ ] **Step 3: Create `electron/main.ts`**

```typescript
import { app } from 'electron';
import { createMainWindow } from './window.js';

app.setName('Watchtower');

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  // Keep the orchestrator alive in the background — do NOT quit on window close.
  // (Real quit is wired through the tray menu in a later task.)
});
```

- [ ] **Step 4: Build and run**

Run: `npm run build:main && WATCHTOWER_DEV_URL='data:text/html,<h1 style="font-family:sans-serif;color:white;background:#0e0f12;padding:40px">Watchtower scaffold</h1>' electron .`
Expected: dark window opens with the "Watchtower scaffold" heading. Close the window — process stays alive (no Dock quit). Hit Ctrl+C in the terminal to stop.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add electron/
git -C /Users/jan/Projects/Watchtower commit -m "feat(electron): bootstrap main process and main window"
```

---

### Task 3: Bootstrap Vite + React + MUI dark theme renderer

**Files:**
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/theme.ts`

- [ ] **Step 1: Create `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-renderer",
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 2: Create `client/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, '../dist-renderer'),
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Watchtower</title>
  </head>
  <body style="margin:0;background:#0e0f12;">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `client/src/theme.ts`**

```typescript
import { createTheme } from '@mui/material/styles';

export const watchtowerTheme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#0e0f12', paper: '#15171c' },
    primary: { main: '#7aa7ff' },
    secondary: { main: '#f0a868' },
    error: { main: '#ef5350' },
    warning: { main: '#ffb74d' },
    success: { main: '#66bb6a' },
  },
  shape: { borderRadius: 6 },
  typography: { fontFamily: 'Inter, system-ui, -apple-system, sans-serif' },
});
```

- [ ] **Step 5: Create `client/src/App.tsx`**

```typescript
import { CssBaseline, ThemeProvider, Box, Typography } from '@mui/material';
import { watchtowerTheme } from './theme.js';

export function App() {
  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ p: 6 }}>
        <Typography variant="h4">Watchtower</Typography>
        <Typography variant="body2" color="text.secondary">
          Renderer is alive.
        </Typography>
      </Box>
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Create `client/src/main.tsx`**

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');
createRoot(container).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 7: Run dev server and verify**

Run: `npm run dev:renderer`
Then in a second terminal: `WATCHTOWER_DEV_URL=http://localhost:5173 npm run build:main && WATCHTOWER_DEV_URL=http://localhost:5173 electron .`
Expected: window shows "Watchtower / Renderer is alive." on dark background. Stop both with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): bootstrap React + MUI dark renderer"
```

---

### Task 4: Preload + contextBridge IPC scaffold (renderer ↔ main)

**Files:**
- Create: `shared/tsconfig.json`
- Create: `shared/ipcContract.ts`
- Create: `electron/preload.ts`
- Create: `electron/ipc.ts`
- Modify: `electron/main.ts` (wire `registerIpc()`)
- Modify: `client/src/App.tsx` (call into IPC, render the result)

- [ ] **Step 1: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-shared",
    "rootDir": ".",
    "declaration": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Create `shared/ipcContract.ts`**

```typescript
export type IpcRequest =
  | { kind: 'ping'; payload: { now: number } };

export type IpcResponse =
  | { kind: 'ping'; payload: { now: number; main: number } };

export type IpcPush =
  | { kind: 'hello'; payload: { version: string } };

export interface WatchtowerBridge {
  invoke<T extends IpcRequest['kind']>(
    kind: T,
    payload: Extract<IpcRequest, { kind: T }>['payload'],
  ): Promise<Extract<IpcResponse, { kind: T }>['payload']>;
  on<T extends IpcPush['kind']>(
    kind: T,
    handler: (payload: Extract<IpcPush, { kind: T }>['payload']) => void,
  ): () => void;
}
```

- [ ] **Step 3: Create `electron/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

const listeners = new Map<string, Set<(payload: unknown) => void>>();

ipcRenderer.on('watchtower:push', (_event, kind: string, payload: unknown) => {
  listeners.get(kind)?.forEach((h) => h(payload));
});

contextBridge.exposeInMainWorld('watchtower', {
  invoke(kind: string, payload: unknown) {
    return ipcRenderer.invoke('watchtower:invoke', kind, payload);
  },
  on(kind: string, handler: (payload: unknown) => void) {
    let set = listeners.get(kind);
    if (!set) {
      set = new Set();
      listeners.set(kind, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  },
});
```

- [ ] **Step 4: Create `electron/ipc.ts`**

```typescript
import { ipcMain } from 'electron';
import type { IpcRequest, IpcResponse } from '../shared/ipcContract.js';
import { getMainWindow } from './window.js';

export function registerIpc(): void {
  ipcMain.handle('watchtower:invoke', async (_event, kind: IpcRequest['kind'], payload: unknown) => {
    switch (kind) {
      case 'ping': {
        const { now } = payload as { now: number };
        const response: Extract<IpcResponse, { kind: 'ping' }>['payload'] = {
          now,
          main: Date.now(),
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
```

- [ ] **Step 5: Modify `electron/main.ts` to wire IPC**

Replace file content with:

```typescript
import { app } from 'electron';
import { createMainWindow } from './window.js';
import { registerIpc, pushToRenderer } from './ipc.js';

app.setName('Watchtower');

app.whenReady().then(() => {
  registerIpc();
  const win = createMainWindow();
  win.webContents.once('did-finish-load', () => {
    pushToRenderer('hello', { version: app.getVersion() });
  });
});

app.on('window-all-closed', () => {
  // intentionally do nothing
});
```

- [ ] **Step 6: Modify `client/src/App.tsx` to exercise the bridge**

Replace file content with:

```typescript
import { useEffect, useState } from 'react';
import { CssBaseline, ThemeProvider, Box, Typography } from '@mui/material';
import { watchtowerTheme } from './theme.js';
import type { WatchtowerBridge } from '../../shared/ipcContract.js';

declare global {
  interface Window {
    watchtower: WatchtowerBridge;
  }
}

export function App() {
  const [helloVersion, setHelloVersion] = useState<string | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);

  useEffect(() => {
    const off = window.watchtower.on('hello', (p) => setHelloVersion(p.version));
    const sent = Date.now();
    void window.watchtower.invoke('ping', { now: sent }).then((res) => {
      setPingMs(res.main - sent);
    });
    return off;
  }, []);

  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ p: 6 }}>
        <Typography variant="h4">Watchtower</Typography>
        <Typography variant="body2" color="text.secondary">
          hello: {helloVersion ?? '…'} · ping: {pingMs ?? '…'} ms
        </Typography>
      </Box>
    </ThemeProvider>
  );
}
```

- [ ] **Step 7: Build, run, verify**

In one terminal: `npm run dev:renderer`
In another: `npm run build:main && WATCHTOWER_DEV_URL=http://localhost:5173 electron .`
Expected: window shows `hello: 0.0.1 · ping: <small number> ms`. Confirms preload, invoke, and push are all working.

- [ ] **Step 8: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add shared/ electron/ client/src/App.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(ipc): add preload contextBridge + request/push surface"
```

---

### Task 5: Set up Vitest + first passing test

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/sanity.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
```

- [ ] **Step 2: Create `tests/sanity.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add vitest.config.ts tests/sanity.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "test: add vitest config + sanity test"
```

---

## Phase 2 — Orchestrator skeleton: utilityProcess + DB

### Task 6: Orchestrator child via `utilityProcess.fork` + MessagePort echo

**Files:**
- Create: `orchestrator/tsconfig.json`
- Create: `orchestrator/index.ts`
- Create: `orchestrator/messagePort.ts`
- Create: `electron/orchestratorHost.ts`
- Modify: `electron/main.ts` (start orchestrator on `whenReady`)
- Modify: `electron/ipc.ts` (route `ping` through orchestrator instead of answering in main)

- [ ] **Step 1: Create `orchestrator/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-orchestrator",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Create `orchestrator/messagePort.ts`**

```typescript
import type { MessagePortMain } from 'electron';

type Resolver = (value: unknown) => void;

export type OrchRequest =
  | { id: string; kind: 'ping'; payload: { now: number } };

export type OrchResponse =
  | { kind: 'ping'; payload: { now: number; orch: number } };

export type OrchPush =
  | { kind: 'state-changed'; payload: { instanceId: string; status: string } };

export class PortApi {
  private pending = new Map<string, Resolver>();

  constructor(private port: MessagePortMain | MessagePort) {
    const onMessage = (event: MessageEvent) => this.handle(event.data);
    if ('on' in port) {
      port.on('message', (e: { data: unknown }) => this.handle(e.data));
      port.start();
    } else {
      port.addEventListener('message', onMessage);
      port.start();
    }
  }

  invoke<T extends OrchRequest['kind']>(
    kind: T,
    payload: Extract<OrchRequest, { kind: T }>['payload'],
  ): Promise<Extract<OrchResponse, { kind: T }>['payload']> {
    const id = cryptoRandomId();
    return new Promise((resolve) => {
      this.pending.set(id, resolve as Resolver);
      this.post({ id, kind, payload } as OrchRequest);
    });
  }

  push(message: OrchPush): void {
    this.post(message);
  }

  onRequest(handler: (req: OrchRequest) => Promise<OrchResponse['payload']>): void {
    this.requestHandler = handler;
  }

  private requestHandler:
    | ((req: OrchRequest) => Promise<OrchResponse['payload']>)
    | null = null;

  private async handle(data: unknown): Promise<void> {
    const msg = data as
      | (OrchRequest & { id: string })
      | { id: string; kind: OrchRequest['kind']; payload: unknown; _response: true }
      | OrchPush;
    if ('_response' in msg && msg._response) {
      const resolver = this.pending.get(msg.id);
      if (resolver) {
        this.pending.delete(msg.id);
        resolver(msg.payload);
      }
      return;
    }
    if ('id' in msg && this.requestHandler) {
      const payload = await this.requestHandler(msg as OrchRequest);
      this.post({ id: msg.id, kind: msg.kind, payload, _response: true });
      return;
    }
  }

  private post(data: unknown): void {
    (this.port as { postMessage: (d: unknown) => void }).postMessage(data);
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
```

- [ ] **Step 3: Create `orchestrator/index.ts`**

```typescript
import { PortApi, type OrchRequest } from './messagePort.js';

const parentPort = (process as unknown as { parentPort: MessagePort }).parentPort;
if (!parentPort) throw new Error('orchestrator must run as a utilityProcess child');

const api = new PortApi(parentPort);

api.onRequest(async (req: OrchRequest) => {
  switch (req.kind) {
    case 'ping':
      return { now: req.payload.now, orch: Date.now() };
  }
});

setInterval(() => {
  // heartbeat placeholder so we can verify the child stays alive
}, 5000).unref();
```

- [ ] **Step 4: Create `electron/orchestratorHost.ts`**

```typescript
import { utilityProcess, type UtilityProcess, MessageChannelMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortApi } from '../orchestrator/messagePort.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let child: UtilityProcess | null = null;
let api: PortApi | null = null;

export function startOrchestrator(): PortApi {
  if (api) return api;
  const entry = path.join(__dirname, '../dist-orchestrator/index.js');
  child = utilityProcess.fork(entry, [], { serviceName: 'watchtower-orchestrator', stdio: 'inherit' });
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage({ kind: 'init' }, [port1]);
  api = new PortApi(port2);
  child.on('exit', (code) => {
    console.error(`[orchestrator] exited with code ${code}`);
    api = null;
    child = null;
  });
  return api;
}

export function getOrchestrator(): PortApi {
  if (!api) throw new Error('orchestrator not started');
  return api;
}
```

- [ ] **Step 5: Modify `orchestrator/index.ts` to receive the port from `init`**

Replace file content with:

```typescript
import { PortApi, type OrchRequest } from './messagePort.js';

let api: PortApi | null = null;

(process as NodeJS.Process).parentPort?.on('message', (event: { data: { kind: string }; ports?: MessagePort[] }) => {
  if (event.data?.kind === 'init' && event.ports?.[0]) {
    api = new PortApi(event.ports[0]);
    api.onRequest(async (req: OrchRequest) => {
      switch (req.kind) {
        case 'ping':
          return { now: req.payload.now, orch: Date.now() };
      }
    });
  }
});

setInterval(() => {
  // heartbeat placeholder
}, 5000).unref();
```

- [ ] **Step 6: Modify `electron/main.ts` to start orchestrator**

```typescript
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
  // intentionally do nothing — orchestrator keeps running
});
```

- [ ] **Step 7: Modify `electron/ipc.ts` to route ping through orchestrator**

Replace the `case 'ping':` block with:

```typescript
      case 'ping': {
        const { now } = payload as { now: number };
        const res = await getOrchestrator().invoke('ping', { now });
        return { now, main: Date.now(), orch: res.orch };
      }
```

Add the import at the top:

```typescript
import { getOrchestrator } from './orchestratorHost.js';
```

Update `shared/ipcContract.ts` `IpcResponse` so `ping` includes `orch`:

```typescript
export type IpcResponse =
  | { kind: 'ping'; payload: { now: number; main: number; orch: number } };
```

Update `client/src/App.tsx` rendering to show all three timestamps:

```typescript
        hello: {helloVersion ?? '…'} · main: {pingMs ?? '…'} ms · orch: {orchMs ?? '…'} ms
```

…and add the second `useState<number | null>(null)` and `setOrchMs(res.orch - sent)` in the existing effect.

- [ ] **Step 8: Build, run, verify**

In one terminal: `npm run dev:renderer`
In another: `npm run build:main && npm run build:orch && WATCHTOWER_DEV_URL=http://localhost:5173 electron .`
Expected: window shows `hello: 0.0.1 · main: <ms> · orch: <ms>`. Confirms the round-trip Renderer → main → orchestrator → main → renderer works.

- [ ] **Step 9: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/ electron/orchestratorHost.ts electron/main.ts electron/ipc.ts shared/ipcContract.ts client/src/App.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): fork as utilityProcess + MessagePort RPC"
```

---

### Task 7: SQLite + app-support-dir resolver

**Files:**
- Create: `orchestrator/db/connection.ts`
- Create: `orchestrator/db/schema.sql`
- Create: `orchestrator/db/migrations.ts`
- Create: `tests/orchestrator/migrations.test.ts`

- [ ] **Step 1: Write failing test `tests/orchestrator/migrations.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../orchestrator/db/migrations.js';

describe('migrations', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  });

  it('creates instances, hook_events, notifications, settings tables', () => {
    const db = new Database(dbPath);
    runMigrations(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('instances');
    expect(names).toContain('hook_events');
    expect(names).toContain('notifications');
    expect(names).toContain('settings');
    expect(names).toContain('schema_version');
  });

  it('is idempotent when run twice', () => {
    const db = new Database(dbPath);
    runMigrations(db);
    runMigrations(db);
    const version = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `npm test -- tests/orchestrator/migrations.test.ts`
Expected: FAIL — cannot find `runMigrations`.

- [ ] **Step 3: Create `orchestrator/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  claude_session_id TEXT,
  spawned_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  exit_code INTEGER,
  termination_reason TEXT,
  resumed_from_instance_id TEXT REFERENCES instances(id),
  jira_key_hint TEXT,
  args_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);

CREATE TABLE IF NOT EXISTS hook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT REFERENCES instances(id),
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hook_events_instance ON hook_events(instance_id, received_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT REFERENCES instances(id),
  kind TEXT NOT NULL,
  fired_at INTEGER NOT NULL,
  dismissed_at INTEGER,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 4: Create `orchestrator/db/migrations.ts`**

```typescript
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CURRENT_VERSION = 1;

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const row = db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  if (current >= CURRENT_VERSION) return;
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
    CURRENT_VERSION,
    Date.now(),
  );
}
```

- [ ] **Step 5: Run the test — confirm it passes**

Run: `npm test -- tests/orchestrator/migrations.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Create `orchestrator/db/connection.ts`**

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { runMigrations } from './migrations.js';

export function appSupportDir(): string {
  const dir = path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function openDb(overridePath?: string): Database.Database {
  const dbPath = overridePath ?? path.join(appSupportDir(), 'data.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
```

- [ ] **Step 7: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/db/ tests/orchestrator/migrations.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): SQLite schema + migrations + app-support resolver"
```

---

### Task 8: Repositories — `instances`, `hook_events`, `notifications`, `settings`

**Files:**
- Create: `shared/stateModel.ts`
- Create: `orchestrator/db/repositories/instances.ts`
- Create: `orchestrator/db/repositories/hookEvents.ts`
- Create: `orchestrator/db/repositories/notifications.ts`
- Create: `orchestrator/db/repositories/settings.ts`
- Create: `tests/orchestrator/repositories.test.ts`

- [ ] **Step 1: Create `shared/stateModel.ts`**

```typescript
export type InstanceStatus =
  | 'spawning'
  | 'working'
  | 'waiting-permission'
  | 'waiting-input'
  | 'idle-notify'
  | 'finished'
  | 'crashed'
  | 'suspended'
  | 'resuming';

export const LIVE_STATUSES: ReadonlyArray<InstanceStatus> = [
  'spawning',
  'working',
  'waiting-permission',
  'waiting-input',
  'idle-notify',
];

export type TerminationReason =
  | 'session-end'
  | 'user-kill'
  | 'app-quit-suspend'
  | 'crash'
  | 'resume-failed'
  | 'no-session-id';

export interface InstanceRow {
  id: string;
  cwd: string;
  status: InstanceStatus;
  claudeSessionId: string | null;
  spawnedAt: number;
  lastActivityAt: number;
  exitCode: number | null;
  terminationReason: TerminationReason | null;
  resumedFromInstanceId: string | null;
  jiraKeyHint: string | null;
  argsJson: string | null;
}
```

- [ ] **Step 2: Write failing test `tests/orchestrator/repositories.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';
import { HookEventsRepo } from '../../orchestrator/db/repositories/hookEvents.js';
import { SettingsRepo } from '../../orchestrator/db/repositories/settings.js';

describe('repositories', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  it('InstancesRepo round-trips a row', () => {
    const repo = new InstancesRepo(db);
    repo.insert({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cwd: '/tmp/x',
      status: 'spawning',
      claudeSessionId: null,
      spawnedAt: 1,
      lastActivityAt: 1,
      exitCode: null,
      terminationReason: null,
      resumedFromInstanceId: null,
      jiraKeyHint: null,
      argsJson: null,
    });
    const found = repo.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(found?.cwd).toBe('/tmp/x');
    expect(found?.status).toBe('spawning');
  });

  it('InstancesRepo.listLive returns only live statuses', () => {
    const repo = new InstancesRepo(db);
    repo.insert({ id: '1', cwd: '/a', status: 'working', claudeSessionId: null, spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null, resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null });
    repo.insert({ id: '2', cwd: '/b', status: 'finished', claudeSessionId: null, spawnedAt: 1, lastActivityAt: 1, exitCode: 0, terminationReason: 'session-end', resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null });
    expect(repo.listLive().map((r) => r.id)).toEqual(['1']);
  });

  it('HookEventsRepo appends and prunes', () => {
    const instances = new InstancesRepo(db);
    instances.insert({ id: '1', cwd: '/a', status: 'working', claudeSessionId: null, spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null, resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null });
    const events = new HookEventsRepo(db);
    events.append('1', 'Notification', { foo: 'bar' }, 100);
    events.append('1', 'Stop', {}, 200);
    expect(events.listForInstance('1').length).toBe(2);
    events.pruneOlderThan(150);
    expect(events.listForInstance('1').length).toBe(1);
  });

  it('SettingsRepo get/set with default', () => {
    const repo = new SettingsRepo(db);
    expect(repo.getString('quiet_timer_ms', '90000')).toBe('90000');
    repo.set('quiet_timer_ms', '120000');
    expect(repo.getString('quiet_timer_ms', '90000')).toBe('120000');
  });
});
```

- [ ] **Step 3: Run the test — confirm it fails**

Run: `npm test -- tests/orchestrator/repositories.test.ts`
Expected: FAIL — repos not found.

- [ ] **Step 4: Create `orchestrator/db/repositories/instances.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { InstanceRow, InstanceStatus } from '../../../shared/stateModel.js';
import { LIVE_STATUSES } from '../../../shared/stateModel.js';

type DbInstanceRow = {
  id: string;
  cwd: string;
  status: InstanceStatus;
  claude_session_id: string | null;
  spawned_at: number;
  last_activity_at: number;
  exit_code: number | null;
  termination_reason: InstanceRow['terminationReason'];
  resumed_from_instance_id: string | null;
  jira_key_hint: string | null;
  args_json: string | null;
};

function toRow(r: DbInstanceRow): InstanceRow {
  return {
    id: r.id,
    cwd: r.cwd,
    status: r.status,
    claudeSessionId: r.claude_session_id,
    spawnedAt: r.spawned_at,
    lastActivityAt: r.last_activity_at,
    exitCode: r.exit_code,
    terminationReason: r.termination_reason,
    resumedFromInstanceId: r.resumed_from_instance_id,
    jiraKeyHint: r.jira_key_hint,
    argsJson: r.args_json,
  };
}

export class InstancesRepo {
  constructor(private db: Database.Database) {}

  insert(row: InstanceRow): void {
    this.db
      .prepare(
        `INSERT INTO instances (id, cwd, status, claude_session_id, spawned_at, last_activity_at, exit_code, termination_reason, resumed_from_instance_id, jira_key_hint, args_json)
         VALUES (@id, @cwd, @status, @claudeSessionId, @spawnedAt, @lastActivityAt, @exitCode, @terminationReason, @resumedFromInstanceId, @jiraKeyHint, @argsJson)`,
      )
      .run(row);
  }

  get(id: string): InstanceRow | null {
    const row = this.db.prepare(`SELECT * FROM instances WHERE id = ?`).get(id) as DbInstanceRow | undefined;
    return row ? toRow(row) : null;
  }

  listAll(): InstanceRow[] {
    return (this.db.prepare(`SELECT * FROM instances ORDER BY spawned_at DESC`).all() as DbInstanceRow[]).map(toRow);
  }

  listLive(): InstanceRow[] {
    const placeholders = LIVE_STATUSES.map(() => '?').join(',');
    return (this.db
      .prepare(`SELECT * FROM instances WHERE status IN (${placeholders}) ORDER BY spawned_at`)
      .all(...LIVE_STATUSES) as DbInstanceRow[]).map(toRow);
  }

  updateStatus(id: string, status: InstanceStatus, now: number): void {
    this.db
      .prepare(`UPDATE instances SET status = ?, last_activity_at = ? WHERE id = ?`)
      .run(status, now, id);
  }

  setClaudeSessionId(id: string, sessionId: string): void {
    this.db.prepare(`UPDATE instances SET claude_session_id = ? WHERE id = ?`).run(sessionId, id);
  }

  setTermination(id: string, reason: InstanceRow['terminationReason'], exitCode: number | null): void {
    this.db
      .prepare(`UPDATE instances SET termination_reason = ?, exit_code = ? WHERE id = ?`)
      .run(reason, exitCode, id);
  }
}
```

- [ ] **Step 5: Create `orchestrator/db/repositories/hookEvents.ts`**

```typescript
import type Database from 'better-sqlite3';

export class HookEventsRepo {
  constructor(private db: Database.Database) {}

  append(instanceId: string, eventName: string, payload: unknown, now: number): void {
    this.db
      .prepare(`INSERT INTO hook_events (instance_id, event_name, payload_json, received_at) VALUES (?, ?, ?, ?)`)
      .run(instanceId, eventName, JSON.stringify(payload), now);
  }

  listForInstance(instanceId: string): Array<{ eventName: string; payload: unknown; receivedAt: number }> {
    const rows = this.db
      .prepare(`SELECT event_name, payload_json, received_at FROM hook_events WHERE instance_id = ? ORDER BY received_at`)
      .all(instanceId) as Array<{ event_name: string; payload_json: string; received_at: number }>;
    return rows.map((r) => ({ eventName: r.event_name, payload: JSON.parse(r.payload_json), receivedAt: r.received_at }));
  }

  pruneOlderThan(cutoff: number): number {
    return this.db.prepare(`DELETE FROM hook_events WHERE received_at < ?`).run(cutoff).changes;
  }
}
```

- [ ] **Step 6: Create `orchestrator/db/repositories/notifications.ts`**

```typescript
import type Database from 'better-sqlite3';

export class NotificationsRepo {
  constructor(private db: Database.Database) {}

  log(instanceId: string, kind: string, body: string, now: number): number {
    return Number(
      this.db
        .prepare(`INSERT INTO notifications (instance_id, kind, fired_at, body) VALUES (?, ?, ?, ?)`)
        .run(instanceId, kind, now, body).lastInsertRowid,
    );
  }

  dismiss(id: number, now: number): void {
    this.db.prepare(`UPDATE notifications SET dismissed_at = ? WHERE id = ?`).run(now, id);
  }
}
```

- [ ] **Step 7: Create `orchestrator/db/repositories/settings.ts`**

```typescript
import type Database from 'better-sqlite3';

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  getString(key: string, def: string): string {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? def;
  }

  getNumber(key: string, def: number): number {
    const s = this.getString(key, String(def));
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }
}
```

- [ ] **Step 8: Run tests — confirm pass**

Run: `npm test -- tests/orchestrator/repositories.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add shared/stateModel.ts orchestrator/db/repositories/ tests/orchestrator/repositories.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): instance / hookEvent / notification / settings repos"
```

---

## Phase 3 — State machine + notification rules (pure logic, TDD)

### Task 9: State machine — `transition(state, event) → { state, outputs }`

**Files:**
- Create: `shared/events.ts`
- Create: `orchestrator/stateMachine.ts`
- Create: `tests/orchestrator/stateMachine.test.ts`

- [ ] **Step 1: Create `shared/events.ts`**

```typescript
import type { InstanceStatus } from './stateModel.js';

export type StateEvent =
  | { kind: 'sessionStart'; sessionId: string }
  | { kind: 'notificationHook' }
  | { kind: 'stopHook' }
  | { kind: 'userPromptSubmit' }
  | { kind: 'sessionEnd' }
  | { kind: 'ptyData' }
  | { kind: 'ptyExit'; code: number }
  | { kind: 'quietTimerFired' }
  | { kind: 'tabFocused' };

export type StateOutput =
  | { kind: 'startQuietTimer' }
  | { kind: 'clearQuietTimer' }
  | { kind: 'clearAttention' }
  | { kind: 'storeClaudeSessionId'; sessionId: string };

export interface TransitionResult {
  state: InstanceStatus;
  outputs: StateOutput[];
}
```

- [ ] **Step 2: Write failing test `tests/orchestrator/stateMachine.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { transition } from '../../orchestrator/stateMachine.js';
import type { InstanceStatus } from '../../shared/stateModel.js';
import type { StateEvent, StateOutput } from '../../shared/events.js';

type Case = {
  name: string;
  from: InstanceStatus;
  event: StateEvent;
  to: InstanceStatus;
  outputs?: StateOutput[];
};

const cases: Case[] = [
  { name: 'spawning → working on sessionStart', from: 'spawning', event: { kind: 'sessionStart', sessionId: 'abc' }, to: 'working', outputs: [{ kind: 'storeClaudeSessionId', sessionId: 'abc' }] },
  { name: 'working → waiting-permission on notificationHook', from: 'working', event: { kind: 'notificationHook' }, to: 'waiting-permission' },
  { name: 'working → waiting-input on stopHook', from: 'working', event: { kind: 'stopHook' }, to: 'waiting-input', outputs: [{ kind: 'startQuietTimer' }] },
  { name: 'waiting-input → idle-notify on quietTimerFired', from: 'waiting-input', event: { kind: 'quietTimerFired' }, to: 'idle-notify' },
  { name: 'waiting-permission → working on userPromptSubmit', from: 'waiting-permission', event: { kind: 'userPromptSubmit' }, to: 'working', outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }] },
  { name: 'waiting-input → working on userPromptSubmit', from: 'waiting-input', event: { kind: 'userPromptSubmit' }, to: 'working', outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }] },
  { name: 'idle-notify → working on userPromptSubmit', from: 'idle-notify', event: { kind: 'userPromptSubmit' }, to: 'working', outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }] },
  { name: 'waiting-input → working on ptyData', from: 'waiting-input', event: { kind: 'ptyData' }, to: 'working' },
  { name: 'idle-notify → working on ptyData', from: 'idle-notify', event: { kind: 'ptyData' }, to: 'working' },
  { name: 'any live → finished on ptyExit(0)', from: 'working', event: { kind: 'ptyExit', code: 0 }, to: 'finished' },
  { name: 'any live → crashed on ptyExit(non-zero)', from: 'working', event: { kind: 'ptyExit', code: 1 }, to: 'crashed' },
  { name: 'any live → finished on sessionEnd', from: 'working', event: { kind: 'sessionEnd' }, to: 'finished' },
  { name: 'waiting-input → working on tabFocused (cancels quietTimer + attention)', from: 'waiting-input', event: { kind: 'tabFocused' }, to: 'working', outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }] },
  { name: 'waiting-permission stays on stopHook (permission trumps input)', from: 'waiting-permission', event: { kind: 'stopHook' }, to: 'waiting-permission' },
  { name: 'waiting-permission → waiting-input is not a thing — stopHook is ignored', from: 'waiting-permission', event: { kind: 'stopHook' }, to: 'waiting-permission' },
];

describe('transition', () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = transition(c.from, c.event);
      expect(result.state).toBe(c.to);
      if (c.outputs) expect(result.outputs).toEqual(c.outputs);
    });
  }

  it('is a no-op for events in terminal states', () => {
    expect(transition('finished', { kind: 'ptyData' }).state).toBe('finished');
    expect(transition('crashed', { kind: 'userPromptSubmit' }).state).toBe('crashed');
  });
});
```

- [ ] **Step 3: Run the test — confirm it fails**

Run: `npm test -- tests/orchestrator/stateMachine.test.ts`
Expected: FAIL — `transition` not defined.

- [ ] **Step 4: Create `orchestrator/stateMachine.ts`**

```typescript
import type { InstanceStatus } from '../shared/stateModel.js';
import type { StateEvent, StateOutput, TransitionResult } from '../shared/events.js';

const TERMINAL: ReadonlyArray<InstanceStatus> = ['finished', 'crashed', 'suspended', 'resuming'];

export function transition(state: InstanceStatus, event: StateEvent): TransitionResult {
  if (TERMINAL.includes(state)) return { state, outputs: [] };

  switch (event.kind) {
    case 'sessionStart':
      return {
        state: state === 'spawning' ? 'working' : state,
        outputs: [{ kind: 'storeClaudeSessionId', sessionId: event.sessionId }],
      };

    case 'notificationHook':
      return { state: 'waiting-permission', outputs: [] };

    case 'stopHook':
      if (state === 'waiting-permission') return { state, outputs: [] };
      return { state: 'waiting-input', outputs: [{ kind: 'startQuietTimer' }] };

    case 'userPromptSubmit':
    case 'tabFocused':
      return {
        state: 'working',
        outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }],
      };

    case 'ptyData':
      if (state === 'waiting-input' || state === 'idle-notify') {
        return { state: 'working', outputs: [] };
      }
      return { state, outputs: [] };

    case 'quietTimerFired':
      if (state === 'waiting-input') return { state: 'idle-notify', outputs: [] };
      return { state, outputs: [] };

    case 'sessionEnd':
      return { state: 'finished', outputs: [] };

    case 'ptyExit':
      return { state: event.code === 0 ? 'finished' : 'crashed', outputs: [] };
  }
}
```

- [ ] **Step 5: Run the tests — confirm pass**

Run: `npm test -- tests/orchestrator/stateMachine.test.ts`
Expected: all cases passed.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add shared/events.ts orchestrator/stateMachine.ts tests/orchestrator/stateMachine.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): pure state machine for instance lifecycle"
```

---

### Task 10: Notification rules — `decide(prev, next, focus, snoozed) → action`

**Files:**
- Create: `orchestrator/notificationRules.ts`
- Create: `tests/orchestrator/notificationRules.test.ts`

- [ ] **Step 1: Write failing test `tests/orchestrator/notificationRules.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { decide } from '../../orchestrator/notificationRules.js';

describe('decide', () => {
  it('fires notification on transition to waiting-permission when tab unfocused', () => {
    const action = decide('working', 'waiting-permission', { focused: false, snoozedUntil: 0 }, 1000);
    expect(action.notify).toBeDefined();
    expect(action.notify?.kind).toBe('waiting-permission');
    expect(action.badgeDelta).toBe(1);
  });

  it('does not fire when tab is focused', () => {
    const action = decide('working', 'waiting-permission', { focused: true, snoozedUntil: 0 }, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });

  it('does not fire when snoozed', () => {
    const action = decide('working', 'waiting-permission', { focused: false, snoozedUntil: 2000 }, 1000);
    expect(action.notify).toBeUndefined();
  });

  it('fires on transition to idle-notify when tab unfocused', () => {
    const action = decide('waiting-input', 'idle-notify', { focused: false, snoozedUntil: 0 }, 1000);
    expect(action.notify?.kind).toBe('idle-notify');
    expect(action.badgeDelta).toBe(1);
  });

  it('clears attention on transition back to working', () => {
    const action = decide('waiting-permission', 'working', { focused: false, snoozedUntil: 0 }, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.clearAttention).toBe(true);
    expect(action.badgeDelta).toBe(-1);
  });

  it('does nothing on working → waiting-input (we wait for quietTimer)', () => {
    const action = decide('working', 'waiting-input', { focused: false, snoozedUntil: 0 }, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });

  it('does nothing on idempotent same-state', () => {
    const action = decide('waiting-permission', 'waiting-permission', { focused: false, snoozedUntil: 0 }, 1000);
    expect(action.notify).toBeUndefined();
    expect(action.badgeDelta).toBe(0);
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npm test -- tests/orchestrator/notificationRules.test.ts`
Expected: FAIL — `decide` not defined.

- [ ] **Step 3: Create `orchestrator/notificationRules.ts`**

```typescript
import type { InstanceStatus } from '../shared/stateModel.js';

export interface RuleContext {
  focused: boolean;
  snoozedUntil: number;
}

export interface NotifyAction {
  notify?: { kind: 'waiting-permission' | 'idle-notify' };
  clearAttention?: boolean;
  badgeDelta: number;
}

export function decide(
  prev: InstanceStatus,
  next: InstanceStatus,
  ctx: RuleContext,
  now: number,
): NotifyAction {
  if (prev === next) return { badgeDelta: 0 };

  const enteredAttention =
    (next === 'waiting-permission' && prev !== 'waiting-permission') ||
    (next === 'idle-notify' && prev !== 'idle-notify');

  const leftAttention =
    (prev === 'waiting-permission' || prev === 'idle-notify') &&
    next !== 'waiting-permission' &&
    next !== 'idle-notify';

  if (enteredAttention) {
    const snoozed = ctx.snoozedUntil > now;
    if (ctx.focused || snoozed) return { badgeDelta: 0 };
    return {
      notify: { kind: next === 'waiting-permission' ? 'waiting-permission' : 'idle-notify' },
      badgeDelta: 1,
    };
  }

  if (leftAttention) {
    return { clearAttention: true, badgeDelta: -1 };
  }

  return { badgeDelta: 0 };
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- tests/orchestrator/notificationRules.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/notificationRules.ts tests/orchestrator/notificationRules.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): pure notification decision rules"
```

---

## Phase 4 — Hook listener + helper binary

### Task 11: Listener sidecar file (`listener.json`) read/write

**Files:**
- Create: `orchestrator/listenerSidecar.ts`
- Create: `tests/orchestrator/listenerSidecar.test.ts`

- [ ] **Step 1: Write failing test `tests/orchestrator/listenerSidecar.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { writeListenerSidecar, readListenerSidecar } from '../../orchestrator/listenerSidecar.js';

describe('listenerSidecar', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
  });

  it('round-trips port + token', () => {
    const file = path.join(dir, 'listener.json');
    writeListenerSidecar(file, { port: 7421, token: 'secret', writtenAt: 100 });
    const got = readListenerSidecar(file);
    expect(got).toEqual({ port: 7421, token: 'secret', writtenAt: 100 });
  });

  it('writes with chmod 600', () => {
    const file = path.join(dir, 'listener.json');
    writeListenerSidecar(file, { port: 7421, token: 'secret', writtenAt: 100 });
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns null for missing file', () => {
    expect(readListenerSidecar(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const file = path.join(dir, 'listener.json');
    require('node:fs').writeFileSync(file, 'not json');
    expect(readListenerSidecar(file)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npm test -- tests/orchestrator/listenerSidecar.test.ts`
Expected: FAIL — `listenerSidecar` not found.

- [ ] **Step 3: Create `orchestrator/listenerSidecar.ts`**

```typescript
import { writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';

export interface ListenerSidecar {
  port: number;
  token: string;
  writtenAt: number;
}

export function writeListenerSidecar(file: string, data: ListenerSidecar): void {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  require('node:fs').renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function readListenerSidecar(file: string): ListenerSidecar | null {
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof data?.port !== 'number' || typeof data?.token !== 'string') return null;
    return { port: data.port, token: data.token, writtenAt: Number(data.writtenAt) || 0 };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- tests/orchestrator/listenerSidecar.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/listenerSidecar.ts tests/orchestrator/listenerSidecar.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): listener sidecar file (port + token) read/write"
```

---

### Task 12: Hook listener HTTP server (fastify + Zod + port walk + token auth)

**Files:**
- Create: `orchestrator/hookListener.ts`
- Create: `tests/orchestrator/hookListener.test.ts`

- [ ] **Step 1: Write failing test `tests/orchestrator/hookListener.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startHookListener, type HookListenerHandle } from '../../orchestrator/hookListener.js';

describe('hookListener', () => {
  let handle: HookListenerHandle;
  const received: Array<{ event: string; body: unknown; instanceId: string }> = [];

  beforeEach(async () => {
    received.length = 0;
    handle = await startHookListener({
      token: 'test-token',
      portRange: [17421, 17430],
      onEvent: async (event, body, instanceId) => {
        received.push({ event, body, instanceId });
      },
    });
  });

  afterEach(async () => {
    await handle.stop();
  });

  it('binds to a port in range and reports it', () => {
    expect(handle.port).toBeGreaterThanOrEqual(17421);
    expect(handle.port).toBeLessThanOrEqual(17430);
  });

  it('accepts a Notification hook with valid token + instance header', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Notification`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
        'x-watchtower-instance': 'inst-1',
      },
      body: JSON.stringify({ session_id: 'abc', cwd: '/tmp', hook_event_name: 'Notification' }),
    });
    expect(res.status).toBe(204);
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe('Notification');
    expect(received[0]?.instanceId).toBe('inst-1');
  });

  it('rejects requests without token (401)', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Notification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unknown event names (400)', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Whatever`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
        'x-watchtower-instance': 'inst-1',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects payloads larger than 32 KB (413)', async () => {
    const big = 'x'.repeat(33 * 1024);
    const res = await fetch(`http://127.0.0.1:${handle.port}/hooks/Notification`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
        'x-watchtower-instance': 'inst-1',
      },
      body: JSON.stringify({ blob: big }),
    });
    expect(res.status).toBe(413);
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npm test -- tests/orchestrator/hookListener.test.ts`
Expected: FAIL — `startHookListener` not defined.

- [ ] **Step 3: Create `orchestrator/hookListener.ts`**

```typescript
import Fastify, { type FastifyInstance } from 'fastify';

const KNOWN_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']);
const MAX_BODY = 32 * 1024;

export interface HookListenerOptions {
  token: string;
  portRange: [number, number];
  onEvent: (event: string, body: unknown, instanceId: string) => Promise<void>;
}

export interface HookListenerHandle {
  port: number;
  stop(): Promise<void>;
}

export async function startHookListener(opts: HookListenerOptions): Promise<HookListenerHandle> {
  const app: FastifyInstance = Fastify({ bodyLimit: MAX_BODY });

  app.addHook('preHandler', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post('/hooks/:event', async (req, reply) => {
    const event = (req.params as { event: string }).event;
    if (!KNOWN_EVENTS.has(event)) {
      await reply.code(400).send({ error: 'unknown event' });
      return;
    }
    const instanceId = String(req.headers['x-watchtower-instance'] ?? '');
    if (!instanceId) {
      await reply.code(400).send({ error: 'missing instance header' });
      return;
    }
    await opts.onEvent(event, req.body, instanceId);
    await reply.code(204).send();
  });

  app.setErrorHandler(async (err, _req, reply) => {
    if (err.statusCode === 413 || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      await reply.code(413).send({ error: 'body too large' });
      return;
    }
    await reply.code(500).send({ error: 'internal' });
  });

  let port: number | null = null;
  for (let p = opts.portRange[0]; p <= opts.portRange[1]; p++) {
    try {
      await app.listen({ host: '127.0.0.1', port: p });
      port = p;
      break;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code !== 'EADDRINUSE') throw err;
    }
  }
  if (port == null) throw new Error('no free port in range');

  return {
    port,
    stop: () => app.close(),
  };
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- tests/orchestrator/hookListener.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/hookListener.ts tests/orchestrator/hookListener.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): hook listener HTTP server with auth + port walk"
```

---

### Task 13: Hook helper binary (`watchtower-hook.js`)

**Files:**
- Create: `helper/tsconfig.json`
- Create: `helper/watchtower-hook.ts`
- Create: `helper/build.mjs`
- Create: `tests/helper/watchtowerHook.test.ts`

- [ ] **Step 1: Create `helper/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-helper-src",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Write failing test `tests/helper/watchtowerHook.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SCRIPT = path.resolve(__dirname, '../../helper/watchtower-hook.ts');

function runHook(args: string[], stdinJson: unknown, env: NodeJS.ProcessEnv): Promise<{ code: number | null }>{
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', HOOK_SCRIPT, ...args], { env: { ...process.env, ...env } });
    proc.stdin.write(JSON.stringify(stdinJson));
    proc.stdin.end();
    proc.on('exit', (code) => resolve({ code }));
  });
}

describe('watchtower-hook helper', () => {
  let dir: string;
  let server: http.Server;
  let port: number;
  const received: Array<{ url: string; auth: string | undefined; body: string }> = [];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
    received.length = 0;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ url: req.url ?? '', auth: req.headers.authorization as string | undefined, body });
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (!addr || typeof addr !== 'object') throw new Error('no address');
    port = addr.port;
    writeFileSync(path.join(dir, 'listener.json'), JSON.stringify({ port, token: 'tok', writtenAt: Date.now() }), { mode: 0o600 });
    writeFileSync(path.join(dir, 'hook-token'), 'tok', { mode: 0o600 });
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('forwards payload with bearer auth and instance header', async () => {
    const { code } = await runHook(['Notification'], { session_id: 'abc' }, {
      WATCHTOWER_SUPPORT_DIR: dir,
      WATCHTOWER_INSTANCE_ID: 'inst-1',
    });
    expect(code).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0]?.url).toBe('/hooks/Notification');
    expect(received[0]?.auth).toBe('Bearer tok');
    expect(JSON.parse(received[0]?.body ?? '{}').session_id).toBe('abc');
  });

  it('exits 0 even if server is unreachable', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { code } = await runHook(['Notification'], {}, {
      WATCHTOWER_SUPPORT_DIR: dir,
      WATCHTOWER_INSTANCE_ID: 'inst-1',
    });
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 3: Run — confirm it fails**

Run: `npm test -- tests/helper/watchtowerHook.test.ts`
Expected: FAIL — script not found.

- [ ] **Step 4: Create `helper/watchtower-hook.ts`**

```typescript
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';

function supportDir(): string {
  return process.env.WATCHTOWER_SUPPORT_DIR
    ?? path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 150);
  });
}

async function main(): Promise<void> {
  const event = process.argv[2];
  if (!event) {
    process.exit(0);
  }

  let token = '';
  let port = 0;
  try {
    token = readFileSync(path.join(supportDir(), 'hook-token'), 'utf8').trim();
    const sidecar = JSON.parse(readFileSync(path.join(supportDir(), 'listener.json'), 'utf8'));
    port = Number(sidecar.port);
  } catch {
    process.exit(0);
  }
  if (!token || !port) process.exit(0);

  const instanceId = process.env.WATCHTOWER_INSTANCE_ID ?? '';
  const body = await readStdin();

  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/hooks/${event}`,
        timeout: 200,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-watchtower-instance': instanceId,
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });

  process.exit(0);
}

void main();
```

- [ ] **Step 5: Create `helper/build.mjs`**

```javascript
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(__dirname, 'watchtower-hook.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(__dirname, '..', 'dist-helper', 'watchtower-hook.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  minify: false,
});

console.log('built dist-helper/watchtower-hook.mjs');
```

- [ ] **Step 6: Run test — confirm pass**

Run: `npm test -- tests/helper/watchtowerHook.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Build the helper bundle and verify**

Run: `npm run build:helper`
Expected: `dist-helper/watchtower-hook.mjs` created.

- [ ] **Step 8: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add helper/ tests/helper/
git -C /Users/jan/Projects/Watchtower commit -m "feat(helper): watchtower-hook forwarder + esbuild bundle"
```

---

### Task 14: Wire orchestrator boot — open DB, start listener, write sidecar, generate token

**Files:**
- Create: `orchestrator/bootstrap.ts`
- Modify: `orchestrator/index.ts` (call `bootstrap()` on init)
- Create: `tests/orchestrator/bootstrap.test.ts`

- [ ] **Step 1: Write failing test `tests/orchestrator/bootstrap.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { bootstrap } from '../../orchestrator/bootstrap.js';

describe('bootstrap', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
  });

  it('opens DB, starts listener, writes sidecar + token', async () => {
    const handle = await bootstrap({ supportDir: dir, portRange: [17500, 17510] });
    expect(handle.listener.port).toBeGreaterThanOrEqual(17500);
    expect(existsSync(path.join(dir, 'data.db'))).toBe(true);
    expect(existsSync(path.join(dir, 'listener.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'hook-token'))).toBe(true);
    const sidecar = JSON.parse(readFileSync(path.join(dir, 'listener.json'), 'utf8'));
    expect(sidecar.port).toBe(handle.listener.port);
    expect(sidecar.token).toMatch(/^[a-f0-9]{32,}$/);
    await handle.shutdown();
  });

  it('reuses existing token if present', async () => {
    const existing = 'a'.repeat(64);
    require('node:fs').writeFileSync(path.join(dir, 'hook-token'), existing, { mode: 0o600 });
    const handle = await bootstrap({ supportDir: dir, portRange: [17500, 17510] });
    const sidecar = JSON.parse(readFileSync(path.join(dir, 'listener.json'), 'utf8'));
    expect(sidecar.token).toBe(existing);
    await handle.shutdown();
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npm test -- tests/orchestrator/bootstrap.test.ts`
Expected: FAIL — `bootstrap` not defined.

- [ ] **Step 3: Create `orchestrator/bootstrap.ts`**

```typescript
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from './db/connection.js';
import { startHookListener, type HookListenerHandle } from './hookListener.js';
import { writeListenerSidecar } from './listenerSidecar.js';
import { HookEventsRepo } from './db/repositories/hookEvents.js';
import { InstancesRepo } from './db/repositories/instances.js';

export interface BootstrapOptions {
  supportDir: string;
  portRange: [number, number];
  onHookEvent?: (event: string, body: unknown, instanceId: string) => Promise<void>;
}

export interface BootstrapHandle {
  db: Database.Database;
  listener: HookListenerHandle;
  shutdown(): Promise<void>;
}

function readOrCreateToken(supportDir: string): string {
  const file = path.join(supportDir, 'hook-token');
  if (existsSync(file)) {
    return readFileSync(file, 'utf8').trim();
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

export async function bootstrap(opts: BootstrapOptions): Promise<BootstrapHandle> {
  const db = openDb(path.join(opts.supportDir, 'data.db'));
  const token = readOrCreateToken(opts.supportDir);
  const hookEvents = new HookEventsRepo(db);
  const instances = new InstancesRepo(db);

  const listener = await startHookListener({
    token,
    portRange: opts.portRange,
    onEvent: async (event, body, instanceId) => {
      hookEvents.append(instanceId, event, body, Date.now());
      if (opts.onHookEvent) {
        await opts.onHookEvent(event, body, instanceId);
      }
    },
  });

  writeListenerSidecar(path.join(opts.supportDir, 'listener.json'), {
    port: listener.port,
    token,
    writtenAt: Date.now(),
  });

  return {
    db,
    listener,
    async shutdown() {
      await listener.stop();
      db.close();
    },
  };
}
```

- [ ] **Step 4: Modify `orchestrator/index.ts` to call bootstrap**

Replace file content with:

```typescript
import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { PortApi, type OrchRequest } from './messagePort.js';
import { bootstrap, type BootstrapHandle } from './bootstrap.js';

let api: PortApi | null = null;
let handle: BootstrapHandle | null = null;

function supportDir(): string {
  const dir = path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
  mkdirSync(dir, { recursive: true });
  return dir;
}

(process as NodeJS.Process).parentPort?.on('message', async (event: { data: { kind: string }; ports?: MessagePort[] }) => {
  if (event.data?.kind === 'init' && event.ports?.[0]) {
    handle = await bootstrap({ supportDir: supportDir(), portRange: [7421, 7430] });
    api = new PortApi(event.ports[0]);
    api.onRequest(async (req: OrchRequest) => {
      switch (req.kind) {
        case 'ping':
          return { now: req.payload.now, orch: Date.now() };
      }
    });
  }
});
```

- [ ] **Step 5: Run tests — confirm bootstrap passes**

Run: `npm test -- tests/orchestrator/bootstrap.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Smoke — launch app and check sidecar appears**

Build and run as in Task 6, Step 8. After launch, in another terminal:
`ls "$HOME/Library/Application Support/Watchtower/"`
Expected: `data.db`, `hook-token`, `listener.json` present. `cat "$HOME/Library/Application Support/Watchtower/listener.json"` shows a port in 7421-7430 + a 64-hex-char token.

- [ ] **Step 7: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/bootstrap.ts orchestrator/index.ts tests/orchestrator/bootstrap.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): bootstrap (DB + listener + token + sidecar)"
```

---

## Phase 5 — PTY management + terminal UI

### Task 15: `ptyManager` — spawn and lifecycle (tested with echo fixture)

**Files:**
- Create: `tests/orchestrator/helpers/echoBin.mjs`
- Create: `orchestrator/ptyManager.ts`
- Create: `tests/orchestrator/ptyManager.test.ts`

- [ ] **Step 1: Create the echo fixture `tests/orchestrator/helpers/echoBin.mjs`**

```javascript
#!/usr/bin/env node
// Reads lines from stdin and echoes them back, prefixing with "> ".
// Exits with code 0 when stdin closes, or with code from argv[2] if first arg is "exit".
if (process.argv[2] === 'exit') {
  const code = Number(process.argv[3] ?? '0');
  process.stdout.write(`exiting with code ${code}\n`);
  process.exit(code);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => process.stdout.write(`> ${chunk}`));
process.stdin.on('end', () => process.exit(0));
```

Make it executable: `chmod +x tests/orchestrator/helpers/echoBin.mjs`.

- [ ] **Step 2: Write failing test `tests/orchestrator/ptyManager.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PtyManager } from '../../orchestrator/ptyManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO = path.resolve(__dirname, 'helpers/echoBin.mjs');

describe('PtyManager', () => {
  it('spawns and pipes I/O', async () => {
    const mgr = new PtyManager();
    const output: string[] = [];
    const onData = (chunk: string) => output.push(chunk);
    const onExit = (_code: number) => {};
    const handle = mgr.spawn({
      id: 'p1',
      command: process.execPath,
      args: [ECHO],
      cwd: process.cwd(),
      env: { ...process.env, WATCHTOWER_INSTANCE_ID: 'p1' },
      onData,
      onExit,
    });
    handle.write('hello\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(output.join('')).toMatch(/> hello/);
    handle.kill();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('reports exit code', async () => {
    const mgr = new PtyManager();
    let exitCode = -1;
    const handle = mgr.spawn({
      id: 'p2',
      command: process.execPath,
      args: [ECHO, 'exit', '3'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      onData: () => {},
      onExit: (code) => { exitCode = code; },
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(exitCode).toBe(3);
    void handle;
  });

  it('lookup by id returns same handle, then nothing after exit', async () => {
    const mgr = new PtyManager();
    const handle = mgr.spawn({
      id: 'p3',
      command: process.execPath,
      args: [ECHO, 'exit', '0'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      onData: () => {},
      onExit: () => {},
    });
    expect(mgr.get('p3')).toBe(handle);
    await new Promise((r) => setTimeout(r, 300));
    expect(mgr.get('p3')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run — confirm it fails**

Run: `npm test -- tests/orchestrator/ptyManager.test.ts`
Expected: FAIL — `PtyManager` not defined.

- [ ] **Step 4: Create `orchestrator/ptyManager.ts`**

```typescript
import * as pty from 'node-pty';

export interface PtySpawnOptions {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols?: number;
  rows?: number;
  onData: (chunk: string) => void;
  onExit: (code: number) => void;
}

export interface PtyHandle {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export class PtyManager {
  private handles = new Map<string, PtyHandle>();

  spawn(opts: PtySpawnOptions): PtyHandle {
    const proc = pty.spawn(opts.command, opts.args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd,
      env: opts.env,
    });

    proc.onData((d) => opts.onData(d));
    proc.onExit(({ exitCode }) => {
      this.handles.delete(opts.id);
      opts.onExit(exitCode);
    });

    const handle: PtyHandle = {
      id: opts.id,
      write: (d) => proc.write(d),
      resize: (cols, rows) => proc.resize(cols, rows),
      kill: (signal) => proc.kill(signal),
    };
    this.handles.set(opts.id, handle);
    return handle;
  }

  get(id: string): PtyHandle | undefined {
    return this.handles.get(id);
  }

  all(): PtyHandle[] {
    return Array.from(this.handles.values());
  }
}
```

- [ ] **Step 5: Run — confirm pass**

Run: `npm test -- tests/orchestrator/ptyManager.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/ptyManager.ts tests/orchestrator/ptyManager.test.ts tests/orchestrator/helpers/echoBin.mjs
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): ptyManager (spawn + lifecycle)"
```

---

### Task 16: Spawn-instance command across processes (renderer → main → orchestrator) and pipe data back

**Files:**
- Modify: `orchestrator/messagePort.ts` (extend `OrchRequest`, `OrchResponse`, `OrchPush`)
- Modify: `shared/ipcContract.ts` (extend `IpcRequest`, `IpcResponse`, `IpcPush`)
- Modify: `orchestrator/index.ts` (handle `spawnInstance`, `ptyWrite`, push `ptyData`/`stateChanged`)
- Modify: `electron/ipc.ts` (route the new kinds)

- [ ] **Step 1: Extend `orchestrator/messagePort.ts` types**

Replace the `OrchRequest`, `OrchResponse`, `OrchPush` types with:

```typescript
export type OrchRequest =
  | { id: string; kind: 'ping'; payload: { now: number } }
  | { id: string; kind: 'spawnInstance'; payload: { cwd: string; args?: string[] } }
  | { id: string; kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { id: string; kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { id: string; kind: 'killInstance'; payload: { instanceId: string } }
  | { id: string; kind: 'listInstances'; payload: Record<string, never> };

export type OrchResponse =
  | { kind: 'ping'; payload: { now: number; orch: number } }
  | { kind: 'spawnInstance'; payload: { instanceId: string } }
  | { kind: 'ptyWrite'; payload: { ok: true } }
  | { kind: 'ptyResize'; payload: { ok: true } }
  | { kind: 'killInstance'; payload: { ok: true } }
  | { kind: 'listInstances'; payload: { instances: Array<{ id: string; cwd: string; status: string; lastActivityAt: number }> } };

export type OrchPush =
  | { kind: 'ptyData'; payload: { instanceId: string; chunk: string } }
  | { kind: 'ptyExit'; payload: { instanceId: string; code: number } }
  | { kind: 'stateChanged'; payload: { instanceId: string; status: string } };
```

- [ ] **Step 2: Extend `shared/ipcContract.ts`**

Replace `IpcRequest`, `IpcResponse`, `IpcPush` with:

```typescript
export type IpcRequest =
  | { kind: 'ping'; payload: { now: number } }
  | { kind: 'spawnInstance'; payload: { cwd: string; args?: string[] } }
  | { kind: 'ptyWrite'; payload: { instanceId: string; data: string } }
  | { kind: 'ptyResize'; payload: { instanceId: string; cols: number; rows: number } }
  | { kind: 'killInstance'; payload: { instanceId: string } }
  | { kind: 'listInstances'; payload: Record<string, never> };

export type IpcResponse =
  | { kind: 'ping'; payload: { now: number; main: number; orch: number } }
  | { kind: 'spawnInstance'; payload: { instanceId: string } }
  | { kind: 'ptyWrite'; payload: { ok: true } }
  | { kind: 'ptyResize'; payload: { ok: true } }
  | { kind: 'killInstance'; payload: { ok: true } }
  | { kind: 'listInstances'; payload: { instances: Array<{ id: string; cwd: string; status: string; lastActivityAt: number }> } };

export type IpcPush =
  | { kind: 'hello'; payload: { version: string } }
  | { kind: 'ptyData'; payload: { instanceId: string; chunk: string } }
  | { kind: 'ptyExit'; payload: { instanceId: string; code: number } }
  | { kind: 'stateChanged'; payload: { instanceId: string; status: string } };
```

- [ ] **Step 3: Replace `orchestrator/index.ts` to handle pty requests**

```typescript
import path from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PortApi, type OrchRequest } from './messagePort.js';
import { bootstrap, type BootstrapHandle } from './bootstrap.js';
import { PtyManager } from './ptyManager.js';
import { InstancesRepo } from './db/repositories/instances.js';
import { transition } from './stateMachine.js';
import type { InstanceStatus } from '../shared/stateModel.js';

let api: PortApi | null = null;
let handle: BootstrapHandle | null = null;
const pty = new PtyManager();

function supportDir(): string {
  const dir = path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function statusOf(id: string): InstanceStatus {
  return (handle!.db.prepare('SELECT status FROM instances WHERE id = ?').get(id) as { status: InstanceStatus } | undefined)?.status ?? 'crashed';
}

(process as NodeJS.Process).parentPort?.on('message', async (event: { data: { kind: string }; ports?: MessagePort[] }) => {
  if (event.data?.kind !== 'init' || !event.ports?.[0]) return;
  handle = await bootstrap({
    supportDir: supportDir(),
    portRange: [7421, 7430],
    onHookEvent: async (eventName, _body, instanceId) => {
      const repo = new InstancesRepo(handle!.db);
      const inst = repo.get(instanceId);
      if (!inst) return;
      const event = mapHookEventToStateEvent(eventName, _body);
      if (!event) return;
      const result = transition(inst.status, event);
      if (result.state !== inst.status) {
        repo.updateStatus(instanceId, result.state, Date.now());
        api?.push({ kind: 'stateChanged', payload: { instanceId, status: result.state } });
      }
      for (const out of result.outputs) {
        if (out.kind === 'storeClaudeSessionId') {
          repo.setClaudeSessionId(instanceId, out.sessionId);
        }
      }
    },
  });
  api = new PortApi(event.ports[0]);
  api.onRequest(async (req: OrchRequest) => handleRequest(req));
});

function mapHookEventToStateEvent(name: string, body: unknown): import('../shared/events.js').StateEvent | null {
  const b = body as { session_id?: string };
  switch (name) {
    case 'SessionStart': return { kind: 'sessionStart', sessionId: b.session_id ?? '' };
    case 'UserPromptSubmit': return { kind: 'userPromptSubmit' };
    case 'Notification': return { kind: 'notificationHook' };
    case 'Stop': return { kind: 'stopHook' };
    case 'SessionEnd': return { kind: 'sessionEnd' };
    default: return null;
  }
}

async function handleRequest(req: OrchRequest): Promise<unknown> {
  switch (req.kind) {
    case 'ping':
      return { now: req.payload.now, orch: Date.now() };

    case 'spawnInstance': {
      const id = randomUUID();
      const now = Date.now();
      const repo = new InstancesRepo(handle!.db);
      repo.insert({
        id,
        cwd: req.payload.cwd,
        status: 'spawning',
        claudeSessionId: id,
        spawnedAt: now,
        lastActivityAt: now,
        exitCode: null,
        terminationReason: null,
        resumedFromInstanceId: null,
        jiraKeyHint: null,
        argsJson: req.payload.args ? JSON.stringify(req.payload.args) : null,
      });
      pty.spawn({
        id,
        command: 'claude',
        args: ['--session-id', id, ...(req.payload.args ?? [])],
        cwd: req.payload.cwd,
        env: { ...(process.env as Record<string, string>), WATCHTOWER_INSTANCE_ID: id },
        onData: (chunk) => {
          api?.push({ kind: 'ptyData', payload: { instanceId: id, chunk } });
          const result = transition(statusOf(id), { kind: 'ptyData' });
          if (result.state !== statusOf(id)) {
            new InstancesRepo(handle!.db).updateStatus(id, result.state, Date.now());
            api?.push({ kind: 'stateChanged', payload: { instanceId: id, status: result.state } });
          }
        },
        onExit: (code) => {
          api?.push({ kind: 'ptyExit', payload: { instanceId: id, code } });
          const repo = new InstancesRepo(handle!.db);
          const inst = repo.get(id);
          if (inst) {
            const result = transition(inst.status, { kind: 'ptyExit', code });
            repo.updateStatus(id, result.state, Date.now());
            repo.setTermination(id, code === 0 ? 'session-end' : 'crash', code);
            api?.push({ kind: 'stateChanged', payload: { instanceId: id, status: result.state } });
          }
        },
      });
      return { instanceId: id };
    }

    case 'ptyWrite': {
      pty.get(req.payload.instanceId)?.write(req.payload.data);
      return { ok: true };
    }

    case 'ptyResize': {
      pty.get(req.payload.instanceId)?.resize(req.payload.cols, req.payload.rows);
      return { ok: true };
    }

    case 'killInstance': {
      pty.get(req.payload.instanceId)?.kill();
      return { ok: true };
    }

    case 'listInstances': {
      const rows = new InstancesRepo(handle!.db).listAll();
      return {
        instances: rows.map((r) => ({ id: r.id, cwd: r.cwd, status: r.status, lastActivityAt: r.lastActivityAt })),
      };
    }
  }
}
```

- [ ] **Step 4: Modify `electron/ipc.ts` to forward all new kinds + push events**

Replace the body of `registerIpc()` with:

```typescript
  ipcMain.handle('watchtower:invoke', async (_event, kind: IpcRequest['kind'], payload: unknown) => {
    if (kind === 'ping') {
      const { now } = payload as { now: number };
      const res = await getOrchestrator().invoke('ping', { now });
      return { now, main: Date.now(), orch: res.orch };
    }
    const orch = getOrchestrator();
    return orch.invoke(kind as never, payload as never);
  });
```

And add at the bottom of `registerIpc()`:

```typescript
  const orch = getOrchestrator();
  for (const k of ['ptyData', 'ptyExit', 'stateChanged'] as const) {
    orch.push = orch.push; // no-op; we wire via onPush below
  }
  // wire orchestrator pushes into the renderer
  (orch as unknown as { onPush(cb: (msg: { kind: string; payload: unknown }) => void): void }).onPush?.((msg) => {
    pushToRenderer(msg.kind, msg.payload);
  });
```

You'll need to add an `onPush` registration mechanism to `PortApi`. Extend `PortApi` in `orchestrator/messagePort.ts`:

```typescript
  private pushHandler: ((msg: OrchPush) => void) | null = null;

  onPush(handler: (msg: OrchPush) => void): void {
    this.pushHandler = handler;
  }
```

And in its `handle()` method, add:

```typescript
    if (!('id' in (msg as object))) {
      this.pushHandler?.(msg as OrchPush);
      return;
    }
```

(right after the `_response` block, before the request-handler branch.)

- [ ] **Step 5: Build, run, smoke**

Run: `npm run build:main && npm run build:orch && WATCHTOWER_DEV_URL=http://localhost:5173 electron .`
Then in the renderer DevTools console (Cmd+Opt+I): `await window.watchtower.invoke('listInstances', {})`
Expected: `{ instances: [] }`. Confirms full chain works.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/ electron/ shared/
git -C /Users/jan/Projects/Watchtower commit -m "feat: cross-process pty spawn/write/resize + push events"
```

---

### Task 17: xterm.js Terminal component in renderer

**Files:**
- Create: `client/src/components/Terminal.tsx`

- [ ] **Step 1: Create `client/src/components/Terminal.tsx`**

```typescript
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Box } from '@mui/material';

interface Props {
  instanceId: string;
  active: boolean;
}

export function Terminal({ instanceId, active }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontFamily: 'Menlo, Monaco, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0e0f12', foreground: '#e5e7eb' },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    const offData = window.watchtower.on('ptyData', (p) => {
      if (p.instanceId === instanceId) term.write(p.chunk);
    });

    const onUserInput = term.onData((data) => {
      void window.watchtower.invoke('ptyWrite', { instanceId, data });
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      void window.watchtower.invoke('ptyResize', { instanceId, cols: term.cols, rows: term.rows });
    });
    ro.observe(containerRef.current);

    return () => {
      offData();
      onUserInput.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [instanceId]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return (
    <Box
      ref={containerRef}
      sx={{
        display: active ? 'block' : 'none',
        width: '100%',
        height: '100%',
        backgroundColor: '#0e0f12',
      }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/src/components/Terminal.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): xterm.js Terminal component"
```

---

### Task 18: TabStrip + `useInstances` hook wiring

**Files:**
- Create: `client/src/state/useInstances.ts`
- Create: `client/src/components/TabStrip.tsx`
- Modify: `client/src/App.tsx` (render TabStrip + active Terminal)

- [ ] **Step 1: Create `client/src/state/useInstances.ts`**

```typescript
import { useEffect, useState, useCallback } from 'react';

export interface InstanceView {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
}

export function useInstances(): {
  instances: InstanceView[];
  activeId: string | null;
  setActive(id: string): void;
  spawn(cwd: string): Promise<string>;
  refresh(): Promise<void>;
} {
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await window.watchtower.invoke('listInstances', {});
    setInstances(res.instances);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.watchtower.on('stateChanged', () => { void refresh(); });
    const offExit = window.watchtower.on('ptyExit', () => { void refresh(); });
    return () => { off(); offExit(); };
  }, [refresh]);

  const spawn = useCallback(async (cwd: string) => {
    const res = await window.watchtower.invoke('spawnInstance', { cwd });
    setActiveId(res.instanceId);
    await refresh();
    return res.instanceId;
  }, [refresh]);

  return { instances, activeId, setActive: setActiveId, spawn, refresh };
}
```

- [ ] **Step 2: Create `client/src/components/TabStrip.tsx`**

```typescript
import { Box, IconButton, Tab, Tabs, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import path from 'path-browserify';
import type { InstanceView } from '../state/useInstances.js';

function statusColor(status: string): string {
  switch (status) {
    case 'waiting-permission': return '#ef5350';
    case 'waiting-input': return '#ffb74d';
    case 'idle-notify': return '#9e9e9e';
    case 'working': return '#7aa7ff';
    case 'finished': return '#66bb6a';
    case 'crashed': return '#ef5350';
    default: return '#666';
  }
}

interface Props {
  instances: InstanceView[];
  activeId: string | null;
  onSelect(id: string): void;
  onNew(): void;
}

export function TabStrip({ instances, activeId, onSelect, onNew }: Props) {
  const tabs = [{ id: '__dashboard__', label: 'Dashboard', status: 'dashboard' as const }, ...instances.map((i) => ({ id: i.id, label: path.basename(i.cwd) || i.cwd, status: i.status }))];
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', backgroundColor: 'background.paper' }}>
      <Tabs value={activeId ?? '__dashboard__'} onChange={(_e, v) => onSelect(v)} variant="scrollable" scrollButtons="auto">
        {tabs.map((t) => (
          <Tab
            key={t.id}
            value={t.id}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {t.status !== 'dashboard' && (
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: statusColor(t.status) }} />
                )}
                {t.label}
              </Box>
            }
          />
        ))}
      </Tabs>
      <Tooltip title="New instance">
        <IconButton onClick={onNew} size="small" sx={{ ml: 1, mr: 1 }}><AddIcon /></IconButton>
      </Tooltip>
    </Box>
  );
}
```

Add `path-browserify` to dependencies first: `npm i path-browserify @types/path-browserify`.

- [ ] **Step 3: Modify `client/src/App.tsx` to render TabStrip + active Terminal**

```typescript
import { useState } from 'react';
import { CssBaseline, ThemeProvider, Box } from '@mui/material';
import { watchtowerTheme } from './theme.js';
import { useInstances } from './state/useInstances.js';
import { TabStrip } from './components/TabStrip.js';
import { Terminal } from './components/Terminal.js';
import type { WatchtowerBridge } from '../../shared/ipcContract.js';

declare global {
  interface Window { watchtower: WatchtowerBridge; }
}

export function App() {
  const { instances, activeId, setActive, spawn } = useInstances();
  const [defaultCwd] = useState<string>(process.env.HOME ?? '~');

  const handleNew = async () => {
    const cwd = window.prompt('Working directory?', defaultCwd);
    if (cwd) await spawn(cwd);
  };

  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TabStrip instances={instances} activeId={activeId} onSelect={setActive} onNew={handleNew} />
        <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeId === null || activeId === '__dashboard__' ? (
            <Box sx={{ p: 4 }}>Dashboard placeholder. {instances.length} instance(s).</Box>
          ) : (
            instances.map((i) => (
              <Box key={i.id} sx={{ position: 'absolute', inset: 0, display: i.id === activeId ? 'block' : 'none' }}>
                <Terminal instanceId={i.id} active={i.id === activeId} />
              </Box>
            ))
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Build, run, smoke**

`npm run dev:renderer` in one terminal; `npm run build:main && npm run build:orch && WATCHTOWER_DEV_URL=http://localhost:5173 electron .` in another. Click `+`, accept the prompt, watch a `claude` instance start in a new tab. Type to it; output appears.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/ package.json package-lock.json
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): TabStrip + useInstances + active Terminal rendering"
```

---

## Phase 6 — Spawn flow polish + module rail + dashboard tab

### Task 19: `NewInstanceModal` with recent directory list + native folder picker

**Files:**
- Modify: `electron/ipc.ts` (add `chooseDirectory` IPC handler using `dialog.showOpenDialog`)
- Modify: `shared/ipcContract.ts` (add `chooseDirectory` to request/response)
- Create: `client/src/components/NewInstanceModal.tsx`
- Modify: `client/src/App.tsx` (replace `window.prompt` with the modal)

- [ ] **Step 1: Extend `shared/ipcContract.ts`**

Add to `IpcRequest`:

```typescript
  | { kind: 'chooseDirectory'; payload: { defaultPath?: string } }
```

Add to `IpcResponse`:

```typescript
  | { kind: 'chooseDirectory'; payload: { path: string | null } }
```

- [ ] **Step 2: Modify `electron/ipc.ts`**

Add an `import { dialog } from 'electron';` and a branch in the invoke handler:

```typescript
    if (kind === 'chooseDirectory') {
      const { defaultPath } = payload as { defaultPath?: string };
      const win = getMainWindow();
      const res = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory'],
        defaultPath,
      });
      return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
    }
```

Add `import { getMainWindow } from './window.js';` at the top.

- [ ] **Step 3: Create `client/src/components/NewInstanceModal.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack, List, ListItemButton, ListItemText, Typography } from '@mui/material';

const RECENT_KEY = 'watchtower.recent-cwds';

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}

function pushRecent(cwd: string): void {
  const list = readRecent().filter((c) => c !== cwd);
  list.unshift(cwd);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
}

interface Props {
  open: boolean;
  defaultCwd: string;
  onClose(): void;
  onSpawn(cwd: string): void;
}

export function NewInstanceModal({ open, defaultCwd, onClose, onSpawn }: Props) {
  const [cwd, setCwd] = useState(defaultCwd);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setCwd(defaultCwd);
      setRecent(readRecent());
    }
  }, [open, defaultCwd]);

  const browse = async () => {
    const res = await window.watchtower.invoke('chooseDirectory', { defaultPath: cwd });
    if (res.path) setCwd(res.path);
  };

  const submit = () => {
    if (!cwd.trim()) return;
    pushRecent(cwd);
    onSpawn(cwd);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New Claude Code instance</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              label="Working directory"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              autoFocus
              size="small"
            />
            <Button onClick={browse} variant="outlined">Browse…</Button>
          </Stack>
          {recent.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary">Recent</Typography>
              <List dense sx={{ maxHeight: 220, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                {recent.map((r) => (
                  <ListItemButton key={r} onClick={() => setCwd(r)}>
                    <ListItemText primary={r} primaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }} />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={submit} variant="contained">Spawn</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 4: Modify `client/src/App.tsx` to use the modal**

Replace the `handleNew` logic:

```typescript
import { NewInstanceModal } from './components/NewInstanceModal.js';
// ...
const [modalOpen, setModalOpen] = useState(false);
// ...
        <TabStrip instances={instances} activeId={activeId} onSelect={setActive} onNew={() => setModalOpen(true)} />
        <NewInstanceModal
          open={modalOpen}
          defaultCwd={defaultCwd}
          onClose={() => setModalOpen(false)}
          onSpawn={(cwd) => void spawn(cwd)}
        />
```

- [ ] **Step 5: Build, run, verify**

Click `+`, see the modal, browse to a directory, click Spawn. A new tab appears with `claude` running.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add electron/ipc.ts shared/ipcContract.ts client/src/components/NewInstanceModal.tsx client/src/App.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): NewInstanceModal with browse + recent cwds"
```

---

### Task 20: `ModuleRail` — left activity bar

**Files:**
- Create: `client/src/components/ModuleRail.tsx`
- Modify: `client/src/App.tsx` (wrap content in rail layout, manage `activeModule` state)

- [ ] **Step 1: Create `client/src/components/ModuleRail.tsx`**

```typescript
import { Box, IconButton, Tooltip } from '@mui/material';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import TerminalIcon from '@mui/icons-material/Terminal';
import TimerIcon from '@mui/icons-material/Timer';
import SettingsIcon from '@mui/icons-material/Settings';

export type ModuleId = 'dashboard' | 'instances' | 'timetracker' | 'settings';

interface Props {
  active: ModuleId;
  onSelect(id: ModuleId): void;
}

const ITEMS: Array<{ id: ModuleId; label: string; icon: React.ReactNode; enabled: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon />, enabled: false },
  { id: 'instances', label: 'Instances', icon: <TerminalIcon />, enabled: true },
  { id: 'timetracker', label: 'TimeTracker', icon: <TimerIcon />, enabled: false },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon />, enabled: false },
];

export function ModuleRail({ active, onSelect }: Props) {
  return (
    <Box sx={{ width: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 0.5, backgroundColor: 'background.paper', borderRight: 1, borderColor: 'divider' }}>
      {ITEMS.map((item) => (
        <Tooltip key={item.id} title={item.enabled ? item.label : `${item.label} (coming soon)`} placement="right">
          <span>
            <IconButton
              disabled={!item.enabled}
              onClick={() => onSelect(item.id)}
              color={active === item.id ? 'primary' : 'default'}
              sx={{ width: 40, height: 40 }}
            >
              {item.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Modify `client/src/App.tsx` to use the rail**

```typescript
import { useState } from 'react';
import { CssBaseline, ThemeProvider, Box } from '@mui/material';
import { watchtowerTheme } from './theme.js';
import { useInstances } from './state/useInstances.js';
import { TabStrip } from './components/TabStrip.js';
import { Terminal } from './components/Terminal.js';
import { NewInstanceModal } from './components/NewInstanceModal.js';
import { ModuleRail, type ModuleId } from './components/ModuleRail.js';
import type { WatchtowerBridge } from '../../shared/ipcContract.js';

declare global {
  interface Window { watchtower: WatchtowerBridge; }
}

export function App() {
  const { instances, activeId, setActive, spawn } = useInstances();
  const [defaultCwd] = useState<string>(process.env.HOME ?? '~');
  const [modalOpen, setModalOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<ModuleId>('instances');

  return (
    <ThemeProvider theme={watchtowerTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh' }}>
        <ModuleRail active={activeModule} onSelect={setActiveModule} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {activeModule === 'instances' && (
            <>
              <TabStrip instances={instances} activeId={activeId} onSelect={setActive} onNew={() => setModalOpen(true)} />
              <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {activeId === null || activeId === '__dashboard__' ? (
                  <Box sx={{ p: 4 }}>Dashboard placeholder. {instances.length} instance(s).</Box>
                ) : (
                  instances.map((i) => (
                    <Box key={i.id} sx={{ position: 'absolute', inset: 0, display: i.id === activeId ? 'block' : 'none' }}>
                      <Terminal instanceId={i.id} active={i.id === activeId} />
                    </Box>
                  ))
                )}
              </Box>
            </>
          )}
        </Box>
        <NewInstanceModal
          open={modalOpen}
          defaultCwd={defaultCwd}
          onClose={() => setModalOpen(false)}
          onSpawn={(cwd) => void spawn(cwd)}
        />
      </Box>
    </ThemeProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/src/components/ModuleRail.tsx client/src/App.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): ModuleRail (Instances active, others stubbed)"
```

---

### Task 21: `DashboardTab` inside Instances module

**Files:**
- Create: `client/src/components/DashboardTab.tsx`
- Modify: `client/src/App.tsx` (render DashboardTab when `activeId === '__dashboard__'`)

- [ ] **Step 1: Create `client/src/components/DashboardTab.tsx`**

```typescript
import { Box, Typography, Stack, Chip, Button, Paper } from '@mui/material';
import path from 'path-browserify';
import type { InstanceView } from '../state/useInstances.js';

function chipColor(status: string): 'default' | 'error' | 'warning' | 'success' | 'info' {
  switch (status) {
    case 'waiting-permission': case 'crashed': return 'error';
    case 'waiting-input': return 'warning';
    case 'idle-notify': return 'default';
    case 'finished': return 'success';
    default: return 'info';
  }
}

interface Props {
  instances: InstanceView[];
  onOpen(id: string): void;
  onKill(id: string): Promise<void>;
  onNew(): void;
}

export function DashboardTab({ instances, onOpen, onKill, onNew }: Props) {
  const live = instances.filter((i) => !['finished', 'crashed', 'suspended'].includes(i.status));
  const waiting = live.filter((i) => ['waiting-permission', 'waiting-input', 'idle-notify'].includes(i.status));
  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Stack>
          <Typography variant="h5">Watchtower</Typography>
          <Typography variant="body2" color="text.secondary">
            {live.length} running · {waiting.length} waiting
          </Typography>
        </Stack>
        <Button variant="contained" onClick={onNew}>New instance</Button>
      </Stack>
      <Stack spacing={1}>
        {instances.length === 0 && (
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">No instances yet. Click "New instance" to start.</Typography>
          </Paper>
        )}
        {instances.map((i) => (
          <Paper key={i.id} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Chip size="small" label={i.status} color={chipColor(i.status)} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontFamily: 'monospace', fontSize: 13 }}>{path.basename(i.cwd) || i.cwd}</Typography>
              <Typography variant="caption" color="text.secondary">{i.cwd}</Typography>
            </Box>
            <Button size="small" onClick={() => onOpen(i.id)} disabled={['finished', 'crashed', 'suspended'].includes(i.status)}>Open</Button>
            <Button size="small" color="error" onClick={() => void onKill(i.id)} disabled={['finished', 'crashed'].includes(i.status)}>Kill</Button>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: Modify `client/src/App.tsx`**

Replace the dashboard placeholder branch:

```typescript
            {activeId === null || activeId === '__dashboard__' ? (
              <DashboardTab
                instances={instances}
                onOpen={(id) => setActive(id)}
                onKill={async (id) => { await window.watchtower.invoke('killInstance', { instanceId: id }); }}
                onNew={() => setModalOpen(true)}
              />
            ) : (...)
```

Add the import at the top: `import { DashboardTab } from './components/DashboardTab.js';`.

- [ ] **Step 3: Build, run, verify**

App now opens with Dashboard. Spawn 2 instances. Kill one. Switch tabs. Dashboard counts and chips update live.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/src/components/DashboardTab.tsx client/src/App.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): DashboardTab inside Instances module"
```

---

## Phase 7 — Tray + macOS notifications + quiet timer + snooze

### Task 22: Quiet timer manager in orchestrator (per-instance timers)

**Files:**
- Create: `orchestrator/quietTimers.ts`
- Modify: `orchestrator/index.ts` (start/clear timers based on state machine outputs)

- [ ] **Step 1: Create `orchestrator/quietTimers.ts`**

```typescript
export class QuietTimers {
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private durationMs: number, private fire: (instanceId: string) => void) {}

  start(instanceId: string): void {
    this.clear(instanceId);
    const t = setTimeout(() => {
      this.timers.delete(instanceId);
      this.fire(instanceId);
    }, this.durationMs);
    this.timers.set(instanceId, t);
  }

  clear(instanceId: string): void {
    const existing = this.timers.get(instanceId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(instanceId);
    }
  }

  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
```

- [ ] **Step 2: Modify `orchestrator/index.ts` to wire QuietTimers into hook + pty paths**

Near the top, after imports, add:

```typescript
import { QuietTimers } from './quietTimers.js';

const QUIET_MS = 90_000;
const quietTimers = new QuietTimers(QUIET_MS, (instanceId) => {
  const repo = new InstancesRepo(handle!.db);
  const inst = repo.get(instanceId);
  if (!inst) return;
  const result = transition(inst.status, { kind: 'quietTimerFired' });
  if (result.state !== inst.status) {
    repo.updateStatus(instanceId, result.state, Date.now());
    api?.push({ kind: 'stateChanged', payload: { instanceId, status: result.state } });
  }
});
```

In the `onHookEvent` callback (replace the existing implementation), iterate the state machine outputs and act on `startQuietTimer` / `clearQuietTimer`:

```typescript
    onHookEvent: async (eventName, body, instanceId) => {
      const repo = new InstancesRepo(handle!.db);
      const inst = repo.get(instanceId);
      if (!inst) return;
      const event = mapHookEventToStateEvent(eventName, body);
      if (!event) return;
      const result = transition(inst.status, event);
      if (result.state !== inst.status) {
        repo.updateStatus(instanceId, result.state, Date.now());
        api?.push({ kind: 'stateChanged', payload: { instanceId, status: result.state } });
      }
      for (const out of result.outputs) {
        if (out.kind === 'storeClaudeSessionId') repo.setClaudeSessionId(instanceId, out.sessionId);
        if (out.kind === 'startQuietTimer') quietTimers.start(instanceId);
        if (out.kind === 'clearQuietTimer') quietTimers.clear(instanceId);
      }
    },
```

Also in pty `onData`, `onExit`, and `killInstance` paths, call `quietTimers.clear(id)` on exit/kill to avoid orphan timers.

- [ ] **Step 3: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/quietTimers.ts orchestrator/index.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): quiet timer for waiting-input → idle-notify transition"
```

---

### Task 23: Notification engine — apply `decide()` and emit `notify` push events

**Files:**
- Create: `orchestrator/notifier.ts`
- Modify: `orchestrator/index.ts` (use Notifier for state changes)
- Modify: `orchestrator/messagePort.ts` (add `notify` and `focusChanged` types)
- Modify: `shared/ipcContract.ts` (add `notify` push, `focusChanged` invoke)

- [ ] **Step 1: Create `orchestrator/notifier.ts`**

```typescript
import { decide, type RuleContext } from './notificationRules.js';
import type { InstanceStatus } from '../shared/stateModel.js';

export interface NotifierEmitters {
  notify(payload: { instanceId: string; kind: 'waiting-permission' | 'idle-notify' }): void;
  clearAttention(instanceId: string): void;
  setBadge(count: number): void;
}

export class Notifier {
  private focused = new Set<string>();
  private snoozedUntil = new Map<string, number>();
  private flagged = new Set<string>();

  constructor(private emit: NotifierEmitters) {}

  setFocused(instanceId: string | null): void {
    this.focused.clear();
    if (instanceId) this.focused.add(instanceId);
  }

  snooze(instanceId: string, untilMs: number): void {
    this.snoozedUntil.set(instanceId, untilMs);
  }

  snoozeAll(untilMs: number): void {
    this.snoozedUntil.set('*', untilMs);
  }

  apply(instanceId: string, prev: InstanceStatus, next: InstanceStatus, now: number): void {
    const ctx: RuleContext = {
      focused: this.focused.has(instanceId),
      snoozedUntil: Math.max(this.snoozedUntil.get(instanceId) ?? 0, this.snoozedUntil.get('*') ?? 0),
    };
    const action = decide(prev, next, ctx, now);
    if (action.notify) {
      this.flagged.add(instanceId);
      this.emit.notify({ instanceId, kind: action.notify.kind });
    }
    if (action.clearAttention) {
      this.flagged.delete(instanceId);
      this.emit.clearAttention(instanceId);
    }
    this.emit.setBadge(this.flagged.size);
  }
}
```

- [ ] **Step 2: Extend `orchestrator/messagePort.ts`**

Add to `OrchRequest`:

```typescript
  | { id: string; kind: 'focusChanged'; payload: { instanceId: string | null } }
  | { id: string; kind: 'snooze'; payload: { instanceId: string | '*'; untilMs: number } }
```

Add corresponding `OrchResponse` variants returning `{ ok: true }`.

Add to `OrchPush`:

```typescript
  | { kind: 'notify'; payload: { instanceId: string; kind: 'waiting-permission' | 'idle-notify' } }
  | { kind: 'clearAttention'; payload: { instanceId: string } }
  | { kind: 'badge'; payload: { count: number } }
```

- [ ] **Step 3: Mirror the additions in `shared/ipcContract.ts`** (`IpcRequest`, `IpcResponse`, `IpcPush`).

- [ ] **Step 4: Modify `orchestrator/index.ts` to use `Notifier`**

At the top:

```typescript
import { Notifier } from './notifier.js';

const notifier = new Notifier({
  notify: (p) => api?.push({ kind: 'notify', payload: p }),
  clearAttention: (instanceId) => api?.push({ kind: 'clearAttention', payload: { instanceId } }),
  setBadge: (count) => api?.push({ kind: 'badge', payload: { count } }),
});
```

In every place we currently do `api?.push({ kind: 'stateChanged', ... })` after a state change, also call `notifier.apply(instanceId, prevStatus, result.state, Date.now())` (you'll need to capture `prevStatus = inst.status` *before* calling `updateStatus`).

Add to `handleRequest`:

```typescript
    case 'focusChanged':
      notifier.setFocused(req.payload.instanceId);
      return { ok: true };
    case 'snooze':
      if (req.payload.instanceId === '*') notifier.snoozeAll(req.payload.untilMs);
      else notifier.snooze(req.payload.instanceId, req.payload.untilMs);
      return { ok: true };
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/ shared/
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): Notifier glue (state changes → notify/badge events)"
```

---

### Task 24: macOS native notifications in Electron main

**Files:**
- Create: `electron/notifications.ts`
- Modify: `electron/main.ts` (subscribe to orchestrator `notify` pushes; show window on click)

- [ ] **Step 1: Create `electron/notifications.ts`**

```typescript
import { Notification, app } from 'electron';
import { getMainWindow, createMainWindow } from './window.js';

export function fireNotification(opts: {
  instanceId: string;
  kind: 'waiting-permission' | 'idle-notify';
  cwdBasename: string;
  onClick(): void;
}): void {
  if (!Notification.isSupported()) return;
  const body = opts.kind === 'waiting-permission'
    ? `Claude in ${opts.cwdBasename} needs permission`
    : `Claude in ${opts.cwdBasename} is waiting`;
  const n = new Notification({
    title: app.getName(),
    body,
    silent: false,
  });
  n.on('click', () => {
    const win = getMainWindow() ?? createMainWindow();
    win.show();
    win.focus();
    opts.onClick();
  });
  n.show();
}
```

- [ ] **Step 2: Modify `electron/main.ts`**

After `startOrchestrator()`, register a push listener:

```typescript
import { fireNotification } from './notifications.js';
import { Tray, Menu, nativeImage } from 'electron';
// ...
const orch = startOrchestrator();
orch.onPush((msg) => {
  if (msg.kind === 'notify') {
    const cwdBasename = msg.payload.instanceId.slice(0, 8); // upgraded in next task with real cwd
    fireNotification({
      instanceId: msg.payload.instanceId,
      kind: msg.payload.kind,
      cwdBasename,
      onClick: () => pushToRenderer('activateInstance', { instanceId: msg.payload.instanceId }),
    });
  }
  pushToRenderer(msg.kind, msg.payload);
});
```

Add an `activateInstance` push and a corresponding `ipcContract.ts` entry; in the renderer, listen for it and `setActive(payload.instanceId)`.

- [ ] **Step 3: Verify (manual)**

Spawn a `claude` in a scratch dir, ask it something that triggers a permission prompt, click away from the window. A macOS notification should appear after a moment. Clicking it should focus the window on the right tab.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add electron/notifications.ts electron/main.ts shared/ipcContract.ts client/
git -C /Users/jan/Projects/Watchtower commit -m "feat: macOS notifications fire on attention events"
```

---

### Task 25: Tray icon + menu + badge

**Files:**
- Create: `build-resources/tray-template.png` (16×16 + @2x; macOS template image)
- Create: `electron/tray.ts`
- Modify: `electron/main.ts` (start tray on `whenReady`)

- [ ] **Step 1: Add `build-resources/tray-template.png`**

Create the directory and add a 16×16 black-on-transparent PNG (and a 32×32 `tray-template@2x.png`). For an MVP placeholder, use a simple watchtower glyph or even a filled circle.

```bash
mkdir -p /Users/jan/Projects/Watchtower/build-resources
# Drop tray-template.png and tray-template@2x.png into build-resources/
```

- [ ] **Step 2: Create `electron/tray.ts`**

```typescript
import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMainWindow, createMainWindow, toggleMainWindow } from './window.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let badgeCount = 0;

export interface TrayInstanceEntry {
  id: string;
  label: string;
  status: string;
}

let entries: TrayInstanceEntry[] = [];

function buildMenu(onSelect: (id: string) => void, onSnooze: (ms: number) => void, onQuit: () => void): Menu {
  const liveCount = entries.length;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: `${liveCount} running · ${badgeCount} waiting`, enabled: false },
    { type: 'separator' },
    ...entries.map<Electron.MenuItemConstructorOptions>((e) => ({
      label: `${e.label} — ${e.status}`,
      click: () => onSelect(e.id),
    })),
    { type: 'separator' },
    {
      label: 'Snooze all',
      submenu: [
        { label: '5 minutes', click: () => onSnooze(5 * 60_000) },
        { label: '30 minutes', click: () => onSnooze(30 * 60_000) },
        { label: '1 hour', click: () => onSnooze(60 * 60_000) },
      ],
    },
    { label: 'Show Watchtower', click: () => createMainWindow().show() },
    { type: 'separator' },
    { label: badgeCount > 0 || liveCount > 0 ? `Quit (suspend ${liveCount} sessions)` : 'Quit Watchtower', click: onQuit },
  ];
  return Menu.buildFromTemplate(items);
}

export function startTray(opts: {
  onSelect: (id: string) => void;
  onSnoozeAll: (ms: number) => void;
  onQuit: () => void;
}): void {
  const iconPath = path.join(__dirname, '../build-resources/tray-template.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Watchtower');
  tray.on('click', () => toggleMainWindow());
  tray.setContextMenu(buildMenu(opts.onSelect, opts.onSnoozeAll, opts.onQuit));
}

export function setBadge(count: number): void {
  badgeCount = count;
  if (!tray) return;
  tray.setTitle(count > 0 ? ` ${count}` : '');
  app.dock?.setBadge(count > 0 ? String(count) : '');
}

export function setEntries(next: TrayInstanceEntry[]): void {
  entries = next;
}

export function rebuildMenu(opts: {
  onSelect: (id: string) => void;
  onSnoozeAll: (ms: number) => void;
  onQuit: () => void;
}): void {
  if (!tray) return;
  tray.setContextMenu(buildMenu(opts.onSelect, opts.onSnoozeAll, opts.onQuit));
}
```

- [ ] **Step 3: Modify `electron/main.ts` to start the tray**

```typescript
import { startTray, setBadge, setEntries, rebuildMenu } from './tray.js';
import path from 'node:path';

async function refreshTrayFromOrchestrator(orch: ReturnType<typeof startOrchestrator>): Promise<void> {
  const res = await orch.invoke('listInstances', {});
  setEntries(res.instances.map((i) => ({ id: i.id, label: path.basename(i.cwd) || i.cwd, status: i.status })));
  rebuildMenuWithCallbacks(orch);
}

function rebuildMenuWithCallbacks(orch: ReturnType<typeof startOrchestrator>): void {
  rebuildMenu({
    onSelect: (id) => pushToRenderer('activateInstance', { instanceId: id }),
    onSnoozeAll: (ms) => void orch.invoke('snooze', { instanceId: '*', untilMs: Date.now() + ms }),
    onQuit: () => app.quit(),
  });
}

app.whenReady().then(async () => {
  const orch = startOrchestrator();
  registerIpc();
  const win = createMainWindow();
  startTray({
    onSelect: (id) => pushToRenderer('activateInstance', { instanceId: id }),
    onSnoozeAll: (ms) => void orch.invoke('snooze', { instanceId: '*', untilMs: Date.now() + ms }),
    onQuit: () => app.quit(),
  });

  orch.onPush((msg) => {
    pushToRenderer(msg.kind, msg.payload);
    if (msg.kind === 'badge') setBadge(msg.payload.count);
    if (msg.kind === 'stateChanged' || msg.kind === 'ptyExit') void refreshTrayFromOrchestrator(orch);
    if (msg.kind === 'notify') {
      const entry = lookupEntry(msg.payload.instanceId);
      fireNotification({
        instanceId: msg.payload.instanceId,
        kind: msg.payload.kind,
        cwdBasename: entry?.label ?? msg.payload.instanceId.slice(0, 8),
        onClick: () => pushToRenderer('activateInstance', { instanceId: msg.payload.instanceId }),
      });
    }
  });

  await refreshTrayFromOrchestrator(orch);
  win.webContents.once('did-finish-load', () => pushToRenderer('hello', { version: app.getVersion() }));
});

function lookupEntry(_id: string): { label: string } | null {
  // populated by setEntries; for MVP, the closure in tray.ts holds them. Expose a getter if needed.
  return null;
}
```

- [ ] **Step 4: Manual verify**

Launch the app. The tray icon appears in the menu bar. Right-click shows running instances + Snooze + Show + Quit. Spawn instances → the running count updates.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add build-resources/tray-template.png build-resources/tray-template@2x.png electron/tray.ts electron/main.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat: tray icon + menu + badge counter"
```

---

### Task 26: Renderer-side focus tracking and snooze controls

**Files:**
- Modify: `client/src/App.tsx` (notify orchestrator on tab focus changes; listen for `activateInstance`)
- Modify: `client/src/components/TabStrip.tsx` (right-click context menu with Kill + Snooze)

- [ ] **Step 1: In `client/src/App.tsx`, emit `focusChanged` whenever `activeId` changes**

Add an effect:

```typescript
useEffect(() => {
  const id = activeId && activeId !== '__dashboard__' ? activeId : null;
  void window.watchtower.invoke('focusChanged', { instanceId: id });
}, [activeId]);

useEffect(() => {
  const off = window.watchtower.on('activateInstance', (p) => {
    setActiveModule('instances');
    setActive(p.instanceId);
  });
  return off;
}, [setActive]);
```

(`activateInstance` push payload was added in Task 24 — its type in `IpcPush` is `{ kind: 'activateInstance'; payload: { instanceId: string } }`.)

- [ ] **Step 2: Add right-click context menu to `TabStrip` tabs**

Wrap each `Tab`'s `label` in an `onContextMenu` handler that opens an MUI `Menu` with: Open, Kill, Snooze 5m / 30m / 1h. The Snooze action calls `window.watchtower.invoke('snooze', { instanceId: id, untilMs: Date.now() + ms })`.

```typescript
// Skeleton inside TabStrip — engineer fills in MUI Menu state per-tab.
const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

// On each tab:
onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: t.id, x: e.clientX, y: e.clientY }); }}

// At the end:
<Menu
  open={Boolean(ctxMenu)}
  onClose={() => setCtxMenu(null)}
  anchorReference="anchorPosition"
  anchorPosition={ctxMenu ? { left: ctxMenu.x, top: ctxMenu.y } : undefined}
>
  <MenuItem onClick={() => { onSelect(ctxMenu!.id); setCtxMenu(null); }}>Open</MenuItem>
  <MenuItem onClick={async () => { await window.watchtower.invoke('killInstance', { instanceId: ctxMenu!.id }); setCtxMenu(null); }}>Kill</MenuItem>
  <Divider />
  {[5, 30, 60].map((m) => (
    <MenuItem key={m} onClick={async () => { await window.watchtower.invoke('snooze', { instanceId: ctxMenu!.id, untilMs: Date.now() + m * 60_000 }); setCtxMenu(null); }}>
      Snooze {m} min
    </MenuItem>
  ))}
</Menu>
```

- [ ] **Step 3: Manual verify**

Spawn 2 instances. Switch tabs — `focusChanged` gets sent. Snooze one for 5 min via tab right-click. Trigger an attention event on it — no notification should fire. Trigger on the other — notification fires.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/src/App.tsx client/src/components/TabStrip.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): focus tracking + per-tab snooze context menu"
```

---

## Phase 8 — Suspend / resume / crash recovery

### Task 27: Resume planner — pure function that decides what to do for each saved instance

**Files:**
- Create: `orchestrator/suspendResume.ts`
- Create: `tests/orchestrator/suspendResume.test.ts`

- [ ] **Step 1: Write failing test `tests/orchestrator/suspendResume.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { planResume, type PlanInput } from '../../orchestrator/suspendResume.js';
import type { InstanceRow } from '../../shared/stateModel.js';

function row(overrides: Partial<InstanceRow>): InstanceRow {
  return {
    id: 'aaaa',
    cwd: '/tmp',
    status: 'working',
    claudeSessionId: 'sess-1',
    spawnedAt: 1,
    lastActivityAt: 1,
    exitCode: null,
    terminationReason: null,
    resumedFromInstanceId: null,
    jiraKeyHint: null,
    argsJson: null,
    ...overrides,
  };
}

describe('planResume', () => {
  const input: PlanInput = { startupTime: 10_000, livenessGraceMs: 1_000 };

  it('resumes explicit suspended rows with a session id', () => {
    const plan = planResume([row({ status: 'suspended', claudeSessionId: 'sess-1', terminationReason: 'app-quit-suspend' })], input);
    expect(plan).toEqual([{ kind: 'resume', id: 'aaaa', sessionId: 'sess-1', cwd: '/tmp' }]);
  });

  it('treats stale live rows with a session id as crashed-to-resume', () => {
    const plan = planResume([row({ status: 'working', lastActivityAt: 100, claudeSessionId: 'sess-x' })], input);
    expect(plan).toEqual([{ kind: 'resume', id: 'aaaa', sessionId: 'sess-x', cwd: '/tmp' }]);
  });

  it('marks live rows without a session id as no-session', () => {
    const plan = planResume([row({ status: 'spawning', claudeSessionId: null })], input);
    expect(plan).toEqual([{ kind: 'mark-crashed', id: 'aaaa', reason: 'no-session-id' }]);
  });

  it('skips finished and crashed rows', () => {
    const plan = planResume([
      row({ id: 'f', status: 'finished' }),
      row({ id: 'c', status: 'crashed' }),
    ], input);
    expect(plan).toEqual([]);
  });

  it('skips suspended rows flagged "do not resume"', () => {
    const plan = planResume([row({ status: 'suspended', terminationReason: 'user-kill' })], input);
    expect(plan).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npm test -- tests/orchestrator/suspendResume.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `orchestrator/suspendResume.ts`**

```typescript
import type { InstanceRow } from '../shared/stateModel.js';
import { LIVE_STATUSES } from '../shared/stateModel.js';

export interface PlanInput {
  startupTime: number;
  livenessGraceMs: number;
}

export type PlanItem =
  | { kind: 'resume'; id: string; sessionId: string; cwd: string }
  | { kind: 'mark-crashed'; id: string; reason: 'no-session-id' | 'crash' };

export function planResume(rows: InstanceRow[], input: PlanInput): PlanItem[] {
  const plan: PlanItem[] = [];
  for (const row of rows) {
    if (row.status === 'suspended') {
      if (row.terminationReason === 'app-quit-suspend' && row.claudeSessionId) {
        plan.push({ kind: 'resume', id: row.id, sessionId: row.claudeSessionId, cwd: row.cwd });
      }
      continue;
    }
    if ((LIVE_STATUSES as readonly string[]).includes(row.status)) {
      if (row.claudeSessionId) {
        plan.push({ kind: 'resume', id: row.id, sessionId: row.claudeSessionId, cwd: row.cwd });
      } else {
        plan.push({ kind: 'mark-crashed', id: row.id, reason: 'no-session-id' });
      }
    }
  }
  return plan;
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- tests/orchestrator/suspendResume.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/suspendResume.ts tests/orchestrator/suspendResume.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): resume planner (pure)"
```

---

### Task 28: Quit-with-suspend flow (Electron-side confirm + orchestrator transaction)

**Files:**
- Modify: `orchestrator/messagePort.ts` (`prepareSuspend` and `commitSuspend` requests)
- Modify: `orchestrator/index.ts` (new request handlers)
- Modify: `shared/ipcContract.ts` (mirror)
- Modify: `electron/main.ts` (intercept `before-quit`, show confirm dialog, call orchestrator)

- [ ] **Step 1: Extend `orchestrator/messagePort.ts`**

Add to `OrchRequest`:

```typescript
  | { id: string; kind: 'prepareSuspend'; payload: Record<string, never> }
  | { id: string; kind: 'commitSuspend'; payload: { dontResumeIds: string[] } }
```

Add to `OrchResponse`:

```typescript
  | { kind: 'prepareSuspend'; payload: { live: Array<{ id: string; cwd: string; status: string; canResume: boolean }> } }
  | { kind: 'commitSuspend'; payload: { suspendedCount: number } }
```

- [ ] **Step 2: Mirror in `shared/ipcContract.ts`**

- [ ] **Step 3: Add handlers in `orchestrator/index.ts`**

```typescript
    case 'prepareSuspend': {
      const repo = new InstancesRepo(handle!.db);
      const live = repo.listLive().map((r) => ({
        id: r.id,
        cwd: r.cwd,
        status: r.status,
        canResume: Boolean(r.claudeSessionId),
      }));
      return { live };
    }

    case 'commitSuspend': {
      const repo = new InstancesRepo(handle!.db);
      const live = repo.listLive();
      const dontResume = new Set(req.payload.dontResumeIds);
      const tx = handle!.db.transaction(() => {
        for (const inst of live) {
          if (dontResume.has(inst.id) || !inst.claudeSessionId) {
            repo.updateStatus(inst.id, 'finished', Date.now());
            repo.setTermination(inst.id, dontResume.has(inst.id) ? 'user-kill' : 'no-session-id', null);
          } else {
            repo.updateStatus(inst.id, 'suspended', Date.now());
            repo.setTermination(inst.id, 'app-quit-suspend', null);
          }
        }
      });
      tx();
      for (const p of pty.all()) {
        try { p.kill('SIGTERM'); } catch { /* noop */ }
      }
      setTimeout(() => {
        for (const p of pty.all()) {
          try { p.kill('SIGKILL'); } catch { /* noop */ }
        }
      }, 2000);
      return { suspendedCount: live.filter((i) => i.claudeSessionId && !dontResume.has(i.id)).length };
    }
```

- [ ] **Step 4: Modify `electron/main.ts` to intercept quit**

```typescript
import { app, dialog, BrowserWindow } from 'electron';

let quitting = false;

app.on('before-quit', async (event) => {
  if (quitting) return;
  event.preventDefault();
  const orch = getOrchestrator();
  const { live } = await orch.invoke('prepareSuspend', {});
  if (live.length === 0) {
    quitting = true;
    app.quit();
    return;
  }
  const lines = live.map((i) => `  • ${path.basename(i.cwd) || i.cwd} (${i.status})${i.canResume ? '' : ' [no session id — cannot resume]'}`).join('\n');
  const result = await dialog.showMessageBox(getMainWindow() ?? new BrowserWindow({ show: false }), {
    type: 'question',
    buttons: ['Suspend & quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Quit Watchtower',
    message: `${live.length} Claude Code session(s) are running.`,
    detail: `${lines}\n\nThey'll be suspended and resumed automatically on next start.`,
  });
  if (result.response !== 0) return;
  await orch.invoke('commitSuspend', { dontResumeIds: [] });
  quitting = true;
  app.quit();
});
```

You'll need `import { getOrchestrator } from './orchestratorHost.js';` and `import path from 'node:path';` at the top.

For MVP, the "don't resume" per-row checkboxes can wait — the simple confirm dialog suspends everything that has a session ID. Add the per-row toggles in a follow-up if needed.

- [ ] **Step 5: Manual verify**

Spawn an instance. Hit Cmd+Q. Confirm dialog appears. Click "Suspend & quit" — app quits. The instance row in `data.db` should be `status='suspended'`.

```bash
sqlite3 "$HOME/Library/Application Support/Watchtower/data.db" "SELECT id, cwd, status, termination_reason FROM instances ORDER BY spawned_at DESC LIMIT 5"
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/ electron/main.ts shared/
git -C /Users/jan/Projects/Watchtower commit -m "feat: quit-with-suspend flow (confirm + DB transaction + SIGTERM/KILL)"
```

---

### Task 29: Start-with-resume flow

**Files:**
- Modify: `orchestrator/index.ts` (on bootstrap completion, run `planResume` and spawn `claude --resume <id>` for each `resume` plan item)

- [ ] **Step 1: After bootstrap in `orchestrator/index.ts`, add the resume pass**

Inside the `init` message handler, after `handle = await bootstrap(...)`:

```typescript
  const repo = new InstancesRepo(handle.db);
  const all = repo.listAll();
  const plan = planResume(all, { startupTime: Date.now(), livenessGraceMs: 5_000 });
  for (const item of plan) {
    if (item.kind === 'mark-crashed') {
      repo.updateStatus(item.id, 'crashed', Date.now());
      repo.setTermination(item.id, item.reason, null);
      continue;
    }
    repo.updateStatus(item.id, 'resuming', Date.now());
    pty.spawn({
      id: item.id,
      command: 'claude',
      args: ['--resume', item.sessionId],
      cwd: item.cwd,
      env: { ...(process.env as Record<string, string>), WATCHTOWER_INSTANCE_ID: item.id },
      onData: (chunk) => {
        api?.push({ kind: 'ptyData', payload: { instanceId: item.id, chunk } });
      },
      onExit: (code) => {
        api?.push({ kind: 'ptyExit', payload: { instanceId: item.id, code } });
        const inst = repo.get(item.id);
        if (!inst) return;
        if (Date.now() - inst.lastActivityAt < 2_000 && code !== 0) {
          repo.updateStatus(item.id, 'crashed', Date.now());
          repo.setTermination(item.id, 'resume-failed', code);
          api?.push({ kind: 'stateChanged', payload: { instanceId: item.id, status: 'crashed' } });
        } else {
          const result = transition(inst.status, { kind: 'ptyExit', code });
          repo.updateStatus(item.id, result.state, Date.now());
          repo.setTermination(item.id, code === 0 ? 'session-end' : 'crash', code);
          api?.push({ kind: 'stateChanged', payload: { instanceId: item.id, status: result.state } });
        }
      },
    });
    api?.push({ kind: 'stateChanged', payload: { instanceId: item.id, status: 'resuming' } });
  }
```

(Import `planResume` from `./suspendResume.js`.)

- [ ] **Step 2: Manual verify**

Spawn an instance, exchange a few messages with `claude`. Cmd+Q → Suspend. Re-launch the app. The same tab reappears and runs `claude --resume <uuid>`; you should see the prior conversation restored.

- [ ] **Step 3: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/index.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): start-with-resume on boot via claude --resume"
```

---

### Task 30: Resume-failed inline panel in renderer

**Files:**
- Modify: `client/src/state/useInstances.ts` (expose the failure reason; add helper for "reopen fresh")
- Modify: `client/src/App.tsx` (when a tab is `crashed` with `termination_reason='resume-failed'`, render an inline panel instead of the terminal)
- Modify: `orchestrator/index.ts` (`listInstances` already returns status; add `terminationReason` to the response)

- [ ] **Step 1: Extend `listInstances` response**

In `orchestrator/index.ts` and `messagePort.ts` / `ipcContract.ts`, change the `listInstances` payload to include `terminationReason: string | null` per instance.

- [ ] **Step 2: Add `reopenFresh(cwd)` to `useInstances`**

It simply calls `spawnInstance` with the same `cwd` and returns the new ID. Easy.

- [ ] **Step 3: Modify `client/src/App.tsx`**

For the active tab, if `inst.status === 'crashed' && inst.terminationReason === 'resume-failed'`, render:

```tsx
<Box sx={{ p: 4 }}>
  <Typography variant="h6">Couldn't resume session</Typography>
  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
    Claude rejected the resume attempt. The original session ID may have expired.
  </Typography>
  <Button variant="contained" onClick={() => void spawn(inst.cwd)}>Open a fresh claude in {inst.cwd}</Button>
</Box>
```

Otherwise render `<Terminal />`.

- [ ] **Step 4: Manual verify**

Manually corrupt a row: `sqlite3 "$HOME/Library/Application Support/Watchtower/data.db" "UPDATE instances SET claude_session_id = '00000000-0000-0000-0000-000000000000', status='suspended', termination_reason='app-quit-suspend' WHERE id = (SELECT id FROM instances ORDER BY spawned_at DESC LIMIT 1)"`. Restart the app. The resume should fail fast and the inline panel should appear with the "Open fresh" button.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/ shared/ client/
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): inline resume-failed panel with 'open fresh' action"
```

---

## Phase 9 — First-run wizard + settings panel

### Task 31: Hook installer — read, diff, back up, write `~/.claude/settings.json`

**Files:**
- Create: `orchestrator/hookInstaller.ts`
- Create: `tests/orchestrator/hookInstaller.test.ts`
- Modify: `orchestrator/messagePort.ts` (add `installHooks`, `previewHookInstall`, `uninstallHooks` requests)
- Mirror in `shared/ipcContract.ts`

- [ ] **Step 1: Write failing test `tests/orchestrator/hookInstaller.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { previewHookInstall, installHooks, uninstallHooks } from '../../orchestrator/hookInstaller.js';

describe('hookInstaller', () => {
  let dir: string;
  let settingsPath: string;
  const helperPath = '/abs/path/to/watchtower-hook.mjs';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
    settingsPath = path.join(dir, 'settings.json');
  });

  it('previewHookInstall on missing file returns full added entries', () => {
    const preview = previewHookInstall(settingsPath, helperPath);
    expect(preview.alreadyInstalled).toBe(false);
    expect(preview.added).toHaveLength(5);
    expect(preview.added.map((e) => e.event)).toEqual(['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']);
  });

  it('installHooks creates file + sets all 5 hooks + backs up if existed', () => {
    writeFileSync(settingsPath, JSON.stringify({ unrelated: true }));
    const result = installHooks(settingsPath, helperPath);
    expect(result.backedUp).toBeTruthy();
    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.SessionStart[0].hooks[0].command).toContain(helperPath);
    expect(written.unrelated).toBe(true);
    expect(existsSync(result.backedUp!)).toBe(true);
  });

  it('alreadyInstalled detects existing watchtower hooks', () => {
    installHooks(settingsPath, helperPath);
    const preview = previewHookInstall(settingsPath, helperPath);
    expect(preview.alreadyInstalled).toBe(true);
    expect(preview.added).toHaveLength(0);
  });

  it('uninstallHooks removes watchtower entries but leaves other hooks intact', () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '/some/other/script' }] }] },
    }));
    installHooks(settingsPath, helperPath);
    uninstallHooks(settingsPath, helperPath);
    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe('/some/other/script');
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npm test -- tests/orchestrator/hookInstaller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `orchestrator/hookInstaller.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'] as const;
type EventName = typeof EVENTS[number];

function commandFor(helperPath: string, event: EventName): string {
  return `node ${JSON.stringify(helperPath)} ${event}`;
}

function readSettings(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return {}; }
}

interface HookEntry { type: string; command: string }
interface HookBlock { hooks: HookEntry[] }

export interface PreviewResult {
  alreadyInstalled: boolean;
  added: Array<{ event: EventName; command: string }>;
}

export function previewHookInstall(file: string, helperPath: string): PreviewResult {
  const settings = readSettings(file);
  const hooks = (settings.hooks as Record<EventName, HookBlock[]> | undefined) ?? {} as Record<EventName, HookBlock[]>;
  const added: Array<{ event: EventName; command: string }> = [];
  let alreadyAll = true;
  for (const event of EVENTS) {
    const cmd = commandFor(helperPath, event);
    const blocks = hooks[event] ?? [];
    const present = blocks.some((b) => b.hooks?.some((h) => h.command === cmd));
    if (!present) {
      added.push({ event, command: cmd });
      alreadyAll = false;
    }
  }
  return { alreadyInstalled: alreadyAll, added };
}

export interface InstallResult {
  backedUp: string | null;
}

export function installHooks(file: string, helperPath: string): InstallResult {
  let backedUp: string | null = null;
  if (existsSync(file)) {
    backedUp = `${file}.watchtower-bak.${Date.now()}`;
    copyFileSync(file, backedUp);
  }
  const settings = readSettings(file);
  const hooks = ((settings.hooks as Record<string, HookBlock[]> | undefined) ?? {}) as Record<string, HookBlock[]>;
  for (const event of EVENTS) {
    const cmd = commandFor(helperPath, event);
    const blocks: HookBlock[] = hooks[event] ?? [];
    const present = blocks.some((b) => b.hooks?.some((h) => h.command === cmd));
    if (!present) blocks.push({ hooks: [{ type: 'command', command: cmd }] });
    hooks[event] = blocks;
  }
  settings.hooks = hooks;
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return { backedUp };
}

export function uninstallHooks(file: string, helperPath: string): void {
  if (!existsSync(file)) return;
  const settings = readSettings(file);
  const hooks = settings.hooks as Record<string, HookBlock[]> | undefined;
  if (!hooks) return;
  for (const event of EVENTS) {
    const cmd = commandFor(helperPath, event);
    const blocks: HookBlock[] = hooks[event] ?? [];
    const filteredBlocks = blocks
      .map((b) => ({ hooks: b.hooks?.filter((h) => h.command !== cmd) ?? [] }))
      .filter((b) => b.hooks.length > 0);
    if (filteredBlocks.length > 0) hooks[event] = filteredBlocks;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  else settings.hooks = hooks;
  writeFileSync(file, JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npm test -- tests/orchestrator/hookInstaller.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Add request handlers in `orchestrator/index.ts`**

```typescript
import { previewHookInstall, installHooks, uninstallHooks } from './hookInstaller.js';
import { homedir } from 'node:os';

function userClaudeSettingsPath(): string {
  return path.join(homedir(), '.claude', 'settings.json');
}
function helperAbsPath(): string {
  // In dev: <repo>/dist-helper/watchtower-hook.mjs
  // In packaged: <Resources>/dist-helper/watchtower-hook.mjs
  return path.join(process.env.WATCHTOWER_HELPER_DIR ?? path.join(process.cwd(), 'dist-helper'), 'watchtower-hook.mjs');
}

    case 'previewHookInstall':
      return previewHookInstall(userClaudeSettingsPath(), helperAbsPath());
    case 'installHooks':
      return installHooks(userClaudeSettingsPath(), helperAbsPath());
    case 'uninstallHooks':
      uninstallHooks(userClaudeSettingsPath(), helperAbsPath());
      return { ok: true };
```

Mirror these in `messagePort.ts` and `ipcContract.ts` as request/response types.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/hookInstaller.ts orchestrator/index.ts shared/ tests/orchestrator/hookInstaller.test.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat(orchestrator): hook installer with backup + preview + uninstall"
```

---

### Task 32: `FirstRunWizard` UI

**Files:**
- Create: `client/src/components/FirstRunWizard.tsx`
- Modify: `client/src/App.tsx` (open wizard if `settings.first_run_completed_at` is unset; use `Settings` repo by calling new `getSetting`/`setSetting` requests)
- Add to orchestrator: `getSetting(key)`, `setSetting(key, value)` requests

- [ ] **Step 1: Add `getSetting`/`setSetting` to orchestrator**

In `messagePort.ts`, `ipcContract.ts`, and `index.ts` add the request and a `SettingsRepo`-backed handler.

- [ ] **Step 2: Create `client/src/components/FirstRunWizard.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, Alert, Box } from '@mui/material';

interface PreviewResponse {
  alreadyInstalled: boolean;
  added: Array<{ event: string; command: string }>;
}

interface Props {
  open: boolean;
  onDone(): void;
}

export function FirstRunWizard({ open, onDone }: Props) {
  const [step, setStep] = useState<'welcome' | 'hooks' | 'notify' | 'done'>('welcome');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step === 'hooks') {
      window.watchtower.invoke('previewHookInstall', {}).then(setPreview).catch((e: Error) => setError(e.message));
    }
  }, [step]);

  const install = async () => {
    try {
      const res = await window.watchtower.invoke('installHooks', {});
      if (res.backedUp) console.info('Backed up settings to', res.backedUp);
      setStep('notify');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const finish = async () => {
    await window.watchtower.invoke('setSetting', { key: 'first_run_completed_at', value: String(Date.now()) });
    onDone();
  };

  return (
    <Dialog open={open} fullWidth maxWidth="md">
      <DialogTitle>Welcome to Watchtower</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {step === 'welcome' && (
          <Stack spacing={2}>
            <Typography>
              Watchtower watches your Claude Code instances and pings you when one needs your input.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              We'll install five hooks into <code>~/.claude/settings.json</code>: SessionStart, UserPromptSubmit, Notification, Stop, and SessionEnd. They forward Claude Code's lifecycle events to Watchtower's local listener. Existing settings are backed up before any change.
            </Typography>
          </Stack>
        )}
        {step === 'hooks' && preview && (
          <Stack spacing={2}>
            {preview.alreadyInstalled ? (
              <Alert severity="success">Hooks are already installed.</Alert>
            ) : (
              <>
                <Typography variant="body2">The following entries will be added to <code>~/.claude/settings.json</code>:</Typography>
                <Box sx={{ backgroundColor: 'background.paper', p: 1.5, borderRadius: 1, fontFamily: 'monospace', fontSize: 12, overflow: 'auto', maxHeight: 320 }}>
                  {preview.added.map((a) => `${a.event}: ${a.command}`).join('\n')}
                </Box>
              </>
            )}
          </Stack>
        )}
        {step === 'notify' && (
          <Stack spacing={2}>
            <Typography>Try a test notification.</Typography>
            <Button variant="outlined" onClick={() => new Notification('Watchtower', { body: 'Hello.' })}>Send test notification</Button>
            <Typography variant="caption" color="text.secondary">
              If nothing appears, check System Settings → Notifications → Watchtower and allow alerts.
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'welcome' && <Button variant="contained" onClick={() => setStep('hooks')}>Continue</Button>}
        {step === 'hooks' && !preview?.alreadyInstalled && (
          <Button variant="contained" onClick={install}>Install hooks</Button>
        )}
        {step === 'hooks' && preview?.alreadyInstalled && (
          <Button variant="contained" onClick={() => setStep('notify')}>Continue</Button>
        )}
        {step === 'notify' && <Button variant="contained" onClick={finish}>Finish</Button>}
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 3: Modify `client/src/App.tsx`**

On mount, fetch `getSetting('first_run_completed_at')`; if empty, show the wizard. When `onDone` fires, hide it.

```typescript
const [showWizard, setShowWizard] = useState(false);
useEffect(() => {
  void window.watchtower.invoke('getSetting', { key: 'first_run_completed_at' }).then((v) => {
    if (!v.value) setShowWizard(true);
  });
}, []);
// ... in JSX:
<FirstRunWizard open={showWizard} onDone={() => setShowWizard(false)} />
```

- [ ] **Step 4: Manual verify**

Delete `data.db` (or just `DELETE FROM settings WHERE key='first_run_completed_at'`). Launch — wizard appears. Step through to install. Inspect `~/.claude/settings.json` — hooks present, plus a backup file beside it.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/src/components/FirstRunWizard.tsx client/src/App.tsx orchestrator/index.ts shared/
git -C /Users/jan/Projects/Watchtower commit -m "feat: first-run wizard with hook install diff + confirm"
```

---

### Task 33: `SettingsPanel` UI (quiet threshold, snooze defaults, hook reinstall, diagnostics)

**Files:**
- Create: `client/src/components/SettingsPanel.tsx`
- Modify: `client/src/components/ModuleRail.tsx` (enable `settings`)
- Modify: `client/src/App.tsx` (render `SettingsPanel` when `activeModule === 'settings'`)

- [ ] **Step 1: Create `client/src/components/SettingsPanel.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { Box, Typography, TextField, Stack, Button, Divider, Alert } from '@mui/material';

export function SettingsPanel() {
  const [quietMs, setQuietMs] = useState<string>('90000');
  const [defaultCwd, setDefaultCwd] = useState<string>('');
  const [hookStatus, setHookStatus] = useState<string>('');
  const [listenerPort, setListenerPort] = useState<number | null>(null);

  useEffect(() => {
    void window.watchtower.invoke('getSetting', { key: 'quiet_timer_ms' }).then((r) => setQuietMs(r.value || '90000'));
    void window.watchtower.invoke('getSetting', { key: 'default_cwd' }).then((r) => setDefaultCwd(r.value || ''));
    void window.watchtower.invoke('getSetting', { key: 'listener_port' }).then((r) => setListenerPort(r.value ? Number(r.value) : null));
  }, []);

  const save = async (key: string, value: string) => {
    await window.watchtower.invoke('setSetting', { key, value });
  };

  const reinstallHooks = async () => {
    const res = await window.watchtower.invoke('installHooks', {});
    setHookStatus(res.backedUp ? `Reinstalled. Backup: ${res.backedUp}` : 'Reinstalled.');
  };

  const uninstallHooks = async () => {
    await window.watchtower.invoke('uninstallHooks', {});
    setHookStatus('Uninstalled.');
  };

  return (
    <Box sx={{ p: 4, maxWidth: 720, overflow: 'auto', height: '100%' }}>
      <Typography variant="h5" sx={{ mb: 3 }}>Settings</Typography>

      <Stack spacing={3}>
        <Stack>
          <Typography variant="subtitle1">Notification quiet timer</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>How long (ms) Claude stays at end-of-turn before we ping.</Typography>
          <TextField size="small" value={quietMs} onChange={(e) => setQuietMs(e.target.value)} onBlur={() => save('quiet_timer_ms', quietMs)} />
        </Stack>

        <Stack>
          <Typography variant="subtitle1">Default working directory</Typography>
          <TextField size="small" value={defaultCwd} onChange={(e) => setDefaultCwd(e.target.value)} onBlur={() => save('default_cwd', defaultCwd)} />
        </Stack>

        <Divider />

        <Stack>
          <Typography variant="subtitle1">Hooks</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button variant="outlined" onClick={reinstallHooks}>Reinstall hooks</Button>
            <Button variant="outlined" color="warning" onClick={uninstallHooks}>Uninstall hooks</Button>
          </Stack>
          {hookStatus && <Alert severity="info" sx={{ mt: 1 }}>{hookStatus}</Alert>}
        </Stack>

        <Divider />

        <Stack>
          <Typography variant="subtitle1">Diagnostics</Typography>
          <Typography variant="body2" color="text.secondary">Hook listener port: {listenerPort ?? 'unknown'}</Typography>
          <Button variant="text" sx={{ alignSelf: 'flex-start' }} onClick={() => new Notification('Watchtower', { body: 'Test notification' })}>Send test notification</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: Enable `settings` in `ModuleRail.tsx`**

Change `enabled: false` to `enabled: true` for the settings entry.

- [ ] **Step 3: Render `SettingsPanel` in `App.tsx`**

```typescript
{activeModule === 'settings' && <SettingsPanel />}
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add client/src/components/SettingsPanel.tsx client/src/components/ModuleRail.tsx client/src/App.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat(client): SettingsPanel — quiet timer, default cwd, hook ops, diagnostics"
```

---

## Phase 10 — Error handling polish

### Task 34: Orchestrator auto-restart with attempt limit

**Files:**
- Modify: `electron/orchestratorHost.ts` (track restart attempts, expose `onCrash` + `onRestart` listeners)
- Modify: `electron/main.ts` (subscribe and surface a banner via `pushToRenderer('orchestratorCrashed', ...)`)
- Modify: `client/src/App.tsx` (render a thin top banner when orchestrator is down or restarting)

- [ ] **Step 1: Modify `electron/orchestratorHost.ts`**

Replace the file with:

```typescript
import { utilityProcess, type UtilityProcess, MessageChannelMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortApi } from '../orchestrator/messagePort.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let child: UtilityProcess | null = null;
let api: PortApi | null = null;
let restartsInLastMinute: number[] = [];

type Listener = (info: { code: number | null; restarting: boolean }) => void;
const listeners = new Set<Listener>();

function emit(info: { code: number | null; restarting: boolean }): void {
  for (const l of listeners) l(info);
}

export function onCrash(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function startOrchestrator(): PortApi {
  if (api) return api;
  const entry = path.join(__dirname, '../dist-orchestrator/index.js');
  child = utilityProcess.fork(entry, [], { serviceName: 'watchtower-orchestrator', stdio: 'inherit' });
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage({ kind: 'init' }, [port1]);
  api = new PortApi(port2);
  child.on('exit', (code) => {
    console.error(`[orchestrator] exited with code ${code}`);
    const now = Date.now();
    restartsInLastMinute = restartsInLastMinute.filter((t) => now - t < 60_000);
    restartsInLastMinute.push(now);
    api = null;
    child = null;
    const restarting = restartsInLastMinute.length <= 3;
    emit({ code, restarting });
    if (restarting) {
      setTimeout(() => startOrchestrator(), 250);
    }
  });
  return api;
}

export function getOrchestrator(): PortApi {
  if (!api) throw new Error('orchestrator not started');
  return api;
}
```

- [ ] **Step 2: Modify `electron/main.ts`**

```typescript
import { startOrchestrator, getOrchestrator, onCrash } from './orchestratorHost.js';
// ...
onCrash((info) => {
  pushToRenderer('orchestratorCrashed', info);
});
```

Add `orchestratorCrashed` to `IpcPush` in `shared/ipcContract.ts`:

```typescript
  | { kind: 'orchestratorCrashed'; payload: { code: number | null; restarting: boolean } }
```

- [ ] **Step 3: Render banner in `client/src/App.tsx`**

```typescript
const [orchDown, setOrchDown] = useState<null | { code: number | null; restarting: boolean }>(null);
useEffect(() => {
  return window.watchtower.on('orchestratorCrashed', (p) => {
    setOrchDown(p);
    if (p.restarting) setTimeout(() => setOrchDown(null), 2000);
  });
}, []);

// in JSX, above the Box that contains ModuleRail:
{orchDown && (
  <Box sx={{ backgroundColor: 'error.dark', color: 'error.contrastText', px: 2, py: 1 }}>
    {orchDown.restarting
      ? 'Orchestrator crashed — restarting…'
      : 'Orchestrator has crashed repeatedly. Open Settings → Diagnostics for the log path.'}
  </Box>
)}
```

- [ ] **Step 4: Manual verify**

`kill <pid>` the orchestrator child (find its PID via `ps -ef | grep watchtower-orchestrator`). Banner appears in the renderer and the child restarts within ~250 ms; instance list reappears.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add electron/ shared/ipcContract.ts client/src/App.tsx
git -C /Users/jan/Projects/Watchtower commit -m "feat: orchestrator auto-restart (3×/min) + crash banner"
```

---

### Task 35: Hook listener bind failure → pty heuristics fallback

**Files:**
- Modify: `orchestrator/bootstrap.ts` (catch listener bind error; return `null` listener)
- Modify: `orchestrator/index.ts` (when listener missing, register a per-instance `setTimeout` on idle data to synthesize `stopHook` events; surface a `listenerDown` push)

- [ ] **Step 1: Modify `orchestrator/bootstrap.ts`**

Wrap the `startHookListener` call:

```typescript
let listener: HookListenerHandle | null = null;
try {
  listener = await startHookListener({ /* same opts */ });
  writeListenerSidecar(/* … */);
} catch (err) {
  console.error('[orchestrator] failed to bind hook listener:', err);
}

return {
  db,
  listener,
  async shutdown() {
    await listener?.stop();
    db.close();
  },
};
```

Change `BootstrapHandle.listener` type to `HookListenerHandle | null`.

- [ ] **Step 2: In `orchestrator/index.ts`, when `handle.listener === null`, install pty-data idle heuristics**

```typescript
const idleTimers = new Map<string, NodeJS.Timeout>();
const IDLE_MS = 60_000;

function armIdle(id: string): void {
  if (handle?.listener) return; // listener works, no heuristic needed
  clearTimeout(idleTimers.get(id));
  idleTimers.set(id, setTimeout(() => {
    const repo = new InstancesRepo(handle!.db);
    const inst = repo.get(id);
    if (!inst) return;
    const result = transition(inst.status, { kind: 'stopHook' });
    if (result.state !== inst.status) {
      repo.updateStatus(id, result.state, Date.now());
      api?.push({ kind: 'stateChanged', payload: { instanceId: id, status: result.state } });
    }
  }, IDLE_MS));
}
```

Call `armIdle(id)` inside the `onData` handler in `spawnInstance`. Push a `listenerDown` event on init if `listener === null`.

- [ ] **Step 3: Render diagnostic in status bar (or banner)**

In `client/src/App.tsx`, subscribe to `listenerDown` and render a small amber line above the ModuleRail: *"Hook listener unavailable — using pty heuristics. Open Settings → Diagnostics."*

- [ ] **Step 4: Manual verify**

Block the port range: open netcat listeners on 7421-7430 (`for p in $(seq 7421 7430); do nc -kl 127.0.0.1 $p &; done`). Launch Watchtower → diagnostic banner appears. Heuristic still fires `idle-notify` after 60 s. Kill the netcat processes.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/ client/src/App.tsx shared/ipcContract.ts
git -C /Users/jan/Projects/Watchtower commit -m "feat: pty heuristic fallback when hook listener can't bind"
```

---

### Task 36: SQLite corruption recovery on boot

**Files:**
- Modify: `orchestrator/db/connection.ts` (catch `SQLITE_CORRUPT` / open failures; rotate `data.db` → `data.db.broken-<ts>`; start fresh; emit a one-time notice)

- [ ] **Step 1: Modify `orchestrator/db/connection.ts`**

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { runMigrations } from './migrations.js';

export function appSupportDir(): string {
  const dir = path.join(homedir(), 'Library', 'Application Support', 'Watchtower');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface OpenDbResult {
  db: Database.Database;
  rotatedFrom: string | null;
}

export function openDb(overridePath?: string): Database.Database {
  return openDbWithStatus(overridePath).db;
}

export function openDbWithStatus(overridePath?: string): OpenDbResult {
  const dbPath = overridePath ?? path.join(appSupportDir(), 'data.db');
  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return { db, rotatedFrom: null };
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'SQLITE_CORRUPT' || e.code === 'SQLITE_NOTADB') {
      const broken = `${dbPath}.broken-${Date.now()}`;
      try { renameSync(dbPath, broken); } catch { /* ignore */ }
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      return { db, rotatedFrom: broken };
    }
    throw err;
  }
}
```

- [ ] **Step 2: Surface the rotation in `bootstrap.ts`** — return `rotatedFrom` and let `orchestrator/index.ts` push it as a `dbRotated` event so the renderer can show a one-time toast.

- [ ] **Step 3: Manual verify**

Truncate the DB: `echo "garbage" > "$HOME/Library/Application Support/Watchtower/data.db"`. Launch — app opens with a toast "Database was unreadable; a fresh one was created. Old DB saved as ...". Verify the `.broken-<ts>` file exists.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add orchestrator/
git -C /Users/jan/Projects/Watchtower commit -m "feat: rotate corrupted data.db and start fresh on boot"
```

---

## Phase 11 — Build & ship

### Task 37: First runnable `.app` via `electron-builder`

**Files:**
- Create: `build-resources/entitlements.mac.plist`
- Create: `build-resources/icon.icns` (placeholder OK)
- Modify: `package.json` (small build-script tweak for helper path resolution in packaged mode)
- Modify: `orchestrator/index.ts` (`helperAbsPath()` honors `process.resourcesPath` in packaged mode)

- [ ] **Step 1: Create `build-resources/entitlements.mac.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
</dict>
</plist>
```

- [ ] **Step 2: Add a placeholder `build-resources/icon.icns`**

For MVP, generate from any 1024×1024 PNG:

```bash
mkdir -p /tmp/wt-icon.iconset
sips -z 1024 1024 /path/to/source.png --out /tmp/wt-icon.iconset/icon_512x512@2x.png
# (For MVP, just one size in the iconset is fine — electron-builder will warn but build.)
iconutil -c icns /tmp/wt-icon.iconset -o /Users/jan/Projects/Watchtower/build-resources/icon.icns
```

- [ ] **Step 3: Modify `orchestrator/index.ts` helper path resolution**

```typescript
function helperAbsPath(): string {
  if (process.env.WATCHTOWER_HELPER_DIR) {
    return path.join(process.env.WATCHTOWER_HELPER_DIR, 'watchtower-hook.mjs');
  }
  // packaged: <Resources>/dist-helper/watchtower-hook.mjs (asarUnpack already configured)
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-helper', 'watchtower-hook.mjs');
  }
  // dev: repo root
  return path.join(process.cwd(), 'dist-helper', 'watchtower-hook.mjs');
}
```

- [ ] **Step 4: Build the distributable**

Run: `npm run dist:mac`
Expected: `release/Watchtower-0.0.1-arm64.dmg` (or `.zip`) and `release/mac-arm64/Watchtower.app` produced.

- [ ] **Step 5: Run the packaged app and smoke-test**

```bash
open /Users/jan/Projects/Watchtower/release/mac-arm64/Watchtower.app
```

- App opens, tray icon appears.
- First-run wizard runs (delete `~/Library/Application Support/Watchtower/data.db` first if needed).
- Click `+`, spawn a `claude` instance in a scratch dir, type to it.
- Trigger a permission prompt → macOS notification fires.
- Cmd+Q with the instance still alive → confirm dialog → quit. Relaunch → tab reappears via `--resume`.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jan/Projects/Watchtower add build-resources/ orchestrator/index.ts package.json
git -C /Users/jan/Projects/Watchtower commit -m "build: first runnable Watchtower.app via electron-builder"
```

---

## Plan self-review

After this plan was written, ran a final pass checking it against the spec.

**1. Spec coverage** (every section of `2026-05-22-watchtower-instance-watcher-design.md` mapped to one or more tasks):

| Spec section | Task(s) |
|---|---|
| §3 Architecture (3 processes + IPC) | 2, 4, 6 |
| §4 State machine | 9 |
| §5 Hook contract (helper + listener + sidecar + pairing) | 11, 12, 13, 14, 31 |
| §6 Notification rules | 10, 23 |
| §7.1 Tray | 25 |
| §7.2 Main window layout (rail + tab strip + dashboard + terminal) | 17, 18, 20, 21 |
| §7.3 New-instance flow | 19 |
| §7.4 First-run flow (wizard, hook install, token, test notif) | 14, 31, 32 |
| §7.5 Settings panel | 33 |
| §8.1 Schema | 7, 8 |
| §8.3 Quit-with-suspend flow | 28 |
| §8.4 Start/resume flow | 27, 29 |
| §8.5 Crash recovery (orphan handling) | 27, 29 |
| §9 Error handling table | 34, 35, 36 |
| §10 Testing | 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 27, 31 |
| §11 Build & ship | 1, 37 |

One spec call-out updated by reality: §5 says pairing uses `CLAUDEDECK_INSTANCE_ID`; this plan uses `claude --session-id <uuid>` so the UUID *is* the Claude session ID (still set as `WATCHTOWER_INSTANCE_ID` env var so the helper has it). Pairing is by `session_id` directly. Note this in `PROTOTYPE.md` if you'd like to keep the decision log in sync.

**2. Placeholder scan** — no `TBD` / `TODO` / "implement later". Two places acknowledge MVP shortcuts (per-row "don't resume" checkboxes deferred in Task 28; tray "look up cwd basename for notification" uses a closure in Task 25). Both are flagged inline and have working defaults.

**3. Type consistency** — `transition`, `decide`, `Notifier`, `PtyManager`, request/response kinds match across Tasks 9–17, 22–25. `InstanceRow` fields stay consistent from Task 8 onward.

**4. Sub-project decomposition** — single cohesive MVP; not splittable into independent shippable pieces. The phases serve as natural pause points.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-watchtower-instance-watcher-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?










