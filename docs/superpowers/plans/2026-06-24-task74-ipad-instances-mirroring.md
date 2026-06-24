# iPad Instances Mirroring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Instances module to the iPad — live terminal mirroring of Mac sessions, two-way drive, spawn-into-projects, attention badges — over the existing LAN WS transport.

**Architecture:** The orchestrator already broadcasts every `ptyData` push to all WS clients and accepts `ptyWrite`/`ptyResize` from any client, so mirroring needs only (a) two orchestrator gaps closed — faithful replay-on-attach and focus-owned multi-client pty sizing — and (b) an iPad UI (desktop chrome mirrored: left rail + project-grouped top tabs + single full-width terminal). Pure logic is shared via `@watchtower/shared`; iPad UI lives in `apps/ipad`.

**Tech Stack:** TypeScript, Node `utilityProcess` orchestrator, Fastify WS bridge, `@xterm/headless` + `@xterm/addon-serialize` (orchestrator), React 18 + xterm.js + `@xterm/addon-fit` (iPad), Capacitor (iOS shell), Vitest.

## Global Constraints

- **Tests live in `tests/**/*.test.ts`** at repo root (NOT co-located). Vitest `environment: 'node'`; run with `npm test`. iPad tests are **logic-only** (no jsdom / React rendering) — drive through pure functions and fake bridges, as `tests/ipad/connection.test.ts` and `tests/ipad/probe.test.ts` already do.
- **Bar is 619+ tests; every code task adds tests.** Run the **full** suite (`npm test`) before each commit, not a filtered slice.
- **No i18n.** Czech locale; copy in Czech where user-facing, but terminal/IPC internals stay English. Code comments **English only**.
- **Renderer never reaches SQLite directly** — all data via the IPC contract / WS bridge.
- **New IPC kind procedure (CLAUDE.md):** add to `IpcRequest` + `IpcResponse` in `packages/shared/src/ipcContract.ts`; mirror into `packages/shared/src/messagePort.ts`; handle in `orchestrator/index.ts`; consume via a thin hook in `apps/ipad/src/state/`, never `invoke` from components.
- **Typecheck gates:** `npx tsc -p orchestrator/tsconfig.json --noEmit` and `npm run build --workspace @watchtower/ipad` must pass. Do NOT fix pre-existing client/orchestrator tsc drift as a side quest.
- **Workspace build order:** `@watchtower/shared` is a built composite — after editing shared, the consumer build picks it up via the vitest alias (`packages/shared/src`); for app builds the workspace handles ordering.
- **Branch:** `feat/ipad-instances-mirroring` (already created; spec committed there).

---

## File Structure

**Orchestrator (gaps):**
- `orchestrator/terminalSnapshots.ts` (modify) — add `serialize(id)` via SerializeAddon.
- `orchestrator/ptySizeOwnership.ts` (create) — pure focus-ownership state machine.
- `orchestrator/wsBridge.ts` (modify) — per-socket client id, origin tag on requests, disconnect callback.
- `orchestrator/index.ts` (modify) — `terminalAttach` + `terminalFocus` handlers; route `ptyResize` through ownership; wire disconnect.

**Shared:**
- `packages/shared/src/ipcContract.ts` (modify) — new request/response kinds.
- `packages/shared/src/messagePort.ts` (modify) — mirror new kinds.
- `packages/shared/src/tabAttention.ts` (create) — moved `tabsNeedingAttention` + `ACTION_NEEDED_STATUSES`.
- `packages/shared/src/groupInstances.ts` (create) — lean `groupInstancesByProject` for iPad.

**Desktop:**
- `apps/desktop/src/util/tabAttention.ts` (modify) — re-export from shared (keep import path stable).
- `apps/desktop/src/components/Terminal.tsx` (modify) — emit `terminalFocus`.

**iPad (`apps/ipad/src`):**
- `lib/reconnectingTransport.ts` (create) — auto-reconnect wrapper around `createWebSocketTransport`.
- `lib/attachTerminal.ts` (create) — subscribe→buffer→snapshot→drain→live helper.
- `lib/accessoryKeys.ts` (create) — pure key→control-sequence mapping.
- `state/useInstances.ts`, `state/useProjects.ts`, `state/useActiveTerminal.ts` (create) — thin bridge hooks.
- `components/Rail.tsx`, `components/TabStrip.tsx`, `components/TerminalView.tsx`, `components/AccessoryBar.tsx`, `components/SpawnModal.tsx` (create).
- `App.tsx` (rewrite) — compose the module.
- `apps/ipad/package.json` (modify) — add xterm deps.

**Tests (`tests/`):**
- `tests/orchestrator/terminalSnapshots.serialize.test.ts`
- `tests/orchestrator/ptySizeOwnership.test.ts`
- `tests/shared/tabAttention.test.ts`
- `tests/shared/groupInstances.test.ts`
- `tests/ipad/attachTerminal.test.ts`
- `tests/ipad/accessoryKeys.test.ts`
- `tests/ipad/reconnectingTransport.test.ts`

---

## Phase 1 — Orchestrator gap #1: faithful replay-on-attach

### Task 1: `serialize(id)` on TerminalSnapshots

**Files:**
- Modify: `orchestrator/terminalSnapshots.ts`
- Test: `tests/orchestrator/terminalSnapshots.serialize.test.ts`
- Modify: root `package.json` (add `@xterm/addon-serialize`)

**Interfaces:**
- Produces: `TerminalSnapshots.serialize(id: string): string` — a replayable ANSI string of the instance's current screen+scrollback (empty string if no terminal for `id`).

- [ ] **Step 1: Add the dependency**

Run: `npm install @xterm/addon-serialize@^0.13.0 -w .` (root package, same place `@xterm/headless` lives — verify version resolves against the installed `@xterm/headless`).
Expected: `@xterm/addon-serialize` appears in root `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

```ts
// tests/orchestrator/terminalSnapshots.serialize.test.ts
import { describe, it, expect } from 'vitest';
import { TerminalSnapshots } from '../../orchestrator/terminalSnapshots.js';

describe('TerminalSnapshots.serialize', () => {
  it('returns empty string for an unknown instance', () => {
    const s = new TerminalSnapshots();
    expect(s.serialize('nope')).toBe('');
  });

  it('produces a replayable string reproducing written content', async () => {
    const s = new TerminalSnapshots();
    s.feed('i1', 'hello \x1b[31mred\x1b[0m world\r\n');
    await s.flush('i1');
    const out = s.serialize('i1');
    expect(out).toContain('hello');
    expect(out).toContain('red');
    // SerializeAddon re-emits SGR codes for colored runs.
    expect(out).toContain('\x1b[');
  });

  it('reflects the latest screen after a clear', async () => {
    const s = new TerminalSnapshots();
    s.feed('i1', 'first line\r\n');
    s.feed('i1', '\x1b[2J\x1b[H'); // clear screen + home
    s.feed('i1', 'after clear\r\n');
    await s.flush('i1');
    const out = s.serialize('i1');
    expect(out).toContain('after clear');
    expect(out).not.toContain('first line');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/orchestrator/terminalSnapshots.serialize.test.ts`
Expected: FAIL — `serialize` is not a function.

- [ ] **Step 4: Implement `serialize`**

In `orchestrator/terminalSnapshots.ts`, import and load the addon per terminal, then add the method:

```ts
import { SerializeAddon } from '@xterm/addon-serialize';
```

Extend the per-instance storage to hold the addon. Change the `terms` map value to `{ term: Terminal; serializer: SerializeAddon }` (or keep a parallel `Map<string, SerializeAddon>`). Minimal parallel-map version:

```ts
private serializers = new Map<string, SerializeAddon>();

private ensure(id: string): Terminal {
  let term = this.terms.get(id);
  if (!term) {
    term = new Terminal({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS, scrollback: SCROLLBACK, allowProposedApi: true });
    const ser = new SerializeAddon();
    term.loadAddon(ser);
    this.terms.set(id, term);
    this.serializers.set(id, ser);
  }
  return term;
}

/** Replayable ANSI snapshot of the current screen + scrollback. */
serialize(id: string): string {
  const ser = this.serializers.get(id);
  return ser ? ser.serialize() : '';
}
```

Also delete from `serializers` in `dispose(id)`:

```ts
dispose(id: string): void {
  const term = this.terms.get(id);
  if (term) {
    term.dispose();
    this.terms.delete(id);
    this.serializers.delete(id);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/orchestrator/terminalSnapshots.serialize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm test`
Expected: typecheck clean; full suite green (≥622 tests).

- [ ] **Step 7: Commit**

```bash
git add orchestrator/terminalSnapshots.ts tests/orchestrator/terminalSnapshots.serialize.test.ts package.json package-lock.json
git commit -m "feat: #74 serialize() ANSI snapshot on TerminalSnapshots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `terminalAttach` IPC kind

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (add request+response), `packages/shared/src/messagePort.ts` (mirror)
- Modify: `orchestrator/index.ts` (handler)
- Test: extend `tests/orchestrator/terminalSnapshots.serialize.test.ts` is NOT enough — add an orchestrator handler test if a handler harness exists; otherwise assert wiring via the snapshot. See Step 2.

**Interfaces:**
- Consumes: `TerminalSnapshots.serialize(id)` (Task 1); the orchestrator's per-instance pty cols/rows (already tracked for `ptyResize`).
- Produces: IPC `terminalAttach` — request `{ instanceId: string }`, response `{ data: string; cols: number; rows: number }`.

- [ ] **Step 1: Add the request kind to `ipcContract.ts`**

In the `IpcRequest` union (near line 7, beside `ptyResize`):

```ts
  | { kind: 'terminalAttach'; payload: { instanceId: string } }
```

In the `IpcResponse` union (near line 493, beside `ptyResize` response):

```ts
  | { kind: 'terminalAttach'; payload: { data: string; cols: number; rows: number } }
```

- [ ] **Step 2: Mirror into `messagePort.ts`**

Add the same `terminalAttach` request and response entries to the `OrchRequest` / `OrchResponse` unions in `packages/shared/src/messagePort.ts` (match the exact shapes above). It must NOT be added to `ELECTRON_ONLY_KINDS` (it must round-trip over WS).

- [ ] **Step 3: Write the failing handler test**

```ts
// tests/orchestrator/terminalAttach.test.ts
import { describe, it, expect } from 'vitest';
import { buildTerminalAttachResponse } from '../../orchestrator/terminalAttach.js';
import { TerminalSnapshots } from '../../orchestrator/terminalSnapshots.js';

describe('buildTerminalAttachResponse', () => {
  it('returns serialized data + the pty dimensions', async () => {
    const snaps = new TerminalSnapshots();
    snaps.feed('i1', 'prompt$ \r\n');
    await snaps.flush('i1');
    const res = buildTerminalAttachResponse(snaps, 'i1', () => ({ cols: 100, rows: 40 }));
    expect(res.cols).toBe(100);
    expect(res.rows).toBe(40);
    expect(res.data).toContain('prompt$');
  });

  it('falls back to default dims when the pty is unknown', () => {
    const snaps = new TerminalSnapshots();
    const res = buildTerminalAttachResponse(snaps, 'gone', () => null);
    expect(res).toEqual({ data: '', cols: 120, rows: 30 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- tests/orchestrator/terminalAttach.test.ts`
Expected: FAIL — module `terminalAttach.js` not found.

- [ ] **Step 5: Implement the pure builder**

```ts
// orchestrator/terminalAttach.ts
import type { TerminalSnapshots } from './terminalSnapshots.js';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

/**
 * Build the terminalAttach response: the replayable ANSI snapshot plus the
 * pty's current dimensions so the client sizes its xterm to match the stream
 * it is about to receive. `getDims` returns null when the pty is unknown.
 */
export function buildTerminalAttachResponse(
  snaps: TerminalSnapshots,
  instanceId: string,
  getDims: (id: string) => { cols: number; rows: number } | null,
): { data: string; cols: number; rows: number } {
  const dims = getDims(instanceId) ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  return { data: snaps.serialize(instanceId), cols: dims.cols, rows: dims.rows };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/orchestrator/terminalAttach.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Wire the handler in `orchestrator/index.ts`**

Find the `ptyResize` case (~line 562) and the `terminalSnapshots` instance + the per-pty handle that knows cols/rows (the `PtyManager` map). Add a case in the same switch:

```ts
case 'terminalAttach': {
  const handle = pty.get(req.payload.instanceId);
  const getDims = (id: string) => {
    const h = pty.get(id);
    return h ? { cols: h.cols, rows: h.rows } : null;
  };
  await terminalSnapshots.flush(req.payload.instanceId);
  return buildTerminalAttachResponse(terminalSnapshots, req.payload.instanceId, getDims);
}
```

If `PtyHandle` does not already expose `cols`/`rows`, add them: track the last `resize(cols, rows)` values on the handle in `ptyManager.ts` (store `this.cols`/`this.rows`, default 120/30, update in `resize()`). Import `buildTerminalAttachResponse` at the top of `index.ts`.

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm test`
Expected: clean; green.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/terminalAttach.ts orchestrator/index.ts orchestrator/ptyManager.ts tests/orchestrator/terminalAttach.test.ts
git commit -m "feat: #74 terminalAttach IPC — serialized replay + pty dims

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Orchestrator gap #2: focus-owned multi-client sizing

### Task 3: `PtySizeOwnership` pure state machine

**Files:**
- Create: `orchestrator/ptySizeOwnership.ts`
- Test: `tests/orchestrator/ptySizeOwnership.test.ts`

**Interfaces:**
- Produces:
  - `class PtySizeOwnership`
  - `focus(instanceId: string, clientId: string): void` — set the size owner.
  - `recordResize(instanceId, clientId, cols, rows): { apply: boolean; cols: number; rows: number }` — store the client's dims; `apply` is true only when `clientId` is the current owner (or no owner yet → first writer becomes owner).
  - `clientGone(clientId): Array<{ instanceId: string; cols: number; rows: number }>` — drop the client; for every instance it owned, hand back the next-best surviving client's stored dims (and reassign ownership to that client). Empty array if nothing to re-apply.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/ptySizeOwnership.test.ts
import { describe, it, expect } from 'vitest';
import { PtySizeOwnership } from '../../orchestrator/ptySizeOwnership.js';

describe('PtySizeOwnership', () => {
  it('first writer becomes owner and its resize applies', () => {
    const o = new PtySizeOwnership();
    const r = o.recordResize('i1', 'mac', 100, 40);
    expect(r).toEqual({ apply: true, cols: 100, rows: 40 });
  });

  it('non-owner resize is stored but not applied', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40); // mac is owner
    const r = o.recordResize('i1', 'ipad', 80, 25);
    expect(r.apply).toBe(false);
  });

  it('focus transfers ownership; the new owner then drives size', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40);
    o.recordResize('i1', 'ipad', 80, 25); // stored, not applied
    o.focus('i1', 'ipad');
    const r = o.recordResize('i1', 'ipad', 80, 25);
    expect(r).toEqual({ apply: true, cols: 80, rows: 25 });
  });

  it('owner disconnect falls back to a surviving client\'s stored dims', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40);
    o.recordResize('i1', 'ipad', 80, 25);
    const reapply = o.clientGone('mac');
    expect(reapply).toEqual([{ instanceId: 'i1', cols: 80, rows: 25 }]);
    // ipad is now owner
    expect(o.recordResize('i1', 'ipad', 81, 26)).toEqual({ apply: true, cols: 81, rows: 26 });
  });

  it('disconnect of a non-owner re-applies nothing', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40);
    o.recordResize('i1', 'ipad', 80, 25);
    expect(o.clientGone('ipad')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/orchestrator/ptySizeOwnership.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// orchestrator/ptySizeOwnership.ts

type Dims = { cols: number; rows: number };

/**
 * Per-instance pty size arbitration for multiple attached clients. The
 * "most-recently-focused" client owns the pty dimensions; resizes from any
 * other client are remembered (for fallback on disconnect) but not applied.
 * Pure + synchronous so it is unit-testable without sockets.
 */
export class PtySizeOwnership {
  private owner = new Map<string, string>();              // instanceId -> clientId
  private dims = new Map<string, Map<string, Dims>>();    // instanceId -> clientId -> dims

  focus(instanceId: string, clientId: string): void {
    this.owner.set(instanceId, clientId);
  }

  recordResize(instanceId: string, clientId: string, cols: number, rows: number): { apply: boolean } & Dims {
    let perClient = this.dims.get(instanceId);
    if (!perClient) { perClient = new Map(); this.dims.set(instanceId, perClient); }
    perClient.set(clientId, { cols, rows });
    if (!this.owner.has(instanceId)) this.owner.set(instanceId, clientId); // first writer owns
    const apply = this.owner.get(instanceId) === clientId;
    return { apply, cols, rows };
  }

  clientGone(clientId: string): Array<{ instanceId: string } & Dims> {
    const reapply: Array<{ instanceId: string } & Dims> = [];
    for (const [instanceId, perClient] of this.dims) {
      perClient.delete(clientId);
      if (this.owner.get(instanceId) === clientId) {
        this.owner.delete(instanceId);
        // Pick any surviving client as the new owner; re-apply its dims.
        const next = perClient.entries().next();
        if (!next.done) {
          const [nextClient, d] = next.value;
          this.owner.set(instanceId, nextClient);
          reapply.push({ instanceId, cols: d.cols, rows: d.rows });
        }
      }
    }
    return reapply;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/orchestrator/ptySizeOwnership.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/ptySizeOwnership.ts tests/orchestrator/ptySizeOwnership.test.ts
git commit -m "feat: #74 PtySizeOwnership focus-arbitration state machine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire ownership + `terminalFocus` + origin tagging

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` + `messagePort.ts` (add `terminalFocus`)
- Modify: `orchestrator/wsBridge.ts` (per-socket client id, pass origin to `handleRequest`, disconnect callback)
- Modify: `orchestrator/index.ts` (route `ptyResize` through ownership, handle `terminalFocus`, wire disconnect)

**Interfaces:**
- Consumes: `PtySizeOwnership` (Task 3).
- Produces:
  - IPC `terminalFocus` — request `{ instanceId: string }`, response `{ ok: true }`.
  - `WsBridgeOptions.handleRequest` gains an optional second arg `origin?: string`.
  - `WsBridgeOptions.onClientGone?: (clientId: string) => void`.

- [ ] **Step 1: Add `terminalFocus` to the contract**

`ipcContract.ts` `IpcRequest`: `| { kind: 'terminalFocus'; payload: { instanceId: string } }`
`ipcContract.ts` `IpcResponse`: `| { kind: 'terminalFocus'; payload: { ok: true } }`
Mirror both into `messagePort.ts`. Do NOT add to `ELECTRON_ONLY_KINDS`.

- [ ] **Step 2: Origin-tag requests + disconnect callback in `wsBridge.ts`**

Change `WsBridgeOptions`:

```ts
export interface WsBridgeOptions {
  host: string;
  port: number;
  token: string;
  handleRequest: (req: OrchRequest, origin?: string) => Promise<unknown>;
  onClientGone?: (clientId: string) => void;
}
```

In the connection handler, give each socket an id and pass it through; fire the callback on close:

```ts
let nextClientId = 0;
app.register(async (scoped) => {
  scoped.get('/ws', { /* …existing opts… */ }, (conn, req) => {
    const socket = conn.socket as unknown as WebSocket;
    const clientId = `ws-${++nextClientId}`;
    clients.add(socket);
    socket.on('close', () => {
      clients.delete(socket);
      opts.onClientGone?.(clientId);
    });
    socket.on('message', async (raw: Buffer) => {
      // …decode as before…
      try {
        const payload = await opts.handleRequest(
          { id: frame.id, kind: frame.kind, payload: frame.payload } as OrchRequest,
          clientId,
        );
        reply(payload);
      } catch (err) { /* …as before… */ }
    });
  });
});
```

- [ ] **Step 3: Route resize + handle focus in `orchestrator/index.ts`**

Construct one ownership instance near the other module state:

```ts
import { PtySizeOwnership } from './ptySizeOwnership.js';
const ptySizeOwnership = new PtySizeOwnership();
const LOCAL_CLIENT = 'local';
```

`handleRequest` must accept the origin. Find its signature (the function passed to both the MessagePort handler and `wsBridge.handleRequest`) and thread an `origin: string = LOCAL_CLIENT` parameter. The Electron/local path passes nothing → defaults to `'local'`; the WS path passes the socket's `clientId`.

Replace the `ptyResize` case:

```ts
case 'ptyResize': {
  const { instanceId, cols, rows } = req.payload;
  const decision = ptySizeOwnership.recordResize(instanceId, origin, cols, rows);
  terminalSnapshots.resize(instanceId, cols, rows);
  if (decision.apply) pty.get(instanceId)?.resize(cols, rows);
  return { ok: true };
}
```

> Note: `terminalSnapshots.resize` always runs so the serialized snapshot tracks whatever the owner's size is; only the real pty resize is gated. When a non-owner's dims differ, its snapshot view is best-effort — acceptable, since on focus it becomes owner and the pty resizes to it.

Add the focus case:

```ts
case 'terminalFocus': {
  ptySizeOwnership.focus(req.payload.instanceId, origin);
  return { ok: true };
}
```

- [ ] **Step 4: Wire the disconnect fallback where `startWsBridge` is called**

In `orchestrator/bootstrap.ts` (the `startWsBridge({...})` call, ~line 130), add:

```ts
onClientGone: (clientId) => {
  for (const { instanceId, cols, rows } of ptySizeOwnership.clientGone(clientId)) {
    pty.get(instanceId)?.resize(cols, rows);
    terminalSnapshots.resize(instanceId, cols, rows);
  }
},
```

`ptySizeOwnership` and `pty` must be reachable here. If `bootstrap.ts` cannot see them, expose a small callback from `index.ts` instead (e.g. export a `handleClientGone(clientId)` function from `index.ts` and pass it as `onClientGone`). Prefer the latter to keep ownership state co-located with the switch.

- [ ] **Step 5: Add a wiring test**

```ts
// tests/orchestrator/ptyResizeRouting.test.ts
import { describe, it, expect } from 'vitest';
import { PtySizeOwnership } from '../../orchestrator/ptySizeOwnership.js';

// Documents the routing contract used in index.ts: only owner resizes touch the pty.
describe('ptyResize routing via ownership', () => {
  it('applies owner resize, suppresses non-owner', () => {
    const o = new PtySizeOwnership();
    const applied: Array<[number, number]> = [];
    const resizePty = (d: { apply: boolean; cols: number; rows: number }) => {
      if (d.apply) applied.push([d.cols, d.rows]);
    };
    resizePty(o.recordResize('i1', 'local', 120, 30)); // owner
    resizePty(o.recordResize('i1', 'ws-1', 80, 24));    // suppressed
    o.focus('i1', 'ws-1');
    resizePty(o.recordResize('i1', 'ws-1', 80, 24));    // now applied
    expect(applied).toEqual([[120, 30], [80, 24]]);
  });
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- tests/orchestrator/ptyResizeRouting.test.ts && npx tsc -p orchestrator/tsconfig.json --noEmit && npm test`
Expected: green; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/wsBridge.ts orchestrator/index.ts orchestrator/bootstrap.ts tests/orchestrator/ptyResizeRouting.test.ts
git commit -m "feat: #74 focus-owned pty sizing + terminalFocus + ws origin tagging

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Desktop emits `terminalFocus`

**Files:**
- Modify: `apps/desktop/src/components/Terminal.tsx`

**Interfaces:**
- Consumes: IPC `terminalFocus` (Task 4).

- [ ] **Step 1: Emit focus on mount and on slot bind**

In `Terminal.tsx`, in the mount effect (right after the initial `ptyResize`, ~line 79) add:

```ts
void window.watchtower.invoke('terminalFocus', { instanceId });
```

And in the reparent-into-slot effect, inside the `if (slot)` branch where it calls `term.focus()` (~line 110), also emit:

```ts
void window.watchtower.invoke('terminalFocus', { instanceId });
```

This makes the Mac claim size ownership whenever its terminal gains focus, matching the iPad's behavior — so whichever device you last focused drives the pty.

- [ ] **Step 2: Build the desktop renderer**

Run: `npm run build --workspace @watchtower/desktop` (or the desktop build script — verify name in `apps/desktop/package.json`).
Expected: builds clean. (No new unit test — behavior is covered by the orchestrator routing test + manual acceptance.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/Terminal.tsx
git commit -m "feat: #74 desktop Terminal emits terminalFocus for size ownership

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Shared logic extractions

### Task 6: Share `tabsNeedingAttention` + add `groupInstancesByProject`

**Files:**
- Create: `packages/shared/src/tabAttention.ts`
- Modify: `apps/desktop/src/util/tabAttention.ts` (re-export from shared)
- Create: `packages/shared/src/groupInstances.ts`
- Test: `tests/shared/tabAttention.test.ts`, `tests/shared/groupInstances.test.ts`

**Interfaces:**
- Produces:
  - `ACTION_NEEDED_STATUSES: ReadonlySet<string>` and `tabsNeedingAttention(tabs, statusById): Set<string>` (moved verbatim; signature unchanged).
  - `groupInstancesByProject(instances, projects): ProjectGroup[]` where
    `ProjectGroup = { projectId: number | null; label: string; folderPath: string | null; instanceIds: string[] }`.
    Instances whose `cwd` matches a project's `folderPath` group under it; unmatched instances fall into a single `{ projectId: null, label: 'Other', folderPath: null }` group. Order: projects in input order, then Other last.

- [ ] **Step 1: Move the attention logic to shared**

Copy the full body of `apps/desktop/src/util/tabAttention.ts` (the `ACTION_NEEDED_STATUSES` set, the `TabMembers` interface, and `tabsNeedingAttention`) into `packages/shared/src/tabAttention.ts` unchanged.

- [ ] **Step 2: Re-export from the desktop path (keep imports stable)**

Replace `apps/desktop/src/util/tabAttention.ts` contents with:

```ts
export { ACTION_NEEDED_STATUSES, tabsNeedingAttention } from '@watchtower/shared/tabAttention.js';
```

- [ ] **Step 3: Write the failing tests**

```ts
// tests/shared/tabAttention.test.ts
import { describe, it, expect } from 'vitest';
import { tabsNeedingAttention, ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';

describe('tabsNeedingAttention (shared)', () => {
  it('flags a tab with a waiting-permission member', () => {
    const tabs = [{ id: 't1', columnOrder: ['a'], hiddenInstanceIds: [] }];
    const status = new Map([['a', 'waiting-permission']]);
    expect(tabsNeedingAttention(tabs, status)).toEqual(new Set(['t1']));
  });
  it('ignores idle-notify (not action-needed)', () => {
    expect(ACTION_NEEDED_STATUSES.has('idle-notify')).toBe(false);
  });
});
```

```ts
// tests/shared/groupInstances.test.ts
import { describe, it, expect } from 'vitest';
import { groupInstancesByProject } from '@watchtower/shared/groupInstances.js';

const projects = [
  { id: 1, name: 'watchtower', folderPath: '/Users/jan/Projects/Watchtower' },
  { id: 2, name: 'pps', folderPath: '/Users/jan/Projects/pps' },
];

describe('groupInstancesByProject', () => {
  it('groups instances under the project whose folderPath matches cwd', () => {
    const instances = [
      { id: 'a', cwd: '/Users/jan/Projects/Watchtower', status: 'working' },
      { id: 'b', cwd: '/Users/jan/Projects/pps', status: 'idle' },
    ];
    const groups = groupInstancesByProject(instances, projects);
    expect(groups.map((g) => [g.projectId, g.instanceIds])).toEqual([
      [1, ['a']],
      [2, ['b']],
    ]);
  });

  it('puts unmatched instances in a trailing Other group', () => {
    const instances = [{ id: 'x', cwd: '/tmp/scratch', status: 'idle' }];
    const groups = groupInstancesByProject(instances, projects);
    const other = groups[groups.length - 1];
    expect(other.projectId).toBeNull();
    expect(other.label).toBe('Other');
    expect(other.instanceIds).toEqual(['x']);
  });

  it('omits empty project groups', () => {
    const instances = [{ id: 'a', cwd: '/Users/jan/Projects/Watchtower', status: 'working' }];
    const groups = groupInstancesByProject(instances, projects);
    expect(groups.find((g) => g.projectId === 2)).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- tests/shared/tabAttention.test.ts tests/shared/groupInstances.test.ts`
Expected: FAIL — `groupInstances.js` not found (attention test may pass already after the move).

- [ ] **Step 5: Implement `groupInstancesByProject`**

```ts
// packages/shared/src/groupInstances.ts

export interface GroupableInstance { id: string; cwd: string; status: string }
export interface GroupableProject { id: number; name: string; folderPath: string | null }
export interface ProjectGroup {
  projectId: number | null;
  label: string;
  folderPath: string | null;
  instanceIds: string[];
}

/**
 * Lean project→instance grouping for the iPad tab strip. Matches each
 * instance's cwd to a project's folderPath; unmatched instances collect into a
 * trailing "Other" group. Empty project groups are omitted. Projects keep input
 * order; Other is always last. (The desktop's deriveTabs is intentionally NOT
 * reused — it carries split-pane / hidden / ad-hoc concerns the iPad lacks.)
 */
export function groupInstancesByProject(
  instances: ReadonlyArray<GroupableInstance>,
  projects: ReadonlyArray<GroupableProject>,
): ProjectGroup[] {
  const byProject = new Map<number, string[]>();
  const other: string[] = [];
  for (const inst of instances) {
    const proj = projects.find((p) => p.folderPath && p.folderPath === inst.cwd);
    if (proj) {
      const arr = byProject.get(proj.id) ?? [];
      arr.push(inst.id);
      byProject.set(proj.id, arr);
    } else {
      other.push(inst.id);
    }
  }
  const groups: ProjectGroup[] = [];
  for (const p of projects) {
    const ids = byProject.get(p.id);
    if (ids && ids.length) groups.push({ projectId: p.id, label: p.name, folderPath: p.folderPath, instanceIds: ids });
  }
  if (other.length) groups.push({ projectId: null, label: 'Other', folderPath: null, instanceIds: other });
  return groups;
}
```

- [ ] **Step 6: Run tests + desktop build + full suite**

Run: `npm test -- tests/shared && npm run build --workspace @watchtower/desktop && npm test`
Expected: all green; desktop still builds (re-export path intact).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/tabAttention.ts packages/shared/src/groupInstances.ts apps/desktop/src/util/tabAttention.ts tests/shared/tabAttention.test.ts tests/shared/groupInstances.test.ts
git commit -m "feat: #74 share tabsNeedingAttention + add groupInstancesByProject

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — iPad client libraries (logic, TDD)

### Task 7: xterm deps + `attachTerminal` + `accessoryKeys` + `reconnectingTransport`

**Files:**
- Modify: `apps/ipad/package.json` (add `@xterm/xterm`, `@xterm/addon-fit`)
- Create: `apps/ipad/src/lib/attachTerminal.ts`
- Create: `apps/ipad/src/lib/accessoryKeys.ts`
- Create: `apps/ipad/src/lib/reconnectingTransport.ts`
- Test: `tests/ipad/attachTerminal.test.ts`, `tests/ipad/accessoryKeys.test.ts`, `tests/ipad/reconnectingTransport.test.ts`

**Interfaces:**
- Consumes: bridge shape `{ invoke(kind, payload): Promise<unknown>; on(kind, handler): () => void }`; IPC `terminalAttach` (Task 2), `ptyData` push.
- Produces:
  - `attachTerminal(bridge, instanceId, sink): Promise<{ dispose(): void }>` where `sink = { write(data: string): void; resize(cols, rows): void }`. Order: subscribe to `ptyData` (buffer) → `invoke('terminalAttach')` → `sink.resize(cols, rows)` → `sink.write(snapshot)` → drain buffered chunks in arrival order → switch to live write. `dispose()` unsubscribes.
  - `accessoryKeyToSequence(key: AccessoryKey): string` for `'esc' | 'tab' | 'up' | 'down' | 'left' | 'right'`; `ctrlChar(letter: string): string` (single a–z/A–Z letter → control byte).
  - `createReconnectingTransport(opts): { invoke; on; onStatus(cb): () => void; close() }` — wraps `createWebSocketTransport`, reconnects with backoff, emits `'connecting' | 'connected' | 'disconnected'`, and re-fires registered `on` subscriptions against each new socket.

- [ ] **Step 1: Add xterm deps**

Run: `npm install @xterm/xterm@^5.5.0 @xterm/addon-fit@^0.10.0 -w @watchtower/ipad`
Expected: both appear under `apps/ipad/package.json` dependencies (match the versions desktop uses — check `apps/desktop/package.json` and pin to the same).

- [ ] **Step 2: Write failing `accessoryKeys` test**

```ts
// tests/ipad/accessoryKeys.test.ts
import { describe, it, expect } from 'vitest';
import { accessoryKeyToSequence, ctrlChar } from '../../apps/ipad/src/lib/accessoryKeys.js';

describe('accessoryKeyToSequence', () => {
  it('maps esc/tab/arrows to control sequences', () => {
    expect(accessoryKeyToSequence('esc')).toBe('\x1b');
    expect(accessoryKeyToSequence('tab')).toBe('\t');
    expect(accessoryKeyToSequence('up')).toBe('\x1b[A');
    expect(accessoryKeyToSequence('down')).toBe('\x1b[B');
    expect(accessoryKeyToSequence('right')).toBe('\x1b[C');
    expect(accessoryKeyToSequence('left')).toBe('\x1b[D');
  });
});

describe('ctrlChar', () => {
  it('maps letters to their control byte', () => {
    expect(ctrlChar('c')).toBe('\x03');
    expect(ctrlChar('C')).toBe('\x03');
    expect(ctrlChar('a')).toBe('\x01');
  });
  it('returns empty string for non-letters', () => {
    expect(ctrlChar('1')).toBe('');
    expect(ctrlChar('')).toBe('');
  });
});
```

- [ ] **Step 3: Implement `accessoryKeys.ts`**

```ts
// apps/ipad/src/lib/accessoryKeys.ts
export type AccessoryKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right';

const SEQ: Record<AccessoryKey, string> = {
  esc: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
};

export function accessoryKeyToSequence(key: AccessoryKey): string {
  return SEQ[key];
}

/** Single a–z/A–Z letter → its ASCII control byte (Ctrl-A = 0x01 … Ctrl-Z = 0x1a). */
export function ctrlChar(letter: string): string {
  if (letter.length !== 1) return '';
  const code = letter.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return '';
  return String.fromCharCode(code - 64);
}
```

- [ ] **Step 4: Write failing `attachTerminal` test**

```ts
// tests/ipad/attachTerminal.test.ts
import { describe, it, expect } from 'vitest';
import { attachTerminal } from '../../apps/ipad/src/lib/attachTerminal.js';

function fakeBridge() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    emitData: (p: unknown) => handlers.get('ptyData')?.forEach((h) => h(p)),
    bridge: {
      invoke: async (kind: string) => {
        if (kind === 'terminalAttach') return { data: 'SNAP', cols: 90, rows: 30 };
        return { ok: true };
      },
      on: (kind: string, h: (p: unknown) => void) => {
        let set = handlers.get(kind); if (!set) { set = new Set(); handlers.set(kind, set); }
        set.add(h);
        return () => set!.delete(h);
      },
    },
  };
}

describe('attachTerminal', () => {
  it('writes snapshot then drains buffered chunks in order, no gap', async () => {
    const { bridge, emitData } = fakeBridge();
    const writes: string[] = [];
    const resizes: Array<[number, number]> = [];
    const sink = { write: (d: string) => writes.push(d), resize: (c: number, r: number) => resizes.push([c, r]) };

    // A chunk arrives during the attach round-trip; it must be buffered, not lost.
    const pending = attachTerminal(bridge, 'i1', sink);
    emitData({ instanceId: 'i1', chunk: 'BUFFERED' });
    const handle = await pending;

    expect(resizes[0]).toEqual([90, 30]);
    expect(writes[0]).toBe('SNAP');
    expect(writes[1]).toBe('BUFFERED');

    // After attach, live chunks write straight through.
    emitData({ instanceId: 'i1', chunk: 'LIVE' });
    expect(writes[2]).toBe('LIVE');

    // Chunks for other instances are ignored.
    emitData({ instanceId: 'other', chunk: 'NOPE' });
    expect(writes).not.toContain('NOPE');

    handle.dispose();
  });
});
```

- [ ] **Step 5: Implement `attachTerminal.ts`**

```ts
// apps/ipad/src/lib/attachTerminal.ts
type Bridge = {
  invoke(kind: string, payload: unknown): Promise<unknown>;
  on(kind: string, handler: (p: unknown) => void): () => void;
};
export interface TerminalSink {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/**
 * Attach a sink (an xterm) to a live pty stream without gap or double-render:
 * subscribe first and buffer; fetch the serialized snapshot; resize; write the
 * snapshot; drain buffered chunks; then write live. Returns a disposer that
 * unsubscribes from ptyData.
 */
export async function attachTerminal(
  bridge: Bridge,
  instanceId: string,
  sink: TerminalSink,
): Promise<{ dispose(): void }> {
  let live = false;
  const buffer: string[] = [];
  const off = bridge.on('ptyData', (p) => {
    const d = p as { instanceId: string; chunk: string };
    if (d.instanceId !== instanceId) return;
    if (live) sink.write(d.chunk);
    else buffer.push(d.chunk);
  });

  const res = (await bridge.invoke('terminalAttach', { instanceId })) as {
    data: string; cols: number; rows: number;
  };
  sink.resize(res.cols, res.rows);
  if (res.data) sink.write(res.data);
  for (const chunk of buffer.splice(0)) sink.write(chunk);
  live = true;

  return { dispose: off };
}
```

- [ ] **Step 6: Write failing `reconnectingTransport` test**

```ts
// tests/ipad/reconnectingTransport.test.ts
import { describe, it, expect } from 'vitest';
import { createReconnectingTransport } from '../../apps/ipad/src/lib/reconnectingTransport.js';

// Fake inner transport factory we can drive open/close on.
function makeFactory() {
  const created: Array<{ close(): void; fail(): void; handlers: Map<string, Set<(p: unknown)=>void>> }> = [];
  const factory = (_opts: { url: string; token: string }) => {
    const handlers = new Map<string, Set<(p: unknown)=>void>>();
    let onClose: (() => void) | null = null;
    const t = {
      invoke: async () => ({ ok: true }),
      on: (k: string, h: (p: unknown)=>void) => {
        let s = handlers.get(k); if (!s) { s = new Set(); handlers.set(k, s); } s.add(h);
        return () => s!.delete(h);
      },
      close: () => {},
      __setOnClose: (cb: () => void) => { onClose = cb; },
      __fireClose: () => onClose?.(),
    };
    created.push({ close: t.close, fail: () => t.__fireClose(), handlers });
    return t;
  };
  return { factory, created };
}

describe('createReconnectingTransport', () => {
  it('re-subscribes registered handlers against a new socket after reconnect', async () => {
    const { factory, created } = makeFactory();
    const statuses: string[] = [];
    const rt = createReconnectingTransport(
      { url: 'ws://x/ws', token: 't' },
      { factory, backoffMs: () => 0 },
    );
    rt.onStatus((s) => statuses.push(s));
    const received: unknown[] = [];
    rt.on('stateChanged', (p) => received.push(p));

    // First socket delivers a push.
    created[0].handlers.get('stateChanged')?.forEach((h) => h({ instanceId: 'a', status: 'working' }));
    expect(received).toHaveLength(1);

    // Socket drops → wrapper builds a new one and re-binds the handler.
    created[0].fail();
    await Promise.resolve();
    expect(created.length).toBeGreaterThanOrEqual(2);
    created[1].handlers.get('stateChanged')?.forEach((h) => h({ instanceId: 'a', status: 'idle' }));
    expect(received).toHaveLength(2);
    rt.close();
  });
});
```

> Note: the exact `__setOnClose`/`__fireClose` test seam mirrors how the wrapper must expose a close hook on the inner transport. Implement the wrapper so it registers an internal close listener; adapt the fake's seam names to the real hook the wrapper uses (e.g. the wrapper passes its own `onClose` into the factory, or the real `createWebSocketTransport` is extended to accept an `onClose` callback). Keep the production transport generic — add an optional `onClose?: () => void` to `createWebSocketTransport` rather than iPad-specific logic.

- [ ] **Step 7: Add `onClose` to the production transport**

In `packages/transport/src/webSocketTransport.ts`, accept `onClose?: () => void` in opts and call it from `ws.onclose`. This is the generic hook the reconnect wrapper needs.

- [ ] **Step 8: Implement `reconnectingTransport.ts`**

```ts
// apps/ipad/src/lib/reconnectingTransport.ts
import { createWebSocketTransport } from '@watchtower/transport';

type Inner = { invoke(k: string, p: unknown): Promise<unknown>; on(k: string, h: (p: unknown) => void): () => void; close(): void };
type Factory = (opts: { url: string; token: string; onClose?: () => void }) => Inner;
export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export function createReconnectingTransport(
  conn: { url: string; token: string },
  cfg?: { factory?: Factory; backoffMs?: (attempt: number) => number },
) {
  const factory = cfg?.factory ?? (createWebSocketTransport as unknown as Factory);
  const backoff = cfg?.backoffMs ?? ((n) => Math.min(1000 * 2 ** n, 15000));
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const statusCbs = new Set<(s: ConnStatus) => void>();
  let inner: Inner | null = null;
  let attempt = 0;
  let closed = false;

  const setStatus = (s: ConnStatus) => statusCbs.forEach((cb) => cb(s));

  const bindAll = (t: Inner) => {
    for (const [kind, set] of handlers) for (const h of set) t.on(kind, h);
  };

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    inner = factory({
      url: conn.url, token: conn.token,
      onClose: () => {
        if (closed) return;
        setStatus('disconnected');
        const wait = backoff(attempt++);
        setTimeout(connect, wait);
      },
    });
    bindAll(inner);
    setStatus('connected');
    attempt = 0;
  };
  connect();

  return {
    invoke: (k: string, p: unknown) => inner ? inner.invoke(k, p) : Promise.reject(new Error('not connected')),
    on: (kind: string, h: (p: unknown) => void) => {
      let set = handlers.get(kind); if (!set) { set = new Set(); handlers.set(kind, set); } set.add(h);
      const offInner = inner?.on(kind, h);
      return () => { set!.delete(h); offInner?.(); };
    },
    onStatus: (cb: (s: ConnStatus) => void) => { statusCbs.add(cb); return () => statusCbs.delete(cb); },
    close: () => { closed = true; inner?.close(); },
  };
}
```

> The test's fake exercises re-binding; the real `onClose` fires reconnection. Reconcile the fake seam (`__fireClose`) with `onClose` by having the fake call the `onClose` passed into `factory`. Update the fake in Step 6 accordingly before running.

- [ ] **Step 9: Run all iPad lib tests + transport typecheck**

Run: `npm test -- tests/ipad && npm run build --workspace @watchtower/ipad`
Expected: all green; iPad builds.

- [ ] **Step 10: Commit**

```bash
git add apps/ipad/package.json package-lock.json apps/ipad/src/lib packages/transport/src/webSocketTransport.ts tests/ipad/attachTerminal.test.ts tests/ipad/accessoryKeys.test.ts tests/ipad/reconnectingTransport.test.ts
git commit -m "feat: #74 iPad client libs — attachTerminal, accessoryKeys, reconnecting transport

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5 — iPad UI (wiring; covered by build + manual acceptance)

> React components are wired here. Per repo convention (and no jsdom in the test env) these are **not** unit-tested; correctness is gated by the iPad build, typecheck, and on-device manual acceptance (recorded in the PR, as #73 did). All bridge access goes through the `state/` hooks — never `invoke` from a component.

### Task 8: State hooks

**Files:**
- Create: `apps/ipad/src/state/connectionContext.tsx` — holds the `createReconnectingTransport` instance + status, provided at the App root.
- Create: `apps/ipad/src/state/useInstances.ts` — `listInstances` on mount + refetch on `stateChanged`; returns `{ instances, status }` where instance = `{ id, cwd, status, lastActivityAt, kind, taskId }`.
- Create: `apps/ipad/src/state/useProjects.ts` — `projects:list` once; returns `{ projects }` (`{ id, name, folderPath }`).
- Create: `apps/ipad/src/state/useActiveTerminal.ts` — tracks the selected `instanceId`.

- [ ] **Step 1: Implement `connectionContext.tsx`** — a React context exposing `{ bridge, status }`. The bridge is `createReconnectingTransport({ url: connectionToWsUrl(c), token: c.token })`. Subscribe to `onStatus` and expose the latest status. Build the connection from the saved `Connection` (existing `loadConnection`).

- [ ] **Step 2: Implement `useInstances.ts`**

```ts
import { useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';

export interface InstanceView { id: string; cwd: string; status: string; lastActivityAt: number; kind: string; taskId: number | null }

export function useInstances() {
  const { bridge } = useConnection();
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const refetch = () => void bridge.invoke('listInstances', {}).then((r) => setInstances((r as { instances: InstanceView[] }).instances));
  useEffect(() => {
    refetch();
    return bridge.on('stateChanged', () => refetch());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  return { instances };
}
```

- [ ] **Step 3: Implement `useProjects.ts`** — call `bridge.invoke('projects:list', { /* default filter */ })` once; map to `{ id, name, folderPath }`. Check the `ProjectListFilterPayload` default shape in `ipcContract.ts` and pass the minimal valid filter (mirror how desktop `useProjects` calls it).

- [ ] **Step 4: Implement `useActiveTerminal.ts`** — `useState<string | null>` + setter; nothing more.

- [ ] **Step 5: Build + commit**

Run: `npm run build --workspace @watchtower/ipad`
```bash
git add apps/ipad/src/state
git commit -m "feat: #74 iPad state hooks (connection, instances, projects, active terminal)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 9: `TerminalView` + `AccessoryBar`

**Files:**
- Create: `apps/ipad/src/components/TerminalView.tsx` — xterm + FitAddon; runs `attachTerminal`; `term.onData` → `ptyWrite`; `ResizeObserver` → fit → `ptyResize`; emit `terminalFocus` on mount and on `term.onFocus` (or container focus). Sticky-Ctrl: when armed (from AccessoryBar), intercept the next `onData` single char and send `ctrlChar(char)` instead, then disarm.
- Create: `apps/ipad/src/components/AccessoryBar.tsx` — buttons Esc/Ctrl/Tab/↑↓←→; Esc/Tab/arrows send `accessoryKeyToSequence` via `ptyWrite`; Ctrl toggles the armed flag in shared state with TerminalView. Render only when no hardware keyboard (best-effort: show always for v1; it is harmless with a hardware keyboard). 

- [ ] **Step 1: Implement `TerminalView.tsx`.** Mount xterm once per `instanceId` (mirror the desktop `Terminal.tsx` xterm options — font, theme, `convertEol`, scrollback). After `term.open` + initial `fit.fit()`, call `attachTerminal(bridge, instanceId, { write: (d) => term.write(d), resize: () => {/* pty owns size; do not resize xterm from snapshot dims, just fit */} })`. Then wire `onData`→`ptyWrite`, `ResizeObserver`→`ptyResize`, and emit `terminalFocus` on mount.

> Sizing note: the iPad fits its xterm to its own viewport and sends `ptyResize`; when it is the focus owner the pty follows it (Task 4). The snapshot `resize(cols,rows)` from `attachTerminal` is advisory — prefer fitting to the real viewport and letting focus-ownership arbitrate. Keep the sink's `resize` a no-op or use it only to seed before the first fit.

- [ ] **Step 2: Implement `AccessoryBar.tsx`** with the six fixed keys + a Ctrl toggle. Lift the `ctrlArmed` boolean to `TerminalView` (pass `armed`, `onArmChange`, and the `ptyWrite` sender down, or colocate the bar inside `TerminalView`). Colocating inside `TerminalView` is simplest.

- [ ] **Step 3: Build + commit**

Run: `npm run build --workspace @watchtower/ipad`
```bash
git add apps/ipad/src/components/TerminalView.tsx apps/ipad/src/components/AccessoryBar.tsx
git commit -m "feat: #74 iPad TerminalView + accessory bar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 10: `Rail` + `TabStrip` + `SpawnModal`

**Files:**
- Create: `apps/ipad/src/components/Rail.tsx` — vertical nav: Instances (active), TimeTracker + Settings disabled (tooltip "coming soon"), theme toggle. Use the shared theme tokens.
- Create: `apps/ipad/src/components/TabStrip.tsx` — `groupInstancesByProject(instances, projects)` → one tab per group; ⚠️ when the group has an action-needed member (`tabsNeedingAttention`-style check via `ACTION_NEEDED_STATUSES`); tap selects that group's (first/active) instance as the active terminal; `[+]` opens `SpawnModal`.
- Create: `apps/ipad/src/components/SpawnModal.tsx` — project radio list (from `useProjects`) + claude/shell toggle → `bridge.invoke('spawnInstance', { cwd: project.folderPath, instanceKind })`; on success, select the returned `instanceId`.

- [ ] **Step 1: Implement `Rail.tsx`** (Instances active, others disabled).
- [ ] **Step 2: Implement `TabStrip.tsx`** using shared `groupInstancesByProject` + `ACTION_NEEDED_STATUSES`. Recompute on instances change.
- [ ] **Step 3: Implement `SpawnModal.tsx`** (project picker + kind toggle → `spawnInstance`). Include a resume/restart affordance for a selected non-live instance via `restartInstance`.
- [ ] **Step 4: Build + commit**

Run: `npm run build --workspace @watchtower/ipad`
```bash
git add apps/ipad/src/components/Rail.tsx apps/ipad/src/components/TabStrip.tsx apps/ipad/src/components/SpawnModal.tsx
git commit -m "feat: #74 iPad Rail + TabStrip + SpawnModal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 11: Compose `App.tsx` + connection gate

**Files:**
- Rewrite: `apps/ipad/src/App.tsx` — keep the existing connection-form flow (host/port/token via `parseConnection`/`saveConnection`) as a first-run gate; once connected, render `<ConnectionProvider>` wrapping the module layout: `Rail` (left) + `TabStrip` (top) + active `TerminalView` (body), plus a disconnected/reconnecting banner driven by `status`.

- [ ] **Step 1: Implement the layout.** Reuse `connection.ts` helpers. On connect, construct the reconnecting transport in `ConnectionProvider` and mount the module. Show the reconnecting banner when `status !== 'connected'`.
- [ ] **Step 2: Build + typecheck the whole iPad app**

Run: `npm run build --workspace @watchtower/ipad`
Expected: clean build.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: green (all prior phase tests intact).

- [ ] **Step 4: Commit**

```bash
git add apps/ipad/src/App.tsx
git commit -m "feat: #74 iPad Instances module — compose App layout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 12: Capacitor sync + on-device manual acceptance

- [ ] **Step 1: Build + sync iOS**

Run:
```bash
npm run build --workspace @watchtower/ipad
cd apps/ipad && LANG=en_US.UTF-8 npx cap sync ios && LANG=en_US.UTF-8 npx cap open ios
```

- [ ] **Step 2: Start the Mac orchestrator with LAN binding**

Run (repo root): `WATCHTOWER_WS_HOST=auto npm run dev` — copy the `iPad connect → ws://…` host/port/token from the log.

- [ ] **Step 3: Run the manual acceptance checklist** (record results in the PR):
  - [ ] A session running on the Mac appears on the iPad with its **current screen** (replay), not blank.
  - [ ] Live output on the Mac mirrors to the iPad.
  - [ ] Typing on the iPad reaches the pty (visible on the Mac too).
  - [ ] Esc / Ctrl-C / Tab / arrows via the accessory bar work.
  - [ ] Focusing the iPad terminal resizes the pty to the iPad viewport; focusing the Mac takes it back (no thrash).
  - [ ] Spawn-into-project creates a session in the chosen project's folder.
  - [ ] Resume/restart of a non-live instance works.
  - [ ] ⚠️ badge appears on a project tab when a session is `waiting-permission`/`waiting-input`/`crashed`.
  - [ ] Killing a session on the Mac removes it from the iPad list.
  - [ ] Toggling Wi-Fi off/on shows the reconnecting banner, then re-attaches and re-seeds the active terminal.

- [ ] **Step 4: Open the PR** targeting `main`, referencing #74 and #77, with the acceptance results.

---

## Self-Review

**Spec coverage:**
- Block 1 (chrome) → Tasks 6, 10, 11. ✅
- Block 2 (attach+replay) → Tasks 1, 2, 7 (`attachTerminal`). ✅
- Block 3 (focus sizing) → Tasks 3, 4, 5. ✅
- Block 4 (spawn+resume) → Task 10 (`SpawnModal`). ✅
- Accessory bar → Tasks 7, 9. ✅
- Reconnection → Task 7 (`reconnectingTransport`), Task 11 (banner). ✅
- Shared extractions → Task 6. ✅
- New IPC kinds (`terminalAttach`, `terminalFocus`) added to contract + messagePort + handler → Tasks 2, 4. ✅
- Testing strategy (logic units + manual acceptance) → all tasks. ✅
- Non-goals (tiling #83, TLS #72, push #71, TT #69) → not in any task. ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Two test seams (`reconnectingTransport` fake `__fireClose`, Step 6/8) carry explicit reconcile notes rather than hand-waving. ✅

**Type consistency:** `serialize(id)`, `buildTerminalAttachResponse`, `PtySizeOwnership.{focus,recordResize,clientGone}`, `groupInstancesByProject`, `attachTerminal(bridge, instanceId, sink)`, `accessoryKeyToSequence`/`ctrlChar`, `createReconnectingTransport` — names used identically across defining and consuming tasks. IPC payload shapes match `ipcContract.ts` verbatim. ✅
