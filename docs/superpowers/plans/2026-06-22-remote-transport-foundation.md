# Remote Transport Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Watchtower React renderer run unchanged in a plain browser by adding a WebSocket transport to the orchestrator that speaks the existing IPC contract.

**Architecture:** The orchestrator already dispatches every request kind through `handleRequest()` and emits pushes via `api.push()` (MessagePort → electron-main → renderer). We add a second, parallel client path: a Fastify WebSocket server in the orchestrator that (a) routes inbound framed requests through the *same* `handleRequest()`, and (b) receives a fan-out of every push. On the renderer, `client/src/browserStub.ts` already installs a `WatchtowerBridge` when `window.watchtower` is absent — we swap its no-op for a real `WebSocketTransport` when a connection config is present, falling back to the existing stub otherwise. The Electron path is untouched.

**Tech Stack:** TypeScript, Node `utilityProcess` orchestrator, Fastify + `@fastify/websocket` (server), native browser `WebSocket` (client), vitest, `ws` (test client).

## Global Constraints

- Test suite must stay green and grow: **219+ tests; every code-adding task adds tests** (`npm test`, vitest).
- Typecheck must stay clean: `npx tsc -p orchestrator/tsconfig.json --noEmit` and `npx tsc -p client/tsconfig.json --noEmit` (ignore the documented pre-existing client drift — do not fix as a side quest).
- IPC naming convention is `<noun>:<verb>`; the WS wire contract reuses `IpcRequest` / `IpcResponse` / `IpcPush` from `shared/ipcContract.ts` verbatim — **do not** invent parallel kinds.
- `ELECTRON_ONLY_KINDS` (`chooseDirectory`, `sendTestNotification`, `openInVSCode`, `openExternalUrl`, `board:signIn`) have no orchestrator handler and must be rejected over WS with a clear error.
- Auth: every WS connection must present the orchestrator token (the same secret already minted for `orchestrator/hookListener.ts`). Browsers cannot set WS headers, so the token rides the URL query string.
- Backup convention, schema rules, and locale rules do not apply to this sub-project (no `~/.claude` writes, no DB schema, no UI copy).

---

## File Structure

**Create:**
- `shared/wsProtocol.ts` — wire envelope types + `encodeFrame`/`decodeFrame` JSON helpers shared by server and client.
- `orchestrator/wsBridge.ts` — Fastify WebSocket server: token auth, request routing to a supplied `handleRequest`, client registry, `broadcast(push)`.
- `client/src/transport/webSocketTransport.ts` — `WatchtowerBridge` implementation over a `WebSocket`.
- `client/src/transport/selectTransport.ts` — reads connection config (query string / `localStorage`) and decides Electron vs WebSocket vs no-op stub.
- Tests: `shared/wsProtocol.test.ts`, `orchestrator/wsBridge.test.ts`, `client/src/transport/webSocketTransport.test.ts`.

**Modify:**
- `shared/ipcContract.ts` — export `ELECTRON_ONLY_KINDS` (moved from `electron/ipc.ts`) so the orchestrator can import it without depending on `electron/`.
- `electron/ipc.ts` — import `ELECTRON_ONLY_KINDS` from `shared/ipcContract.ts` (delete the local copy).
- `orchestrator/index.ts` — introduce `emitPush(msg)` that fans out to both `api?.push(msg)` and the ws bridge; replace `api?.push(...)` call sites with `emitPush(...)`; export `handleRequest` for the bridge.
- `orchestrator/bootstrap.ts` — start `wsBridge` alongside the hook listener; pass it `handleRequest` and register its `broadcast` as a push sink.
- `client/src/browserStub.ts` — when `selectTransport()` returns a WebSocket config, install `WebSocketTransport`; otherwise keep the current no-op stub.

---

## Task 1: Move `ELECTRON_ONLY_KINDS` into the shared contract

**Files:**
- Modify: `shared/ipcContract.ts` (add export)
- Modify: `electron/ipc.ts:11-17` (import instead of redeclare)
- Test: `shared/ipcContract.test.ts` (create or extend)

**Interfaces:**
- Produces: `export const ELECTRON_ONLY_KINDS: ReadonlySet<IpcRequest['kind']>` from `shared/ipcContract.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/ipcContract.test.ts
import { describe, it, expect } from 'vitest';
import { ELECTRON_ONLY_KINDS } from './ipcContract';

describe('ELECTRON_ONLY_KINDS', () => {
  it('contains the electron-only kinds and not orchestrator kinds', () => {
    expect(ELECTRON_ONLY_KINDS.has('chooseDirectory')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('openInVSCode')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('board:signIn')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('projects:list')).toBe(false);
    expect(ELECTRON_ONLY_KINDS.has('listInstances')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/ipcContract.test.ts`
Expected: FAIL — `ELECTRON_ONLY_KINDS` is not exported from `./ipcContract`.

- [ ] **Step 3: Add the export to `shared/ipcContract.ts`**

Append near the type exports:

```typescript
export const ELECTRON_ONLY_KINDS: ReadonlySet<IpcRequest['kind']> = new Set([
  'chooseDirectory',
  'sendTestNotification',
  'openInVSCode',
  'openExternalUrl',
  'board:signIn',
]);
```

- [ ] **Step 4: Update `electron/ipc.ts` to import it**

Delete the local `const ELECTRON_ONLY_KINDS = new Set<IpcRequest['kind']>([...])` (lines 11-17) and add to the existing `shared/ipcContract` import:

```typescript
import { type IpcRequest, type IpcResponse, ELECTRON_ONLY_KINDS } from '../shared/ipcContract';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run shared/ipcContract.test.ts && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: PASS; no new tsc errors.

- [ ] **Step 6: Commit**

```bash
git add shared/ipcContract.ts shared/ipcContract.test.ts electron/ipc.ts
git commit -m "refactor: hoist ELECTRON_ONLY_KINDS into shared contract"
```

---

## Task 2: WebSocket wire protocol (`shared/wsProtocol.ts`)

**Files:**
- Create: `shared/wsProtocol.ts`
- Test: `shared/wsProtocol.test.ts`

**Interfaces:**
- Produces:
  - `type WsRequestFrame = { id: string } & IpcRequest` (renderer → orchestrator)
  - `type WsResponseFrame = { id: string; kind: IpcResponse['kind']; payload?: unknown; error?: string }`
  - `type WsPushFrame = { push: true } & IpcPush`
  - `type WsFrame = WsRequestFrame | WsResponseFrame | WsPushFrame`
  - `encodeFrame(frame: WsFrame): string`
  - `decodeFrame(raw: string): WsFrame` (throws on malformed input)
  - `isPushFrame(f): f is WsPushFrame` — the only guard needed; request vs response is disambiguated by direction (the server only receives requests, the client only receives responses/pushes).

- [ ] **Step 1: Write the failing test**

```typescript
// shared/wsProtocol.test.ts
import { describe, it, expect } from 'vitest';
import { encodeFrame, decodeFrame, isPushFrame } from './wsProtocol';

describe('wsProtocol', () => {
  it('round-trips a request frame', () => {
    const frame = { id: 'a1', kind: 'projects:list', payload: {} } as const;
    const decoded = decodeFrame(encodeFrame(frame as never));
    expect(isPushFrame(decoded)).toBe(false);
    expect(decoded).toEqual(frame);
  });

  it('detects a push frame', () => {
    const frame = { push: true, kind: 'ptyData', payload: { instanceId: 'x', chunk: 'hi' } } as const;
    const decoded = decodeFrame(encodeFrame(frame as never));
    expect(isPushFrame(decoded)).toBe(true);
  });

  it('throws on malformed JSON', () => {
    expect(() => decodeFrame('{not json')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/wsProtocol.test.ts`
Expected: FAIL — module `./wsProtocol` not found.

- [ ] **Step 3: Implement `shared/wsProtocol.ts`**

```typescript
import type { IpcRequest, IpcResponse, IpcPush } from './ipcContract';

export type WsRequestFrame = { id: string } & IpcRequest;
export type WsResponseFrame = {
  id: string;
  kind: IpcResponse['kind'];
  payload?: unknown;
  error?: string;
};
export type WsPushFrame = { push: true } & IpcPush;
export type WsFrame = WsRequestFrame | WsResponseFrame | WsPushFrame;

export function encodeFrame(frame: WsFrame): string {
  return JSON.stringify(frame);
}

export function decodeFrame(raw: string): WsFrame {
  const parsed = JSON.parse(raw) as WsFrame;
  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    throw new Error('invalid ws frame');
  }
  return parsed;
}

export function isPushFrame(f: WsFrame): f is WsPushFrame {
  return (f as WsPushFrame).push === true;
}
```

> Note: request and response frames both carry `id` + `kind`, so they cannot be told apart structurally. That is fine — each side knows by direction: the bridge (Task 4) only ever *receives* requests, and the client (Task 6) only ever *receives* responses and pushes. Neither needs a request/response guard; only `isPushFrame` is exported.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/wsProtocol.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/wsProtocol.ts shared/wsProtocol.test.ts
git commit -m "feat: add websocket wire protocol frames"
```

---

## Task 3: Push fan-out in the orchestrator (`emitPush`)

**Files:**
- Modify: `orchestrator/index.ts` (add `emitPush`, replace `api?.push(...)` call sites, export `handleRequest`)
- Test: `orchestrator/emitPush.test.ts`

**Interfaces:**
- Consumes: existing `api?.push(msg)` (PortApi) and the module-level `handleRequest`.
- Produces:
  - `export function setPushSink(sink: ((msg: OrchPush) => void) | null): void`
  - `export function emitPush(msg: OrchPush): void` — calls `api?.push(msg)` then the registered sink (if any).
  - `export { handleRequest }` (already a module function; add to exports).

- [ ] **Step 1: Write the failing test**

```typescript
// orchestrator/emitPush.test.ts
import { describe, it, expect, vi } from 'vitest';
import { emitPush, setPushSink } from './index';

describe('emitPush', () => {
  it('forwards a push to a registered sink', () => {
    const sink = vi.fn();
    setPushSink(sink);
    emitPush({ kind: 'badge', payload: { count: 3 } });
    expect(sink).toHaveBeenCalledWith({ kind: 'badge', payload: { count: 3 } });
    setPushSink(null);
  });

  it('does not throw when no sink is registered', () => {
    setPushSink(null);
    expect(() => emitPush({ kind: 'badge', payload: { count: 0 } })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run orchestrator/emitPush.test.ts`
Expected: FAIL — `emitPush`/`setPushSink` not exported.

- [ ] **Step 3: Implement in `orchestrator/index.ts`**

Add near the top-level `api` declaration:

```typescript
let pushSink: ((msg: OrchPush) => void) | null = null;

export function setPushSink(sink: ((msg: OrchPush) => void) | null): void {
  pushSink = sink;
}

export function emitPush(msg: OrchPush): void {
  api?.push(msg);
  try {
    pushSink?.(msg);
  } catch (err) {
    console.error('[orchestrator] push sink threw:', err);
  }
}
```

- [ ] **Step 4: Replace existing push call sites**

Replace every `api?.push(` in `orchestrator/index.ts` with `emitPush(` (e.g. the `ptyData` and `ptyExit` pushes in `spawnPtyForInstance`, plus notifier/slack/token-usage push sites). Verify with:

Run: `grep -n "api?.push(" orchestrator/index.ts`
Expected: no matches remain.

Ensure `handleRequest` is exported (change `async function handleRequest` usage so it is reachable — add `export` to its declaration, or add `export { handleRequest };` at the bottom of the file).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run orchestrator/emitPush.test.ts && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: PASS; no new tsc errors.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/index.ts orchestrator/emitPush.test.ts
git commit -m "feat: fan out orchestrator pushes through emitPush sink"
```

---

## Task 4: WebSocket bridge server (`orchestrator/wsBridge.ts`)

**Files:**
- Create: `orchestrator/wsBridge.ts`
- Test: `orchestrator/wsBridge.test.ts`
- Modify: `package.json` (add `@fastify/websocket` + dev `ws`/`@types/ws` if absent)

**Interfaces:**
- Consumes: `handleRequest(req: OrchRequest): Promise<unknown>`, `ELECTRON_ONLY_KINDS`, `decodeFrame`/`encodeFrame`.
- Produces:
  - `interface WsBridgeOptions { host: string; port: number; token: string; handleRequest: (req: OrchRequest) => Promise<unknown>; }`
  - `interface WsBridgeHandle { port: number; broadcast: (push: OrchPush) => void; stop: () => Promise<void>; clientCount: () => number; }`
  - `async function startWsBridge(opts: WsBridgeOptions): Promise<WsBridgeHandle>`

- [ ] **Step 1: Add dependencies**

Run: `npm install @fastify/websocket && npm install -D ws @types/ws`
Expected: installs succeed; `package.json` updated.

- [ ] **Step 2: Write the failing test**

```typescript
// orchestrator/wsBridge.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startWsBridge, type WsBridgeHandle } from './wsBridge';

let handle: WsBridgeHandle | null = null;
afterEach(async () => { await handle?.stop(); handle = null; });

function connect(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}

describe('wsBridge', () => {
  it('rejects connections without the token', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({ ok: true }),
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?token=wrong`);
    const closed = await new Promise<boolean>((res) => {
      ws.on('close', () => res(true));
      ws.on('open', () => res(false));
    });
    expect(closed).toBe(true);
  });

  it('routes a request through handleRequest and replies with the id', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async (req) => ({ echoed: req.kind }),
    });
    const ws = await connect(handle.port, 'secret');
    const reply = await new Promise<any>((res) => {
      ws.on('message', (d) => res(JSON.parse(d.toString())));
      ws.send(JSON.stringify({ id: 'r1', kind: 'projects:list', payload: {} }));
    });
    expect(reply).toEqual({ id: 'r1', kind: 'projects:list', payload: { echoed: 'projects:list' } });
    ws.close();
  });

  it('rejects electron-only kinds with an error frame', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({ ok: true }),
    });
    const ws = await connect(handle.port, 'secret');
    const reply = await new Promise<any>((res) => {
      ws.on('message', (d) => res(JSON.parse(d.toString())));
      ws.send(JSON.stringify({ id: 'r2', kind: 'openInVSCode', payload: { path: '/x' } }));
    });
    expect(reply.id).toBe('r2');
    expect(reply.error).toMatch(/not available/i);
    ws.close();
  });

  it('broadcasts pushes to connected clients', async () => {
    handle = await startWsBridge({
      host: '127.0.0.1', port: 0, token: 'secret',
      handleRequest: async () => ({ ok: true }),
    });
    const ws = await connect(handle.port, 'secret');
    const got = new Promise<any>((res) => ws.on('message', (d) => res(JSON.parse(d.toString()))));
    handle.broadcast({ kind: 'badge', payload: { count: 7 } });
    expect(await got).toEqual({ push: true, kind: 'badge', payload: { count: 7 } });
    ws.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run orchestrator/wsBridge.test.ts`
Expected: FAIL — module `./wsBridge` not found.

- [ ] **Step 4: Implement `orchestrator/wsBridge.ts`**

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { ELECTRON_ONLY_KINDS } from '../shared/ipcContract';
import { encodeFrame } from '../shared/wsProtocol';
import type { OrchRequest, OrchPush } from '../shared/messagePort';

export interface WsBridgeOptions {
  host: string;
  port: number;
  token: string;
  handleRequest: (req: OrchRequest) => Promise<unknown>;
}

export interface WsBridgeHandle {
  port: number;
  broadcast: (push: OrchPush) => void;
  stop: () => Promise<void>;
  clientCount: () => number;
}

export async function startWsBridge(opts: WsBridgeOptions): Promise<WsBridgeHandle> {
  const app: FastifyInstance = Fastify();
  await app.register(fastifyWebsocket);

  const clients = new Set<WebSocket>();

  app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (conn, req) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      if (url.searchParams.get('token') !== opts.token) {
        conn.socket.close(1008, 'unauthorized');
        return;
      }
      const socket = conn.socket as unknown as WebSocket;
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));

      socket.on('message', async (raw: Buffer) => {
        let frame: { id: string; kind: OrchRequest['kind']; payload: unknown };
        try {
          frame = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const reply = (payload?: unknown, error?: string) =>
          socket.send(JSON.stringify({ id: frame.id, kind: frame.kind, payload, error }));

        if (ELECTRON_ONLY_KINDS.has(frame.kind as never)) {
          reply(undefined, `kind "${frame.kind}" is not available over the remote connection`);
          return;
        }
        try {
          const payload = await opts.handleRequest({ id: frame.id, kind: frame.kind, payload: frame.payload } as OrchRequest);
          reply(payload);
        } catch (err) {
          reply(undefined, err instanceof Error ? err.message : String(err));
        }
      });
    });
  });

  const port = await app.listen({ host: opts.host, port: opts.port });
  const actualPort = (app.server.address() as { port: number }).port;

  return {
    port: actualPort,
    broadcast: (push: OrchPush) => {
      const frame = encodeFrame({ push: true, ...push } as never);
      for (const c of clients) {
        if (c.readyState === c.OPEN) c.send(frame);
      }
    },
    stop: () => app.close(),
    clientCount: () => clients.size,
  };
}
```

> If `app.listen` returns the address string rather than letting `port: 0` resolve, the `actualPort` read from `app.server.address()` is the source of truth — keep that line.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run orchestrator/wsBridge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/wsBridge.ts orchestrator/wsBridge.test.ts package.json package-lock.json
git commit -m "feat: orchestrator websocket bridge (auth, request routing, push broadcast)"
```

---

## Task 5: Wire the bridge into bootstrap

**Files:**
- Modify: `orchestrator/bootstrap.ts`
- Modify: `orchestrator/index.ts` (call `setPushSink` with the bridge broadcast after bootstrap)

**Interfaces:**
- Consumes: `startWsBridge`, the existing `token` and `portRange` already used by `startHookListener`, `handleRequest`, `setPushSink`.
- Produces: a started `WsBridgeHandle` available to `index.ts` so it can register `setPushSink(handle.broadcast)`.

- [ ] **Step 1: Write the failing test**

```typescript
// orchestrator/bootstrap.wsBridge.test.ts
import { describe, it, expect } from 'vitest';
import { bootstrap } from './bootstrap';

describe('bootstrap wires the ws bridge', () => {
  it('exposes a wsBridge handle with a port', async () => {
    const handle = await bootstrap({
      // use the same minimal opts shape existing bootstrap tests use;
      // see orchestrator/bootstrap.test.ts for the fixture factory.
    } as never);
    expect(typeof handle.wsBridge.port).toBe('number');
    await handle.wsBridge.stop();
  });
});
```

> Before writing this, open `orchestrator/bootstrap.test.ts` and reuse its existing options/fixture factory so the bootstrap call matches the real signature. Mirror its setup; only add the `wsBridge` assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run orchestrator/bootstrap.wsBridge.test.ts`
Expected: FAIL — `handle.wsBridge` is undefined.

- [ ] **Step 3: Start the bridge in `bootstrap.ts`**

Next to the `startHookListener({...})` call, add:

```typescript
const wsBridge = await startWsBridge({
  host: opts.wsHost ?? '127.0.0.1',
  port: opts.wsPort ?? 0,
  token,
  handleRequest,
});
```

Import `startWsBridge` from `./wsBridge` and `handleRequest` from `./index` (or pass `handleRequest` in via opts to avoid a cycle — prefer passing it in if `bootstrap` is imported by `index`). Add `wsBridge` to the object `bootstrap` returns, and add `wsHost?: string; wsPort?: number;` to its options type.

- [ ] **Step 4: Register the push sink in `index.ts`**

After `bootstrap(...)` resolves in the `parentPort` `init` handler, add:

```typescript
setPushSink(handle.wsBridge.broadcast);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run orchestrator/bootstrap.wsBridge.test.ts && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: PASS; no new tsc errors.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/bootstrap.ts orchestrator/index.ts orchestrator/bootstrap.wsBridge.test.ts
git commit -m "feat: start ws bridge in bootstrap and register push sink"
```

---

## Task 6: Client `WebSocketTransport`

**Files:**
- Create: `client/src/transport/webSocketTransport.ts`
- Test: `client/src/transport/webSocketTransport.test.ts`

**Interfaces:**
- Consumes: a `WebSocket`-like object (native browser `WebSocket`), `WatchtowerBridge` from `shared/ipcContract.ts`, `encodeFrame`/`decodeFrame`.
- Produces:
  - `function createWebSocketTransport(opts: { url: string; token: string; WebSocketImpl?: typeof WebSocket }): WatchtowerBridge & { close(): void }`
  - Correlates responses by `id`; dispatches push frames to handlers registered via `on(kind, handler)`; queues `invoke` calls until the socket is open.

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/transport/webSocketTransport.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWebSocketTransport } from './webSocketTransport';

// Minimal fake WebSocket that lets the test drive open/messages.
class FakeWS {
  static OPEN = 1;
  readyState = 0;
  OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  send(d: string) { this.sent.push(d); }
  close() {}
  _open() { this.readyState = 1; this.onopen?.(); }
  _recv(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

describe('WebSocketTransport', () => {
  it('resolves invoke with the matching response payload', async () => {
    let ws!: FakeWS;
    const t = createWebSocketTransport({
      url: 'ws://x', token: 't',
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    ws._open();
    const p = t.invoke('projects:list', {} as never);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.kind).toBe('projects:list');
    ws._recv({ id: sent.id, kind: 'projects:list', payload: { projects: [] } });
    await expect(p).resolves.toEqual({ projects: [] });
  });

  it('rejects invoke when the response carries an error', async () => {
    let ws!: FakeWS;
    const t = createWebSocketTransport({
      url: 'ws://x', token: 't',
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    ws._open();
    const p = t.invoke('openInVSCode', { path: '/x' } as never);
    const sent = JSON.parse(ws.sent[0]);
    ws._recv({ id: sent.id, kind: 'openInVSCode', error: 'not available' });
    await expect(p).rejects.toThrow(/not available/);
  });

  it('dispatches push frames to on() handlers', async () => {
    let ws!: FakeWS;
    const t = createWebSocketTransport({
      url: 'ws://x', token: 't',
      WebSocketImpl: class extends FakeWS { constructor(u: string) { super(u); ws = this; } } as never,
    });
    ws._open();
    const handler = vi.fn();
    t.on('ptyData', handler);
    ws._recv({ push: true, kind: 'ptyData', payload: { instanceId: 'i', chunk: 'hi' } });
    expect(handler).toHaveBeenCalledWith({ instanceId: 'i', chunk: 'hi' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/transport/webSocketTransport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/src/transport/webSocketTransport.ts`**

```typescript
import type { IpcRequest, IpcResponse, IpcPush, WatchtowerBridge } from '../../../shared/ipcContract';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

export function createWebSocketTransport(opts: {
  url: string;
  token: string;
  WebSocketImpl?: typeof WebSocket;
}): WatchtowerBridge & { close(): void } {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const sep = opts.url.includes('?') ? '&' : '?';
  const ws = new Impl(`${opts.url}${sep}token=${encodeURIComponent(opts.token)}`);

  const pending = new Map<string, Pending>();
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const outbox: string[] = [];
  let open = false;
  let counter = 0;

  ws.onopen = () => { open = true; outbox.splice(0).forEach((m) => ws.send(m)); };
  ws.onmessage = (e: MessageEvent) => {
    const msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
    if (msg.push === true) {
      handlers.get(msg.kind)?.forEach((h) => h(msg.payload));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.payload);
  };

  function send(frame: object) {
    const raw = JSON.stringify(frame);
    if (open) ws.send(raw); else outbox.push(raw);
  }

  return {
    invoke<T extends IpcRequest['kind']>(kind: T, payload: Extract<IpcRequest, { kind: T }>['payload']) {
      const id = `c${++counter}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        send({ id, kind, payload });
      }) as Promise<Extract<IpcResponse, { kind: T }>['payload']>;
    },
    on<T extends IpcPush['kind']>(kind: T, handler: (p: Extract<IpcPush, { kind: T }>['payload']) => void) {
      let set = handlers.get(kind);
      if (!set) { set = new Set(); handlers.set(kind, set); }
      set.add(handler as (p: unknown) => void);
      return () => set!.delete(handler as (p: unknown) => void);
    },
    close() { ws.close(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/src/transport/webSocketTransport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/transport/webSocketTransport.ts client/src/transport/webSocketTransport.test.ts
git commit -m "feat: client websocket transport implementing WatchtowerBridge"
```

---

## Task 7: Transport selection + browser install

**Files:**
- Create: `client/src/transport/selectTransport.ts`
- Test: `client/src/transport/selectTransport.test.ts`
- Modify: `client/src/browserStub.ts` (install WS transport when configured)

**Interfaces:**
- Consumes: `createWebSocketTransport`, the existing no-op stub builder in `browserStub.ts`.
- Produces:
  - `function readWsConfig(loc: { search: string }, storage: Pick<Storage, 'getItem'>): { url: string; token: string } | null` — reads `?wsUrl=&wsToken=` from the query string, falling back to `localStorage` keys `watchtower.wsUrl` / `watchtower.wsToken`.

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/transport/selectTransport.test.ts
import { describe, it, expect } from 'vitest';
import { readWsConfig } from './selectTransport';

const noStore = { getItem: () => null };

describe('readWsConfig', () => {
  it('reads url + token from the query string', () => {
    const cfg = readWsConfig(
      { search: '?wsUrl=ws://mac:7440/ws&wsToken=abc' },
      noStore,
    );
    expect(cfg).toEqual({ url: 'ws://mac:7440/ws', token: 'abc' });
  });

  it('falls back to localStorage', () => {
    const store = { getItem: (k: string) => (k === 'watchtower.wsUrl' ? 'ws://m/ws' : k === 'watchtower.wsToken' ? 'tok' : null) };
    expect(readWsConfig({ search: '' }, store)).toEqual({ url: 'ws://m/ws', token: 'tok' });
  });

  it('returns null when nothing is configured', () => {
    expect(readWsConfig({ search: '' }, noStore)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/src/transport/selectTransport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/src/transport/selectTransport.ts`**

```typescript
export function readWsConfig(
  loc: { search: string },
  storage: Pick<Storage, 'getItem'>,
): { url: string; token: string } | null {
  const params = new URLSearchParams(loc.search);
  const url = params.get('wsUrl') ?? storage.getItem('watchtower.wsUrl');
  const token = params.get('wsToken') ?? storage.getItem('watchtower.wsToken');
  if (url && token) return { url, token };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/src/transport/selectTransport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Install the transport in `browserStub.ts`**

At the top of the existing guard (after `if (window.watchtower) return;`), add:

```typescript
import { readWsConfig } from './transport/selectTransport';
import { createWebSocketTransport } from './transport/webSocketTransport';

const wsCfg = readWsConfig(window.location, window.localStorage);
if (wsCfg) {
  window.watchtower = createWebSocketTransport(wsCfg);
  return;
}
// ...existing no-op stub install continues below
```

- [ ] **Step 6: Run full suite + both typechecks**

Run: `npm test && npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit`
Expected: all tests pass (count ≥ prior + new); no *new* tsc errors (pre-existing client drift excepted).

- [ ] **Step 7: Commit**

```bash
git add client/src/transport/selectTransport.ts client/src/transport/selectTransport.test.ts client/src/browserStub.ts
git commit -m "feat: select websocket transport from url/localStorage config in browser"
```

---

## Task 8: Manual end-to-end verification (desktop browser)

No new code — this proves the slice works before any Apple/Capacitor spend.

- [ ] **Step 1: Run the app** with `npm run dev` so the orchestrator (and its new ws bridge) is live.

- [ ] **Step 2: Find the ws bridge port + token.** Log them once at startup (temporary `console.log` in `bootstrap.ts`) or read the listener sidecar; the token is the same one minted for the hook listener.

- [ ] **Step 3: Open the built renderer in a normal browser** (not Electron) at the Vite URL with config, e.g. `http://localhost:5173/?wsUrl=ws://127.0.0.1:<port>/ws&wsToken=<token>`.

- [ ] **Step 4: Verify reads round-trip** — the Instances list and a TimeTracker report load (data came over WS from the orchestrator).

- [ ] **Step 5: Verify live push** — spawn or open a running instance; confirm pty output streams into the browser terminal and typing reaches the session.

- [ ] **Step 6: Verify electron-only kinds degrade** — an action that triggers `openInVSCode` surfaces the "not available over the remote connection" error rather than crashing.

- [ ] **Step 7: Remove the temporary `console.log`, commit any cleanup.**

```bash
git commit -am "chore: remove temporary ws bridge debug logging" || true
```

---

## Self-Review

**Spec coverage (design doc §4 "the keystone"):**
- Transport abstraction behind `window.watchtower` → Tasks 6, 7 (WebSocketTransport + selection; ElectronTransport is the untouched existing preload bridge).
- Orchestrator WS server mirroring the IPC contract → Tasks 2, 4 (wsProtocol reuses `IpcRequest/Response/Push`; bridge routes through `handleRequest`).
- Token auth → Task 4 (query-string token, rejected with close code 1008).
- Tailscale-interface binding → Task 5 (`wsHost` option; defaults to localhost for dev, set to the Tailscale IP in the connectivity sub-project #5).
- Push broadcast to all clients → Tasks 3, 4 (`emitPush` sink + `broadcast`).
- Electron-only kinds unavailable in browser → Tasks 1, 4.
- Provable in a desktop browser, no Apple spend → Task 8.

**Placeholder scan:** No TBDs. Task 5's test intentionally points the implementer at `orchestrator/bootstrap.test.ts` to reuse the real options fixture (the exact bootstrap signature lives there and must not be guessed) — that is a concrete instruction, not a placeholder.

**Type consistency:** `WsRequestFrame`/`WsResponseFrame`/`WsPushFrame` (Task 2) are consumed unchanged by the bridge (Task 4) and client (Task 6). `emitPush`/`setPushSink` (Task 3) are consumed in Task 5. `createWebSocketTransport` (Task 6) is consumed in Task 7. `readWsConfig` (Task 7) signature matches its test. `OrchRequest`/`OrchPush` come from `shared/messagePort.ts`; `IpcRequest`/`IpcResponse`/`IpcPush`/`WatchtowerBridge` from `shared/ipcContract.ts`.

---

## Execution Handoff

See the brainstorming/writing-plans flow — after approval, choose subagent-driven (fresh subagent per task, review between) or inline execution.
