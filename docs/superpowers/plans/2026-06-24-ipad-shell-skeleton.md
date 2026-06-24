# iPad Capacitor Shell — Walking Skeleton Implementation Plan (#73)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Capacitor iPad app — personal-team-signed, installed on a real iPad — that connects to the Mac orchestrator over `WebSocketTransport` on the same Wi-Fi LAN and round-trips `listInstances`, proving the Apple/Capacitor/build-sign + transport pipeline end-to-end.

**Architecture:** A new `apps/ipad` workspace holds a thin Vite+React app reusing the existing `@watchtower/transport` (`createWebSocketTransport`) and `@watchtower/shared` (ipcContract types) — no module carve. Pure, testable modules (`connection`, `probe`) carry all logic; `App.tsx` is a thin UI shell. The only desktop-side change is an **opt-in** orchestrator bind: `WATCHTOWER_WS_HOST` makes the WS bridge bind to the Mac's LAN IP on a **stable** port and log the connect string. Capacitor wraps the built web app for iOS.

**Tech Stack:** Vite 5 + React 18, Capacitor (`@capacitor/core`, `@capacitor/ios`, `@capacitor/preferences`), vitest (node env — test pure logic, never render components), TypeScript 5.6 (Bundler resolution), Fastify WS bridge (existing).

## Global Constraints

- **Walking skeleton only.** No module carve, no Tailscale, no wake button, no real Instances/TimeTracker/VNC UI, no paid Apple account/TestFlight. Those are #72/#74/#75/later.
- **Zero desktop behavior change when `WATCHTOWER_WS_HOST` is unset** — the WS bridge keeps its `127.0.0.1` default and ephemeral port exactly as today.
- **Bind to a specific LAN IP, never `0.0.0.0`.** The listener is protected by the existing bearer-token (`supportDir/hook-token`) via the `?token=` query param.
- **vitest runs in the `node` environment** — there is no jsdom. Do NOT render React components in tests; test extracted pure functions against fakes.
- **Full test suite must stay green** (currently **619**); new tests add to it. No test deleted.
- Reuse `@watchtower/transport` + `@watchtower/shared` as-is; `apps/*` is already a workspace.
- Bundle id `cz.greencode.watchtower.ipad`; free **personal** signing team; min target ~iPadOS 16.
- Czech locale / no i18n rules do not apply to the skeleton's debug screen (raw/dev text is fine).

---

## File structure

**Created:**
- `apps/ipad/package.json` — `@watchtower/ipad` (private), deps + `build`/`cap:sync` scripts.
- `apps/ipad/vite.config.ts` — Vite+React, `@watchtower/*` aliases → `packages/*/src`, `outDir: apps/ipad/dist`.
- `apps/ipad/tsconfig.json` — Bundler resolution + `@watchtower/*` paths (mirrors `apps/desktop`).
- `apps/ipad/index.html`, `apps/ipad/src/main.tsx` — React mount.
- `apps/ipad/src/connection.ts` — pure parse/validate + persist of `{host, port, token}`.
- `apps/ipad/src/probe.ts` — pure `probeInstances(bridge)` + `watchState(bridge, cb)`.
- `apps/ipad/src/App.tsx` — thin UI tying connection + probe + `createWebSocketTransport`.
- `apps/ipad/capacitor.config.ts` — appId/webDir.
- `apps/ipad/ios/` — Capacitor-generated iOS project (committed).
- `apps/ipad/README.md` — build/sign/run runbook.
- `orchestrator/remoteBind.ts` — pure `resolveWsRemoteBind(env, interfaces)` + `formatIpadConnectionInfo(...)`.
- `tests/ipad/connection.test.ts`, `tests/ipad/probe.test.ts`, `tests/orchestrator/remoteBind.test.ts`.

**Modified:**
- `orchestrator/bootstrap.ts` — read remote-bind config, pass `wsHost`/`wsPort`, log connect info.
- `orchestrator/index.ts` — (no change if bootstrap reads env directly; see Task 1).

---

## Note on testing in this plan

vitest is `environment: 'node'` with no jsdom — so **every test targets a pure function or module against a real interface + a fake implementation** (a fake `WatchtowerBridge`, a fake storage). React rendering, Capacitor native, code signing, device install, and the live LAN round-trip are **not** unit-testable; they are the **manual acceptance** in Task 5. `createWebSocketTransport` and the WS protocol are already covered by #68's tests — do not re-test them.

---

## Task 1: Orchestrator opt-in LAN bind + stable port + connect-info log

**Files:**
- Create: `orchestrator/remoteBind.ts`
- Test: `tests/orchestrator/remoteBind.test.ts`
- Modify: `orchestrator/bootstrap.ts` (call site of `startWsBridge`, ~line 88-90; the connect-info log)

**Interfaces:**
- Produces: `resolveWsRemoteBind(env, interfaces): { host: string; port: number } | null` and `formatIpadConnectionInfo(opts: { host: string; port: number; token: string }): string`.
- Consumes: `BootstrapOptions.wsHost?`/`wsPort?` (already exist, `bootstrap.ts:7-10`); `startWsBridge` returns the actual `port` (`wsBridge.ts`).

- [ ] **Step 1: Write the failing test for `resolveWsRemoteBind`**

```ts
// tests/orchestrator/remoteBind.test.ts
import { describe, it, expect } from 'vitest';
import { resolveWsRemoteBind, formatIpadConnectionInfo } from '../../orchestrator/remoteBind.js';

const ifaces = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  en0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
};

describe('resolveWsRemoteBind', () => {
  it('returns null when WATCHTOWER_WS_HOST is unset (loopback default preserved)', () => {
    expect(resolveWsRemoteBind({}, ifaces)).toBeNull();
  });
  it('uses an explicit host and the default stable port 7445', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: '192.168.1.42' }, ifaces))
      .toEqual({ host: '192.168.1.42', port: 7445 });
  });
  it('honors an explicit WATCHTOWER_WS_PORT', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: '192.168.1.42', WATCHTOWER_WS_PORT: '7500' }, ifaces))
      .toEqual({ host: '192.168.1.42', port: 7500 });
  });
  it('resolves "auto" to the first non-internal IPv4 interface', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, ifaces))
      .toEqual({ host: '192.168.1.42', port: 7445 });
  });
  it('returns null for "auto" when no external IPv4 exists (stays loopback)', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, { lo0: ifaces.lo0 })).toBeNull();
  });
});

describe('formatIpadConnectionInfo', () => {
  it('builds the ws connect string with the token', () => {
    expect(formatIpadConnectionInfo({ host: '192.168.1.42', port: 7445, token: 'abc' }))
      .toBe('[orchestrator] iPad connect → ws://192.168.1.42:7445/ws  token: abc');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/orchestrator/remoteBind.test.ts`
Expected: FAIL — cannot resolve `../../orchestrator/remoteBind.js`.

- [ ] **Step 3: Implement `orchestrator/remoteBind.ts`**

```ts
type Iface = { address: string; family: string | number; internal: boolean };
type Interfaces = Record<string, Iface[] | undefined>;

const DEFAULT_WS_PORT = 7445;

/**
 * Resolve the opt-in remote bind for the WS bridge. Returns null (→ caller keeps
 * the 127.0.0.1 default) unless WATCHTOWER_WS_HOST is set. "auto" picks the first
 * non-internal IPv4 address; an explicit value is used verbatim. Never binds 0.0.0.0.
 */
export function resolveWsRemoteBind(
  env: { WATCHTOWER_WS_HOST?: string; WATCHTOWER_WS_PORT?: string },
  interfaces: Interfaces,
): { host: string; port: number } | null {
  const raw = env.WATCHTOWER_WS_HOST?.trim();
  if (!raw) return null;
  const port = env.WATCHTOWER_WS_PORT ? Number(env.WATCHTOWER_WS_PORT) : DEFAULT_WS_PORT;
  if (raw !== 'auto') return { host: raw, port };
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      const fam = i.family === 'IPv4' || i.family === 4;
      if (fam && !i.internal) return { host: i.address, port };
    }
  }
  return null;
}

export function formatIpadConnectionInfo(opts: { host: string; port: number; token: string }): string {
  return `[orchestrator] iPad connect → ws://${opts.host}:${opts.port}/ws  token: ${opts.token}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/orchestrator/remoteBind.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Wire it into `bootstrap.ts`**

In `orchestrator/bootstrap.ts`, add the import at the top:
```ts
import { networkInterfaces } from 'node:os';
import { resolveWsRemoteBind, formatIpadConnectionInfo } from './remoteBind.js';
```
Replace the `startWsBridge({ host: opts.wsHost ?? '127.0.0.1', port: opts.wsPort ?? 0, … })` call (around line 88) so an env-driven remote bind overrides the defaults, and log the connect string when active:
```ts
  const remote = resolveWsRemoteBind(process.env, networkInterfaces() as never);
  const wsBridge = await startWsBridge({
    host: remote?.host ?? opts.wsHost ?? '127.0.0.1',
    port: remote?.port ?? opts.wsPort ?? 0,
    token,
    handleRequest: opts.handleRequest,
  });
  if (remote) {
    console.log(formatIpadConnectionInfo({ host: remote.host, port: wsBridge.port, token }));
  }
```
(Keep the existing `token`/`handleRequest` wiring; only the `host`/`port` and the log are new. When `WATCHTOWER_WS_HOST` is unset, `remote` is null and behavior is byte-for-byte unchanged.)

- [ ] **Step 6: Verify the full suite stays green**

Run: `npm test`
Expected: 619 + 6 new = **625** passing, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/remoteBind.ts tests/orchestrator/remoteBind.test.ts orchestrator/bootstrap.ts
git commit -m "feat: #73 opt-in WS LAN bind + iPad connect-info log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `apps/ipad` workspace scaffold (buildable empty app)

**Files:**
- Create: `apps/ipad/package.json`, `apps/ipad/vite.config.ts`, `apps/ipad/tsconfig.json`, `apps/ipad/index.html`, `apps/ipad/src/main.tsx`, `apps/ipad/src/App.tsx` (placeholder)

**Interfaces:**
- Produces: a Vite-buildable `@watchtower/ipad` web app wired into the workspace, resolving `@watchtower/*` to source. Later tasks fill in `connection.ts`, `probe.ts`, and the real `App.tsx`.
- Consumes: nothing yet (App is a placeholder).

- [ ] **Step 1: Create `apps/ipad/package.json`**

```json
{
  "name": "@watchtower/ipad",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "cap:sync": "cap sync ios"
  },
  "dependencies": {
    "@capacitor/core": "^6.0.0",
    "@capacitor/ios": "^6.0.0",
    "@capacitor/preferences": "^6.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/ipad/tsconfig.json`** (mirror `apps/desktop`, no `dist-renderer` outDir)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@watchtower/shared/*": ["../../packages/shared/src/*"],
      "@watchtower/transport": ["../../packages/transport/src/index.ts"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 3: Create `apps/ipad/vite.config.ts`** (`outDir` is local `dist`, which Capacitor uses as `webDir`)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, '../../packages/transport/src'),
    },
  },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
});
```

- [ ] **Step 4: Create `apps/ipad/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Watchtower iPad</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/ipad/src/main.tsx` and a placeholder `apps/ipad/src/App.tsx`**

```tsx
// main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');
createRoot(el).render(<React.StrictMode><App /></React.StrictMode>);
```
```tsx
// App.tsx (placeholder — replaced in Task 4)
export function App() {
  return <h1>Watchtower iPad</h1>;
}
```

- [ ] **Step 6: Install the new workspace deps and verify it builds + typechecks + suite green**

```bash
npm install
npm run build --workspace @watchtower/ipad   # produces apps/ipad/dist/index.html
npx tsc -p apps/ipad/tsconfig.json --noEmit   # clean
npm test                                       # still 625 passing
```
Expected: `apps/ipad/dist/index.html` exists; typecheck clean; suite green.

- [ ] **Step 7: Add `apps/ipad/dist` and Capacitor artifacts to `.gitignore`**

Append to `.gitignore`:
```
apps/ipad/dist/
apps/ipad/ios/App/App/public/
```

- [ ] **Step 8: Commit**

```bash
git add apps/ipad package.json package-lock.json .gitignore
git commit -m "feat: #73 scaffold apps/ipad Capacitor web app workspace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Connection config module (`connection.ts`)

**Files:**
- Create: `apps/ipad/src/connection.ts`
- Test: `tests/ipad/connection.test.ts`

**Interfaces:**
- Produces: `parseConnection(input): { ok: true; value: Connection } | { ok: false; error: string }`, `connectionToWsUrl(c: Connection): string`, and `loadConnection(store)` / `saveConnection(store, c)` where `Connection = { host: string; port: number; token: string }` and `store` is `{ get(k): Promise<string|null>; set(k,v): Promise<void> }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ipad/connection.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseConnection, connectionToWsUrl, loadConnection, saveConnection,
} from '../../apps/ipad/src/connection.js';

describe('parseConnection', () => {
  it('accepts a valid host/port/token', () => {
    expect(parseConnection({ host: '192.168.1.42', port: '7445', token: 'abc' }))
      .toEqual({ ok: true, value: { host: '192.168.1.42', port: 7445, token: 'abc' } });
  });
  it('rejects an empty host', () => {
    expect(parseConnection({ host: '', port: '7445', token: 'abc' }).ok).toBe(false);
  });
  it('rejects an out-of-range port', () => {
    expect(parseConnection({ host: 'x', port: '70000', token: 'abc' }).ok).toBe(false);
  });
  it('rejects an empty token', () => {
    expect(parseConnection({ host: 'x', port: '7445', token: '' }).ok).toBe(false);
  });
});

describe('connectionToWsUrl', () => {
  it('builds the /ws url', () => {
    expect(connectionToWsUrl({ host: '192.168.1.42', port: 7445, token: 't' }))
      .toBe('ws://192.168.1.42:7445/ws');
  });
});

describe('persistence', () => {
  it('round-trips through a store', async () => {
    const mem = new Map<string, string>();
    const store = {
      get: async (k: string) => mem.get(k) ?? null,
      set: async (k: string, v: string) => void mem.set(k, v),
    };
    await saveConnection(store, { host: 'h', port: 7445, token: 't' });
    expect(await loadConnection(store)).toEqual({ host: 'h', port: 7445, token: 't' });
  });
  it('returns null when nothing is stored', async () => {
    const store = { get: async () => null, set: async () => {} };
    expect(await loadConnection(store)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ipad/connection.test.ts`
Expected: FAIL — cannot resolve `connection.js`.

- [ ] **Step 3: Implement `apps/ipad/src/connection.ts`**

```ts
export type Connection = { host: string; port: number; token: string };
export type ConnStore = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };

const KEY = 'watchtower.connection';

export function parseConnection(input: { host: string; port: string; token: string }):
  | { ok: true; value: Connection }
  | { ok: false; error: string } {
  const host = input.host.trim();
  if (!host) return { ok: false, error: 'Host is required' };
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port must be 1–65535' };
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'Token is required' };
  return { ok: true, value: { host, port, token } };
}

export function connectionToWsUrl(c: Connection): string {
  return `ws://${c.host}:${c.port}/ws`;
}

export async function saveConnection(store: ConnStore, c: Connection): Promise<void> {
  await store.set(KEY, JSON.stringify(c));
}

export async function loadConnection(store: ConnStore): Promise<Connection | null> {
  const raw = await store.get(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Connection;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ipad/connection.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/connection.ts tests/ipad/connection.test.ts
git commit -m "feat: #73 iPad connection config (parse/validate/persist)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Connection probe (`probe.ts`) + wire `App.tsx`

**Files:**
- Create: `apps/ipad/src/probe.ts`
- Test: `tests/ipad/probe.test.ts`
- Modify: `apps/ipad/src/App.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `Connection` + `connectionToWsUrl` (Task 3); `createWebSocketTransport({ url, token })` from `@watchtower/transport` returning `WatchtowerBridge & { close() }`; the bridge's `invoke('listInstances', {})` → `{ instances: InstanceView[] }` and `on('stateChanged', handler) => () => void`.
- Produces: `probeInstances(bridge): Promise<unknown[]>` and `watchState(bridge, cb): () => void`.

- [ ] **Step 1: Write the failing tests (fake bridge — real interface, fake impl)**

```ts
// tests/ipad/probe.test.ts
import { describe, it, expect, vi } from 'vitest';
import { probeInstances, watchState } from '../../apps/ipad/src/probe.js';

function fakeBridge(over: Partial<{ invoke: any; on: any }> = {}) {
  return {
    invoke: over.invoke ?? vi.fn().mockResolvedValue({ instances: [{ id: 'a' }, { id: 'b' }] }),
    on: over.on ?? vi.fn().mockReturnValue(() => {}),
  };
}

describe('probeInstances', () => {
  it('calls listInstances and returns the instances array', async () => {
    const bridge = fakeBridge();
    const out = await probeInstances(bridge as never);
    expect(bridge.invoke).toHaveBeenCalledWith('listInstances', {});
    expect(out).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('propagates an invoke rejection', async () => {
    const bridge = fakeBridge({ invoke: vi.fn().mockRejectedValue(new Error('unauthorized')) });
    await expect(probeInstances(bridge as never)).rejects.toThrow('unauthorized');
  });
});

describe('watchState', () => {
  it('subscribes to stateChanged and forwards the unsubscribe', () => {
    const unsub = vi.fn();
    const on = vi.fn().mockReturnValue(unsub);
    const bridge = fakeBridge({ on });
    const cb = vi.fn();
    const off = watchState(bridge as never, cb);
    expect(on).toHaveBeenCalledWith('stateChanged', cb);
    off();
    expect(unsub).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ipad/probe.test.ts`
Expected: FAIL — cannot resolve `probe.js`.

- [ ] **Step 3: Implement `apps/ipad/src/probe.ts`**

```ts
type Probable = {
  invoke(kind: string, payload: unknown): Promise<unknown>;
  on(kind: string, handler: (p: unknown) => void): () => void;
};

export async function probeInstances(bridge: Probable): Promise<unknown[]> {
  const res = (await bridge.invoke('listInstances', {})) as { instances?: unknown[] };
  return res.instances ?? [];
}

export function watchState(bridge: Probable, cb: (p: unknown) => void): () => void {
  return bridge.on('stateChanged', cb);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ipad/probe.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Replace `apps/ipad/src/App.tsx` with the proof screen (thin UI — verified manually, not unit-tested)**

```tsx
import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { createWebSocketTransport } from '@watchtower/transport';
import {
  parseConnection, connectionToWsUrl, loadConnection, saveConnection, type Connection,
} from './connection.js';
import { probeInstances, watchState } from './probe.js';

const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

export function App() {
  const [form, setForm] = useState({ host: '', port: '7445', token: '' });
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [instances, setInstances] = useState<unknown[]>([]);
  const [pushes, setPushes] = useState(0);

  useEffect(() => {
    void loadConnection(store).then((c) => {
      if (c) setForm({ host: c.host, port: String(c.port), token: c.token });
    });
  }, []);

  async function connect() {
    setError(null);
    const parsed = parseConnection(form);
    if (!parsed.ok) { setError(parsed.error); return; }
    const c: Connection = parsed.value;
    await saveConnection(store, c);
    setStatus('connecting');
    try {
      const bridge = createWebSocketTransport({ url: connectionToWsUrl(c), token: c.token });
      const list = await probeInstances(bridge);
      setInstances(list);
      watchState(bridge, () => setPushes((n) => n + 1));
      setStatus('connected');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Watchtower iPad — skeleton</h1>
      <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <input placeholder="Mac LAN host" value={form.host}
          onChange={(e) => setForm({ ...form, host: e.target.value })} />
        <input placeholder="port" value={form.port}
          onChange={(e) => setForm({ ...form, port: e.target.value })} />
        <input placeholder="token" value={form.token}
          onChange={(e) => setForm({ ...form, token: e.target.value })} />
        <button onClick={() => void connect()}>Connect</button>
      </div>
      <p>status: <b>{status}</b>{error ? ` — ${error}` : ''}</p>
      <p>pushes received: {pushes}</p>
      <ul>{instances.map((i, n) => <li key={n}>{JSON.stringify(i)}</li>)}</ul>
    </main>
  );
}
```

- [ ] **Step 6: Verify it builds + typechecks + suite green**

```bash
npm run build --workspace @watchtower/ipad
npx tsc -p apps/ipad/tsconfig.json --noEmit
npm test    # 625 + 5 = 630 passing
```
Expected: build OK, typecheck clean, **630** passing.

- [ ] **Step 7: (Optional) prove in a desktop browser before Capacitor**

Run the Mac orchestrator with `WATCHTOWER_WS_HOST=auto npm run dev`, note the logged connect string, then `npm run dev --workspace @watchtower/ipad` (Vite serves the iPad app in your desktop browser) and connect using the logged host/port/token. This proves the transport path with zero Apple spend (same technique as #68). Document the result; not a gate.

- [ ] **Step 8: Commit**

```bash
git add apps/ipad/src/probe.ts tests/ipad/probe.test.ts apps/ipad/src/App.tsx
git commit -m "feat: #73 iPad proof screen — connect, listInstances round-trip, push counter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Capacitor iOS shell + ATS + build/sign runbook (manual acceptance)

**Files:**
- Create: `apps/ipad/capacitor.config.ts`, `apps/ipad/ios/` (generated), `apps/ipad/README.md`
- Modify: `apps/ipad/ios/App/App/Info.plist` (ATS exception for the LAN `ws://`)

**Interfaces:**
- Consumes: the built `apps/ipad/dist` (Task 2/4) as Capacitor `webDir`.
- Produces: an installable iOS app project; the documented pipeline.

- [ ] **Step 1: Create `apps/ipad/capacitor.config.ts`**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cz.greencode.watchtower.ipad',
  appName: 'Watchtower',
  webDir: 'dist',
};

export default config;
```

- [ ] **Step 2: Generate the iOS project**

```bash
cd apps/ipad
npm run build           # ensure dist/ exists first
npx cap add ios
npx cap sync ios
```
Expected: `apps/ipad/ios/` created; `cap sync` copies `dist/` into the native project with no errors.

- [ ] **Step 3: Add the ATS exception so the webview may open a plaintext `ws://` LAN connection**

In `apps/ipad/ios/App/App/Info.plist`, add (a webview blocks insecure connections by default; this allows local networking for the skeleton — documented as skeleton-only, replaced by Tailscale/TLS in #72):
```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>Watchtower connects to your Mac on the local network.</string>
```

- [ ] **Step 4: Write `apps/ipad/README.md` (the runbook)**

Document exactly:
1. **Mac side:** run the orchestrator reachable on the LAN — `WATCHTOWER_WS_HOST=auto npm run dev` (or set an explicit LAN IP). Copy the `[orchestrator] iPad connect → ws://<host>:<port>/ws  token: <token>` line it logs.
2. **Build the web app:** `npm run build --workspace @watchtower/ipad && npx cap sync ios` (from repo root, or `cd apps/ipad`).
3. **Sign & run:** `npx cap open ios` → in Xcode, Signing & Capabilities → select your **personal Apple ID team** → set bundle id `cz.greencode.watchtower.ipad` → select your connected iPad → Run.
4. **On the iPad:** enter the host/port/token from step 1, tap Connect.
5. **Caveats:** free-personal-team certs expire after **7 days** (re-run from Xcode to refresh); the Mac and iPad must be on the **same Wi-Fi**; this `ws://` + ATS-local-networking path is skeleton-only (Tailscale/TLS arrives in #72).

- [ ] **Step 5: Commit the native project + docs**

```bash
git add apps/ipad/capacitor.config.ts apps/ipad/ios apps/ipad/README.md package.json package-lock.json
git commit -m "feat: #73 Capacitor iOS shell + ATS local-networking + build/sign runbook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual acceptance (the real de-risk — cannot be unit-tested)**

Follow the README on a real iPad. Confirm:
- The app builds, signs with the personal team, and installs on the iPad.
- Entering the logged host/port/token and tapping Connect shows `status: connected` and the **live instance list** from the Mac.
- The **pushes counter** increments when instance state changes on the Mac (e.g., spawn/kill a session).

Record the outcome (screenshot/notes) in the PR. Acceptance = all three observed.

---

## Self-review against the spec

- **§2 scope** — connection screen (Task 4), `listInstances` round-trip (Task 4), `stateChanged` push (Task 4), documented build/sign (Task 5). ✓
- **§3 non-goals** — no carve / Tailscale / wake / real modules / paid account anywhere; ATS + LAN explicitly marked skeleton-only. ✓
- **§4 architecture** — `apps/ipad` workspace (Task 2), pure `connection`/`probe` + thin `App.tsx` (Tasks 3-4), reuse of `@watchtower/transport` + `@watchtower/shared`. ✓
- **§5 orchestrator change** — opt-in `WATCHTOWER_WS_HOST` (+ stable port + connect-info log), specific LAN IP not `0.0.0.0`, bearer-token auth reused, off-by-default (Task 1). Token surfaced via the **startup log line** rather than a Settings UI — a deliberate scope reduction for the skeleton (no IPC-contract churn); the Settings panel is deferred. ✓ (documented deviation)
- **§6 build/sign** — npm scripts + README runbook + free personal team + bundle id + min target (Tasks 2/5). ✓
- **§7 testing** — pure `connection`/`probe`/`remoteBind` TDD'd against fakes; React/Capacitor/device = manual acceptance; suite stays green. ✓
- **§8 risks** — ATS exception (Task 5), 7-day expiry (README), LAN exposure mitigated by token + specific-IP bind + env opt-in (Task 1). ✓
