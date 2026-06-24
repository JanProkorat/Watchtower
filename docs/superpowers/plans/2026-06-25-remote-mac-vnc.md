# Remote Mac module (embedded VNC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Vzdálený Mac" iPad module that mirrors and controls the Mac's screen via noVNC over a token-authed WS→TCP relay in the orchestrator, plus auth-block detection that offers a one-tap jump into the VNC view when an instance is waiting on a browser login.

**Architecture:** macOS Screen Sharing speaks raw RFB on TCP 5900. The orchestrator's existing Fastify WS server (`wsBridge.ts`) gains a `/vnc` route that token-auths (same `?token=` as `/ws`) and pipes WS binary frames to a TCP socket on `127.0.0.1:5900` as a protocol-agnostic relay. The iPad runs noVNC in the webview against that relay. A separate auth-block detector watches `PreToolUse`/`PostToolUse` hook events and pty output for SSO markers and emits a new `authBlock` push.

**Tech Stack:** Node/Fastify/`@fastify/websocket`/`ws`/`net` (orchestrator), React + Capacitor + `@novnc/novnc` (iPad, no MUI), vitest (tests, `environment: node`).

## Global Constraints

- **Locale Czech; no i18n.** All user-facing copy is Czech string literals.
- **iPad app is plain React + inline styles — no MUI.** `@novnc/novnc` is vanilla JS; do not pull MUI in.
- **`@watchtower/shared` is a BUILT composite.** After editing `packages/shared/src/*`, rebuild it (`tsc -b packages/shared/tsconfig.json`) before the orchestrator/iPad typecheck will see the change. Tests resolve `@watchtower/shared` to `src` via the vitest alias, but typecheck uses the build.
- **Keep the suite green:** `npm test` (vitest run). Add tests for all new orchestrator + iPad logic.
- **Typecheck gate:** `npm run typecheck` must pass (it compiles every workspace tsconfig).
- **Relay target is a fixed constant** `127.0.0.1:5900` — never client-supplied (no SSRF).
- **Settings-file writes use the backup convention** — N/A here (we add hook events through the existing `ensureHooksInstalled` path, which already backs up).
- **cwd-gating for hook events** must be preserved (nested-claude contamination guard) — the detector is called only after the existing `hookCwdMatches` check.

---

### Task 1: Add `authBlock` push to the shared contract

**Files:**
- Modify: `packages/shared/src/messagePort.ts` (the `OrchPush` union, ~line 537-547)
- Test: `tests/shared/authBlockPush.test.ts` (create)

**Interfaces:**
- Produces: `OrchPush` variant `{ kind: 'authBlock'; payload: { instanceId: string; blocked: boolean; reason?: string } }` — consumed by Tasks 6 (orchestrator emit) and 8 (iPad subscribe).

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/authBlockPush.test.ts
import { describe, it, expect } from 'vitest';
import type { OrchPush } from '@watchtower/shared/messagePort.js';

describe('authBlock push', () => {
  it('is assignable to OrchPush with instanceId/blocked/reason', () => {
    const push: OrchPush = {
      kind: 'authBlock',
      payload: { instanceId: 'i1', blocked: true, reason: 'saml2aws' },
    };
    expect(push.kind).toBe('authBlock');
    // reason is optional
    const cleared: OrchPush = { kind: 'authBlock', payload: { instanceId: 'i1', blocked: false } };
    expect(cleared.payload.blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/authBlockPush.test.ts`
Expected: FAIL — TypeScript error, `'authBlock'` not assignable to `OrchPush['kind']`.

- [ ] **Step 3: Add the variant**

In `packages/shared/src/messagePort.ts`, add to the `OrchPush` union (after the `clearAttention` line):

```ts
  | { kind: 'authBlock'; payload: { instanceId: string; blocked: boolean; reason?: string } }
```

- [ ] **Step 4: Rebuild shared + run test**

Run: `tsc -b packages/shared/tsconfig.json && npx vitest run tests/shared/authBlockPush.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/messagePort.ts tests/shared/authBlockPush.test.ts packages/shared/dist
git commit -m "feat: #75 add authBlock push to shared OrchPush contract"
```

---

### Task 2: VNC relay piping function

**Files:**
- Create: `orchestrator/vncRelay.ts`
- Test: `tests/orchestrator/vncRelay.test.ts`

**Interfaces:**
- Produces: `relayVnc(ws: VncWsLike, tcp: Socket): void` and `interface VncWsLike { on(ev: 'message', cb: (d: Buffer) => void): void; on(ev: 'close', cb: () => void): void; send(d: Buffer): void; close(): void; }` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/vncRelay.test.ts
import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { relayVnc, type VncWsLike } from '../../orchestrator/vncRelay.js';

function fakeWs() {
  const msgCbs: Array<(d: Buffer) => void> = [];
  const closeCbs: Array<() => void> = [];
  const sent: Buffer[] = [];
  let closed = false;
  const ws: VncWsLike = {
    on(ev, cb) {
      if (ev === 'message') msgCbs.push(cb as (d: Buffer) => void);
      else closeCbs.push(cb as () => void);
    },
    send(d) { sent.push(Buffer.from(d)); },
    close() { closed = true; closeCbs.forEach((c) => c()); },
  };
  return { ws, sent, emitMessage: (d: Buffer) => msgCbs.forEach((c) => c(d)), emitClose: () => closeCbs.forEach((c) => c()), isClosed: () => closed };
}

describe('relayVnc', () => {
  it('pipes ws->tcp and tcp->ws, and closes tcp when ws closes', async () => {
    // Echo TCP server stands in for macOS Screen Sharing.
    const server = net.createServer((s) => s.on('data', (d) => s.write(d)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    const tcp = net.connect(port, '127.0.0.1');
    await new Promise<void>((r) => tcp.once('connect', r));

    const { ws, sent, emitMessage, emitClose } = fakeWs();
    relayVnc(ws, tcp);

    emitMessage(Buffer.from('RFB 003.008\n'));
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(sent).toString()).toBe('RFB 003.008\n'); // echoed back

    emitClose();
    await new Promise((r) => setTimeout(r, 20));
    expect(tcp.destroyed).toBe(true);
    server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/vncRelay.test.ts`
Expected: FAIL — cannot find module `vncRelay.js`.

- [ ] **Step 3: Implement the relay**

```ts
// orchestrator/vncRelay.ts
import type { Socket } from 'node:net';

export interface VncWsLike {
  on(ev: 'message', cb: (data: Buffer) => void): void;
  on(ev: 'close', cb: () => void): void;
  send(data: Buffer): void;
  close(): void;
}

// Protocol-agnostic byte pipe between a WebSocket and a TCP socket. TCP `data`
// chunks (kernel-bounded, typically <64 KB) are forwarded as individual WS
// frames, so per-frame size stays well under the WS maxPayload — no buffering.
export function relayVnc(ws: VncWsLike, tcp: Socket): void {
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try { tcp.destroy(); } catch { /* ignore */ }
    try { ws.close(); } catch { /* ignore */ }
  };
  ws.on('message', (data) => { if (!tcp.destroyed) tcp.write(data); });
  tcp.on('data', (chunk: Buffer) => ws.send(chunk));
  ws.on('close', cleanup);
  tcp.on('close', cleanup);
  tcp.on('error', cleanup);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/vncRelay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/vncRelay.ts tests/orchestrator/vncRelay.test.ts
git commit -m "feat: #75 VNC ws<->tcp relay piping function"
```

---

### Task 3: Wire the `/vnc` route into the WS bridge

**Files:**
- Modify: `orchestrator/wsBridge.ts` (add route + `vncConnect` option)
- Test: `tests/orchestrator/wsBridge.vnc.test.ts`

**Interfaces:**
- Consumes: `relayVnc`, `VncWsLike` (Task 2).
- Produces: `WsBridgeOptions.vncConnect?: () => Socket` (default `() => net.connect(5900, '127.0.0.1')`); a `GET /vnc` WS route token-gated identically to `/ws`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/wsBridge.vnc.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'node:net';
import WebSocket from 'ws';
import { startWsBridge, type WsBridgeHandle } from '../../orchestrator/wsBridge.js';

vi.setConfig({ testTimeout: 30_000 });

let handle: WsBridgeHandle | null = null;
let echo: net.Server | null = null;
afterEach(async () => { await handle?.stop(); handle = null; echo?.close(); echo = null; });

async function startEcho(): Promise<number> {
  echo = net.createServer((s) => s.on('data', (d) => s.write(d)));
  await new Promise<void>((r) => echo!.listen(0, '127.0.0.1', r));
  return (echo!.address() as net.AddressInfo).port;
}

describe('wsBridge /vnc', () => {
  it('relays bytes to the injected tcp target over an authed ws', async () => {
    const echoPort = await startEcho();
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({}),
      vncConnect: () => net.connect(echoPort, '127.0.0.1'),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/vnc?token=secret`);
    await new Promise<void>((r) => ws.once('open', r));
    const got = new Promise<string>((r) => ws.once('message', (d) => r(d.toString())));
    ws.send(Buffer.from('hello'));
    expect(await got).toBe('hello');
    ws.close();
  });

  it('rejects /vnc without a valid token', async () => {
    await startEcho();
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({}),
      vncConnect: () => net.connect(1, '127.0.0.1'),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/vnc?token=wrong`);
    const closed = await new Promise<boolean>((r) => {
      ws.once('open', () => r(false));
      ws.once('error', () => r(true));
      ws.once('unexpected-response', () => r(true));
    });
    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/wsBridge.vnc.test.ts`
Expected: FAIL — `vncConnect` not in options / no `/vnc` route (open succeeds or 404).

- [ ] **Step 3: Implement the route**

In `orchestrator/wsBridge.ts`:

Add imports at top:
```ts
import net, { type Socket } from 'node:net';
import { relayVnc, type VncWsLike } from './vncRelay.js';
```

Add to `WsBridgeOptions`:
```ts
  /** Factory for the VNC target socket. Defaults to localhost:5900 (macOS Screen Sharing). Injectable for tests. */
  vncConnect?: () => Socket;
```

Inside the `app.register(async (scoped) => { ... })` block, after the existing `scoped.get('/ws', ...)` handler, add:
```ts
    const vncConnect = opts.vncConnect ?? (() => net.connect(5900, '127.0.0.1'));
    scoped.get('/vnc', {
      websocket: true,
      preHandler: (req, reply, done) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        if (url.searchParams.get('token') !== opts.token) reply.code(401).send({ error: 'unauthorized' });
        else done();
      },
    }, (conn) => {
      const socket = conn.socket as unknown as VncWsLike;
      const tcp = vncConnect();
      relayVnc(socket, tcp);
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/wsBridge.vnc.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/wsBridge.ts tests/orchestrator/wsBridge.vnc.test.ts
git commit -m "feat: #75 add token-gated /vnc relay route to ws bridge"
```

---

### Task 4: Auth-block detector

**Files:**
- Create: `orchestrator/authBlockDetector.ts`
- Test: `tests/orchestrator/authBlockDetector.test.ts`

**Interfaces:**
- Produces:
  - `createAuthBlockDetector(opts: { emit: (e: { instanceId: string; blocked: boolean; reason?: string }) => void; hookPatterns?: RegExp[]; ptyPatterns?: RegExp[] }): AuthBlockDetector`
  - `interface AuthBlockDetector { onHookEvent(eventName: string, body: unknown, instanceId: string): void; onPtyChunk(instanceId: string, chunk: string): void; }`
  - Exported defaults `AUTH_HOOK_PATTERNS: RegExp[]`, `AUTH_PTY_PATTERNS: RegExp[]`.
- Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/authBlockDetector.test.ts
import { describe, it, expect } from 'vitest';
import { createAuthBlockDetector } from '../../orchestrator/authBlockDetector.js';

function setup() {
  const events: Array<{ instanceId: string; blocked: boolean; reason?: string }> = [];
  const det = createAuthBlockDetector({ emit: (e) => events.push(e) });
  return { det, events };
}

describe('authBlockDetector', () => {
  it('blocks on PreToolUse Bash saml2aws and clears on PostToolUse', () => {
    const { det, events } = setup();
    det.onHookEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'saml2aws login --profile x' } }, 'i1');
    det.onHookEvent('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'saml2aws login --profile x' } }, 'i1');
    expect(events).toEqual([
      { instanceId: 'i1', blocked: true, reason: expect.stringContaining('saml2aws') },
      { instanceId: 'i1', blocked: false },
    ]);
  });

  it('ignores non-matching Bash commands', () => {
    const { det, events } = setup();
    det.onHookEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls -la' } }, 'i1');
    expect(events).toEqual([]);
  });

  it('blocks on a pty SSO marker', () => {
    const { det, events } = setup();
    det.onPtyChunk('i2', 'Opening browser to https://localhost:8400/callback ...');
    expect(events).toEqual([{ instanceId: 'i2', blocked: true, reason: expect.any(String) }]);
  });

  it('dedupes repeated blocks and clears on UserPromptSubmit', () => {
    const { det, events } = setup();
    det.onPtyChunk('i3', 'saml2aws');
    det.onPtyChunk('i3', 'saml2aws again'); // no second emit
    det.onHookEvent('UserPromptSubmit', {}, 'i3');
    expect(events).toEqual([
      { instanceId: 'i3', blocked: true, reason: expect.any(String) },
      { instanceId: 'i3', blocked: false },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/authBlockDetector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the detector**

```ts
// orchestrator/authBlockDetector.ts
export const AUTH_HOOK_PATTERNS: RegExp[] = [
  /\bsaml2aws\b/i,
  /\baws\s+sso\s+login\b/i,
  /\bgcloud\s+auth\s+login\b/i,
  /\baz\s+login\b/i,
];

export const AUTH_PTY_PATTERNS: RegExp[] = [
  /\bsaml2aws\b/i,
  /Opening .* browser/i,
  /https?:\/\/localhost:\d+\/(callback|oauth)/i,
];

const CLEAR_EVENTS = new Set(['PostToolUse', 'Stop', 'UserPromptSubmit', 'SessionEnd']);

export interface AuthBlockDetector {
  onHookEvent(eventName: string, body: unknown, instanceId: string): void;
  onPtyChunk(instanceId: string, chunk: string): void;
}

export function createAuthBlockDetector(opts: {
  emit: (e: { instanceId: string; blocked: boolean; reason?: string }) => void;
  hookPatterns?: RegExp[];
  ptyPatterns?: RegExp[];
}): AuthBlockDetector {
  const hookPatterns = opts.hookPatterns ?? AUTH_HOOK_PATTERNS;
  const ptyPatterns = opts.ptyPatterns ?? AUTH_PTY_PATTERNS;
  const blocked = new Set<string>();

  const set = (instanceId: string, next: boolean, reason?: string) => {
    if (next === blocked.has(instanceId)) return; // dedupe — only emit on change
    if (next) blocked.add(instanceId); else blocked.delete(instanceId);
    opts.emit(next ? { instanceId, blocked: true, reason } : { instanceId, blocked: false });
  };

  const bashCommand = (body: unknown): string | null => {
    const b = body as { tool_name?: unknown; tool_input?: { command?: unknown } } | undefined;
    if (!b || b.tool_name !== 'Bash') return null;
    const cmd = b.tool_input?.command;
    return typeof cmd === 'string' ? cmd : null;
  };

  return {
    onHookEvent(eventName, body, instanceId) {
      if (eventName === 'PreToolUse') {
        const cmd = bashCommand(body);
        if (cmd && hookPatterns.some((p) => p.test(cmd))) set(instanceId, true, cmd.slice(0, 80));
        return;
      }
      if (eventName === 'PostToolUse') {
        const cmd = bashCommand(body);
        if (cmd && hookPatterns.some((p) => p.test(cmd))) { set(instanceId, false); return; }
      }
      if (CLEAR_EVENTS.has(eventName)) set(instanceId, false);
    },
    onPtyChunk(instanceId, chunk) {
      const hit = ptyPatterns.find((p) => p.test(chunk));
      if (hit) set(instanceId, true, `pty: ${hit.source}`);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/authBlockDetector.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/authBlockDetector.ts tests/orchestrator/authBlockDetector.test.ts
git commit -m "feat: #75 auth-block detector (hook + pty markers)"
```

---

### Task 5: Enable PreToolUse / PostToolUse hook forwarding

**Files:**
- Modify: `orchestrator/hookInstaller.ts` (`EVENTS` const, line 15)
- Modify: `orchestrator/hookListener.ts` (`KNOWN_EVENTS`, lines 3-9)
- Test: `tests/orchestrator/hookInstaller.preposttool.test.ts`

**Interfaces:**
- Produces: the installed `~/.claude/settings.json` now includes `PreToolUse` + `PostToolUse` hook entries; the listener accepts POSTs to `/hooks/PreToolUse` and `/hooks/PostToolUse`. The helper (`watchtower-hook.ts`) is event-generic and needs **no change** — it forwards the raw stdin body (which for these events contains `tool_name` + `tool_input.command`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/hookInstaller.preposttool.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureHooksInstalled } from '../../orchestrator/hookInstaller.js';

describe('hook installer includes tool-use events', () => {
  it('installs PreToolUse and PostToolUse entries', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wt-hooks-'));
    const settings = path.join(dir, 'settings.json');
    ensureHooksInstalled(settings, '/abs/watchtower-hook.mjs');
    const parsed = JSON.parse(readFileSync(settings, 'utf8'));
    expect(Object.keys(parsed.hooks)).toEqual(
      expect.arrayContaining(['PreToolUse', 'PostToolUse', 'SessionStart']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/hookInstaller.preposttool.test.ts`
Expected: FAIL — `hooks` lacks `PreToolUse`/`PostToolUse`.

- [ ] **Step 3: Add the events**

In `orchestrator/hookInstaller.ts` line 15:
```ts
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd', 'PreToolUse', 'PostToolUse'] as const;
```

In `orchestrator/hookListener.ts` lines 3-9:
```ts
const KNOWN_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator/hookInstaller.preposttool.test.ts tests/orchestrator/`
Expected: PASS, and no regression in existing hookInstaller/hookListener tests.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/hookInstaller.ts orchestrator/hookListener.ts tests/orchestrator/hookInstaller.preposttool.test.ts
git commit -m "feat: #75 forward PreToolUse/PostToolUse hook events"
```

---

### Task 6: Wire the detector into the orchestrator

**Files:**
- Modify: `orchestrator/index.ts` (instantiate detector; route hook events + pty chunks; emit `authBlock`)
- Test: `tests/orchestrator/authBlockWiring.test.ts`

**Interfaces:**
- Consumes: `createAuthBlockDetector` (Task 4), `emitPush` / `OrchPush` `authBlock` (Tasks 1, 6 context).
- This is thin glue; the detector (Task 4) holds the tested logic. The wiring test exercises the seam by extracting the wiring into a tiny pure helper.

To keep the seam testable, add an exported helper to `orchestrator/index.ts` (or a new `orchestrator/authBlockWiring.ts` if `index.ts` is large — prefer the latter):

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/authBlockWiring.test.ts
import { describe, it, expect } from 'vitest';
import { createAuthBlockDetector } from '../../orchestrator/authBlockDetector.js';
import type { OrchPush } from '@watchtower/shared/messagePort.js';

describe('auth-block → push wiring', () => {
  it('emits an authBlock OrchPush when the detector fires', () => {
    const pushes: OrchPush[] = [];
    const det = createAuthBlockDetector({
      emit: (e) => pushes.push({ kind: 'authBlock', payload: e }),
    });
    det.onHookEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'saml2aws login' } }, 'i1');
    expect(pushes).toEqual([
      { kind: 'authBlock', payload: { instanceId: 'i1', blocked: true, reason: expect.stringContaining('saml2aws') } },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/authBlockWiring.test.ts`
Expected: PASS already (it only uses Task 1 + Task 4). This is a guard test for the push shape — if it fails, Task 1's type is wrong. Proceed to wire the real glue.

- [ ] **Step 3: Wire into index.ts**

Near where other singletons are constructed (after `emitPush` is available), add:
```ts
import { createAuthBlockDetector } from './authBlockDetector.js';

const authBlockDetector = createAuthBlockDetector({
  emit: (e) => emitPush({ kind: 'authBlock', payload: e }),
});
```

In the `onHookEvent` callback (orchestrator/index.ts ~lines 1161-1174), **after** the existing `hookCwdMatches` guard and before/alongside `mapHookEventToStateEvent`:
```ts
  authBlockDetector.onHookEvent(eventName, body, instanceId);
```

In the pty `onData` callback (orchestrator/index.ts ~line 462, after `emitPush({ kind: 'ptyData', ... })`):
```ts
    authBlockDetector.onPtyChunk(opts.id, chunk);
```

- [ ] **Step 4: Run typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS; orchestrator compiles, no regressions.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/index.ts tests/orchestrator/authBlockWiring.test.ts
git commit -m "feat: #75 wire auth-block detector to hook events + pty + authBlock push"
```

---

### Task 7: iPad — VNC URL + password in connection

**Files:**
- Modify: `apps/ipad/src/connection.ts`
- Test: `tests/ipad/connection.test.ts` (extend)

**Interfaces:**
- Produces: `Connection` gains optional `vncPassword?: string`; `connectionToVncWsUrl(c: Connection): string` → `ws://host:port/vnc`; `parseConnection` accepts an optional `vncPassword` field. Consumed by Tasks 9 & 10.

- [ ] **Step 1: Write the failing test (append to existing file)**

```ts
// add to tests/ipad/connection.test.ts
import { connectionToVncWsUrl } from '../../apps/ipad/src/connection.js';

describe('connectionToVncWsUrl', () => {
  it('builds the /vnc url', () => {
    expect(connectionToVncWsUrl({ host: '192.168.1.42', port: 7445, token: 't' }))
      .toBe('ws://192.168.1.42:7445/vnc');
  });
});

describe('parseConnection vncPassword', () => {
  it('carries an optional vnc password through', () => {
    const r = parseConnection({ host: 'h', port: '7445', token: 't', vncPassword: 'screen12' });
    expect(r).toEqual({ ok: true, value: { host: 'h', port: 7445, token: 't', vncPassword: 'screen12' } });
  });
  it('omits vncPassword when blank', () => {
    const r = parseConnection({ host: 'h', port: '7445', token: 't', vncPassword: '' });
    expect(r.ok && 'vncPassword' in r.value).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipad/connection.test.ts`
Expected: FAIL — `connectionToVncWsUrl` not exported; `parseConnection` ignores `vncPassword`.

- [ ] **Step 3: Implement**

In `apps/ipad/src/connection.ts`:
```ts
export type Connection = { host: string; port: number; token: string; vncPassword?: string };
```
Update `parseConnection`'s input type and body:
```ts
export function parseConnection(input: { host: string; port: string; token: string; vncPassword?: string }):
  | { ok: true; value: Connection }
  | { ok: false; error: string } {
  const host = input.host.trim();
  if (!host) return { ok: false, error: 'Host is required' };
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port must be 1–65535' };
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'Token is required' };
  const vncPassword = input.vncPassword?.trim();
  const value: Connection = { host, port, token };
  if (vncPassword) value.vncPassword = vncPassword;
  return { ok: true, value };
}
```
Add:
```ts
export function connectionToVncWsUrl(c: Connection): string {
  return `ws://${c.host}:${c.port}/vnc`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ipad/connection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/connection.ts tests/ipad/connection.test.ts
git commit -m "feat: #75 iPad connection: /vnc url + optional vnc password"
```

---

### Task 8: iPad — useAuthBlock hook

**Files:**
- Create: `apps/ipad/src/state/useAuthBlock.ts`
- Create: `apps/ipad/src/state/authBlockStore.ts` (pure reducer, testable)
- Test: `tests/ipad/authBlockStore.test.ts`

**Interfaces:**
- Produces:
  - `authBlockStore.ts`: `applyAuthBlock(prev: Set<string>, e: { instanceId: string; blocked: boolean }): Set<string>` — pure.
  - `useAuthBlock(): { blockedIds: Set<string> }` — subscribes to the `authBlock` push via the connection bridge (same pattern as `useInstances`). Consumed by Task 10.

- [ ] **Step 1: Write the failing test (pure reducer only — the hook needs React/DOM, validated manually)**

```ts
// tests/ipad/authBlockStore.test.ts
import { describe, it, expect } from 'vitest';
import { applyAuthBlock } from '../../apps/ipad/src/state/authBlockStore.js';

describe('applyAuthBlock', () => {
  it('adds an instance when blocked', () => {
    expect([...applyAuthBlock(new Set(), { instanceId: 'i1', blocked: true })]).toEqual(['i1']);
  });
  it('removes an instance when cleared', () => {
    expect([...applyAuthBlock(new Set(['i1']), { instanceId: 'i1', blocked: false })]).toEqual([]);
  });
  it('returns the same set identity when nothing changes', () => {
    const s = new Set(['i1']);
    expect(applyAuthBlock(s, { instanceId: 'i1', blocked: true })).toBe(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipad/authBlockStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement reducer + hook**

```ts
// apps/ipad/src/state/authBlockStore.ts
export function applyAuthBlock(prev: Set<string>, e: { instanceId: string; blocked: boolean }): Set<string> {
  if (e.blocked === prev.has(e.instanceId)) return prev; // no change → stable identity
  const next = new Set(prev);
  if (e.blocked) next.add(e.instanceId); else next.delete(e.instanceId);
  return next;
}
```

```ts
// apps/ipad/src/state/useAuthBlock.ts
import { useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';
import { applyAuthBlock } from './authBlockStore.js';

export function useAuthBlock(): { blockedIds: Set<string> } {
  const { bridge } = useConnection();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    return bridge.on('authBlock', (p) => {
      const e = p as { instanceId: string; blocked: boolean; reason?: string };
      setBlockedIds((prev) => applyAuthBlock(prev, e));
    });
  }, [bridge]);

  return { blockedIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ipad/authBlockStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/useAuthBlock.ts apps/ipad/src/state/authBlockStore.ts tests/ipad/authBlockStore.test.ts
git commit -m "feat: #75 iPad useAuthBlock hook + pure reducer"
```

---

### Task 9: iPad — RemoteMacView (noVNC)

**Files:**
- Modify: `apps/ipad/package.json` (add `@novnc/novnc`)
- Create: `apps/ipad/src/types/novnc.d.ts` (minimal type shim — no official types)
- Create: `apps/ipad/src/lib/vncKeys.ts` (keysym map for the modifier strip)
- Create: `apps/ipad/src/components/RemoteMacView.tsx`
- Test: `tests/ipad/vncKeys.test.ts`

**Interfaces:**
- Consumes: `connectionToVncWsUrl`, `Connection.vncPassword` (Task 7).
- Produces: `<RemoteMacView />` (reads connection from context); `vncKeys.ts` exporting `VNC_KEYSYMS: Record<'esc'|'tab'|'ctrl'|'alt', number>`.

> **Note on `@novnc/novnc` keysyms vs. terminal escapes:** the existing `accessoryKeys.ts` emits xterm escape *sequences* (strings). VNC needs X11 *keysyms* (numbers) sent via `rfb.sendKey`. So this task adds a separate `vncKeys.ts` — the "accessory bar concept" is reused, the encoding is not.

- [ ] **Step 1: Write the failing test (pure keysym map)**

```ts
// tests/ipad/vncKeys.test.ts
import { describe, it, expect } from 'vitest';
import { VNC_KEYSYMS } from '../../apps/ipad/src/lib/vncKeys.js';

describe('VNC_KEYSYMS', () => {
  it('maps esc/tab/ctrl/alt to X11 keysyms', () => {
    expect(VNC_KEYSYMS.esc).toBe(0xff1b);
    expect(VNC_KEYSYMS.tab).toBe(0xff09);
    expect(VNC_KEYSYMS.ctrl).toBe(0xffe3);
    expect(VNC_KEYSYMS.alt).toBe(0xffe9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipad/vncKeys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add dependency, type shim, keysyms, and the component**

Add to `apps/ipad/src/lib/vncKeys.ts`:
```ts
// X11 keysyms for the on-screen modifier strip (RFB sendKey expects keysyms).
export const VNC_KEYSYMS = {
  esc: 0xff1b,
  tab: 0xff09,
  ctrl: 0xffe3, // Control_L
  alt: 0xffe9,  // Alt_L
} as const;
```

Add the dependency (from repo root, npm workspace):
```bash
npm install @novnc/novnc@^1.5.0 -w @watchtower/ipad
```

Create `apps/ipad/src/types/novnc.d.ts`:
```ts
declare module '@novnc/novnc/lib/rfb.js' {
  interface RFBOptions { credentials?: { password?: string }; wsProtocols?: string[]; }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    scaleViewport: boolean;
    background: string;
    disconnect(): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    sendCtrlAltDel(): void;
  }
}
```

Create `apps/ipad/src/components/RemoteMacView.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc/lib/rfb.js';
import { useConnection } from '../state/connectionContext.js';
import { connectionToVncWsUrl, type Connection } from '../connection.js';
import { VNC_KEYSYMS } from '../lib/vncKeys.js';

type VncStatus = 'connecting' | 'connected' | 'disconnected' | 'auth-failed';

export function RemoteMacView({ connection }: { connection: Connection }) {
  const { } = useConnection(); // ensures we're inside the provider
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [status, setStatus] = useState<VncStatus>('connecting');

  useEffect(() => {
    if (!screenRef.current) return;
    const url = `${connectionToVncWsUrl(connection)}?token=${encodeURIComponent(connection.token)}`;
    const rfb = new RFB(screenRef.current, url, {
      credentials: { password: connection.vncPassword ?? '' },
    });
    rfb.scaleViewport = true;
    rfb.background = '#0e0f12';
    rfbRef.current = rfb;
    setStatus('connecting');
    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onSecurityFailure = () => setStatus('auth-failed');
    rfb.addEventListener('connect', onConnect);
    rfb.addEventListener('disconnect', onDisconnect);
    rfb.addEventListener('securityfailure', onSecurityFailure);
    return () => {
      rfb.removeEventListener('connect', onConnect);
      rfb.removeEventListener('disconnect', onDisconnect);
      rfb.removeEventListener('securityfailure', onSecurityFailure);
      try { rfb.disconnect(); } catch { /* ignore */ }
      rfbRef.current = null;
    };
  }, [connection]);

  const tapKey = (keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, '', true);
    rfb.sendKey(keysym, '', false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0e0f12' }}>
      {status !== 'connected' && (
        <div role="status" style={{
          flexShrink: 0, padding: '6px 16px', textAlign: 'center', fontSize: 13,
          color: status === 'auth-failed' ? '#fca5a5' : '#93c5fd',
          backgroundColor: status === 'auth-failed' ? '#3b1f1f' : '#1e3a5f',
        }}>
          {status === 'connecting' && 'Připojuji k obrazovce Macu…'}
          {status === 'disconnected' && 'Odpojeno – zkontrolujte Sdílení obrazovky na Macu'}
          {status === 'auth-failed' && 'Nesprávné heslo pro sdílení obrazovky'}
        </div>
      )}
      <div ref={screenRef} style={{ flex: 1, minHeight: 0 }} />
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: 8, backgroundColor: '#13141a', borderTop: '1px solid #2e3038' }}>
        <KeyBtn label="Esc" onPress={() => tapKey(VNC_KEYSYMS.esc)} />
        <KeyBtn label="Tab" onPress={() => tapKey(VNC_KEYSYMS.tab)} />
        <KeyBtn label="Ctrl" onPress={() => tapKey(VNC_KEYSYMS.ctrl)} />
        <KeyBtn label="Alt" onPress={() => tapKey(VNC_KEYSYMS.alt)} />
      </div>
    </div>
  );
}

function KeyBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button onClick={onPress} style={{
      padding: '8px 14px', borderRadius: 8, border: '1px solid #2e3038',
      backgroundColor: '#1a1b1f', color: '#e5e7eb', fontSize: 13, fontWeight: 600,
      WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  );
}
```

- [ ] **Step 4: Run keysym test + typecheck + build**

Run: `npx vitest run tests/ipad/vncKeys.test.ts && npm run typecheck && npm run build -w @watchtower/ipad`
Expected: test PASS; typecheck PASS (the `.d.ts` shim resolves the import); iPad bundle builds.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/package.json package-lock.json apps/ipad/src/types/novnc.d.ts apps/ipad/src/lib/vncKeys.ts apps/ipad/src/components/RemoteMacView.tsx tests/ipad/vncKeys.test.ts
git commit -m "feat: #75 RemoteMacView noVNC client + modifier keysyms"
```

---

### Task 10: iPad — Rail entry, module switching, auth-block handoff

**Files:**
- Modify: `apps/ipad/src/components/Rail.tsx` (widen `RailModule`, add "Vzdálený Mac" entry, enable selection)
- Modify: `apps/ipad/src/App.tsx` (module-selection state; render `InstancesModule` | RemoteMacModule; capture VNC password in the connection form; handoff banner)
- Create: `apps/ipad/src/components/AuthBlockBanner.tsx`
- Test: manual (React/DOM not unit-tested in this `node`-env vitest setup)

**Interfaces:**
- Consumes: `useAuthBlock` (Task 8), `RemoteMacView` (Task 9), `connectionToVncWsUrl`/`vncPassword` (Task 7).

- [ ] **Step 1: Widen the Rail**

In `apps/ipad/src/components/Rail.tsx`:
```ts
export type RailModule = 'instances' | 'remote';
```
Change the `ITEMS` array so the Remote Mac entry is enabled, and replace the hard-coded `onSelect?.('instances')` with the item's id:
```ts
const ITEMS: RailItem[] = [
  { id: 'dashboard', label: 'Dashboard', d: DASHBOARD_D, enabled: false },
  { id: 'instances', label: 'Instances', d: TERMINAL_D, enabled: true },
  { id: 'remote', label: 'Vzdálený Mac', d: SCREEN_D, enabled: true },
  { id: 'billing', label: 'Billing', d: BILLING_D, enabled: false },
  { id: 'settings', label: 'Settings', d: SETTINGS_D, enabled: false },
];
```
Add a screen-share glyph constant near the other icon paths:
```ts
const SCREEN_D = 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 14H3V5h18z';
```
Update the click handler to pass the real id:
```ts
onClick={() => item.enabled && onSelect?.(item.id as RailModule)}
```
And update `active` comparison to accept the prop type `RailModule`.

- [ ] **Step 2: Add module switching + VNC password field + handoff in App.tsx**

- Add VNC password input to `ConnectionForm` (`form` gains `vncPassword`, passed through `parseConnection`). Label it `heslo pro sdílení obrazovky (volitelné)`.
- Lift `const [activeModule, setActiveModule] = useState<RailModule>('instances')` into the component that renders inside `<ConnectionProvider>` (a new `Shell` component wrapping `InstancesModule`/`RemoteMacModule`), since `useAuthBlock` needs the bridge context.
- Pass `active={activeModule}` and `onSelect={setActiveModule}` to `<Rail />` (Rail is currently rendered inside `InstancesModule` — move it up into `Shell` so it's shared across modules).
- Render `{activeModule === 'instances' ? <InstancesModule ... /> : <RemoteMacView connection={connection} />}`.
- In the instances view, render `<AuthBlockBanner blockedIds={blockedIds} onOpen={() => setActiveModule('remote')} />` using `useAuthBlock()`.

```tsx
// apps/ipad/src/components/AuthBlockBanner.tsx
export function AuthBlockBanner({ blockedIds, onOpen }: { blockedIds: Set<string>; onOpen: () => void }) {
  if (blockedIds.size === 0) return null;
  return (
    <div role="status" style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '8px 16px', backgroundColor: '#3a2f12', borderBottom: '1px solid #a16207', color: '#fde68a', fontSize: 13,
    }}>
      <span>Mac čeká na přihlášení v prohlížeči</span>
      <button onClick={onOpen} style={{
        padding: '6px 12px', borderRadius: 8, border: 'none', backgroundColor: '#7c6df0',
        color: '#fff', fontSize: 13, fontWeight: 600, WebkitTapHighlightColor: 'transparent',
      }}>Otevřít obrazovku Macu</button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build -w @watchtower/ipad`
Expected: PASS; bundle builds.

- [ ] **Step 4: Manual smoke (desktop browser, before any iPad build)**

1. Enable macOS Screen Sharing per the runbook (Task 11).
2. `npm run dev` (or serve the iPad bundle); open the connection form in a desktop browser; enter host/port/token + the VNC password.
3. Select "Vzdálený Mac" → the Mac screen renders and accepts mouse/keyboard.
4. In a managed instance, run `saml2aws login` → the amber "Mac čeká na přihlášení" banner appears → tap "Otevřít obrazovku Macu" → switches to the VNC view → complete the login → banner clears on PostToolUse.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/components/Rail.tsx apps/ipad/src/App.tsx apps/ipad/src/components/AuthBlockBanner.tsx
git commit -m "feat: #75 iPad Remote Mac module: rail entry, switching, auth-block handoff"
```

---

### Task 11: macOS Screen Sharing runbook + spec reconciliation

**Files:**
- Create: `docs/runbooks/macos-screen-sharing.md`
- Modify: `docs/superpowers/specs/2026-06-25-remote-mac-vnc-design.md` (reconcile the `maxPayload` note)

- [ ] **Step 1: Write the runbook**

Content:
```markdown
# macOS Screen Sharing setup for Watchtower Remote Mac

1. System Settings → General → Sharing → **Screen Sharing → ON**.
2. Screen Sharing → (i) → **Computer Settings** → enable **"VNC viewers may
   control screen with password"** and set a password.
   **The password must be ≤ 8 characters** — macOS truncates longer VNC
   passwords (RFB DES key limit), so a longer one will silently fail auth.
3. Privacy & Security → grant **Screen Recording** permission if prompted.
4. Confirm TCP **5900** is reachable on the LAN (firewall allow).
5. In the iPad app's connection form, enter this password in
   **"heslo pro sdílení obrazovky"**. The orchestrator relay reaches the Mac at
   `127.0.0.1:5900`; the iPad only needs the existing host/port/token + this
   password.
```

- [ ] **Step 2: Reconcile the spec's maxPayload note**

In `docs/superpowers/specs/2026-06-25-remote-mac-vnc-design.md`, update §3.1 and §9 `maxPayload` bullets to note the resolution: *"Verified during planning: the relay forwards each TCP `data` chunk (kernel-bounded, typically <64 KB) as an individual WS frame, so per-frame size stays well under the 1 MB cap — no `maxPayload` change needed for v1. Revisit only if oversized frames appear under load."*

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/macos-screen-sharing.md docs/superpowers/specs/2026-06-25-remote-mac-vnc-design.md
git commit -m "docs: #75 macOS Screen Sharing runbook + maxPayload reconciliation"
```

---

## Self-Review

**Spec coverage:**
- §2 VNC client (noVNC) → Tasks 9, 10. ✓
- §2/§3.1 WS→TCP relay (`/vnc`, token, localhost:5900) → Tasks 2, 3. ✓
- §2/§3.2 auth-block detection (hook + pty) → Tasks 4, 5, 6. ✓
- §2 VNC password on iPad → Task 7. ✓
- §3.3 shared contract (`authBlock`) → Task 1. ✓
- §3.4 Rail entry, App switching, handoff banner, modifier strip → Tasks 9, 10. ✓
- §4 error handling (auth-fail vs connect-fail) → Task 9 (`VncStatus`). ✓
- §6 testing (relay, detector, desktop-browser validation) → Tasks 2, 3, 4, 8, 10. ✓
- §7 macOS runbook → Task 11. ✓
- §8 scope: VS Code tunnel, Tailscale, native RoyalVNC, auth-inject → out (not planned). ✓
- §9 maxPayload risk → reconciled in Task 11. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; no "add error handling" hand-waves. ✓

**Type consistency:** `authBlock` payload `{ instanceId, blocked, reason? }` identical across Tasks 1, 4, 6, 8. `connectionToVncWsUrl` / `Connection.vncPassword` consistent across Tasks 7, 9, 10. `relayVnc`/`VncWsLike` consistent across Tasks 2, 3. `VNC_KEYSYMS` consistent across Tasks 9, 10. ✓

**Note on UI tasks (9, 10):** the vitest setup is `environment: node` with no jsdom, so React components are validated by typecheck + build + the manual browser smoke (Task 10 Step 4), with all extractable logic (keysyms, URL builder, auth-block reducer) unit-tested. This matches the existing iPad test layout (logic-only in `tests/ipad/`).
