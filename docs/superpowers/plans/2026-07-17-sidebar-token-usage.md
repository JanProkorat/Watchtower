# Sidebar token-usage bars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live Session (5h) + Week (7d) usage bars in the bottom of the left `ModuleRail`, matching Claude Code's `/status` → Usage percentages, by wrapping the Claude `statusLine` command to tee its `rate_limits` JSON into Watchtower.

**Architecture:** A bundled `watchtower-statusline` helper wraps the user's existing statusline command: it POSTs the statusline JSON (containing `rate_limits`) to the orchestrator's localhost listener, then execs the inner command verbatim so the user's statusline is unchanged. The orchestrator stores the latest snapshot (in-memory + `settings` KV for cold start), pushes it to the renderer over the existing IPC transport, and the renderer renders `<SidebarUsage>` with a ccusage fallback for the session bar.

**Tech Stack:** TypeScript, Electron (main + `utilityProcess` orchestrator), Fastify localhost listener, esbuild-bundled Node helper, React + MUI v5 renderer, vitest.

## Global Constraints

- **UI text is English.** No i18n. Date/number formatting stays `cs-CZ` (not relevant here).
- **Backup convention:** any write to `~/.claude/settings.json` copies to `<path>.bak.<YYYYMMDD-HHMMSS>` first — use `writeSettings()` in `orchestrator/services/claudeSettings.ts`, which does this automatically.
- **All renderer IPC goes through `invoke()` in `apps/desktop/src/state/ipc.ts`** — never `window.watchtower.invoke` directly. Background polls go in `SILENT_KINDS`.
- **Never reach across SQLite directly** — renderer uses the IPC contract only.
- **Tests:** `npm test` must stay green (baseline 1300+; add tests for new code). `npm run typecheck:ci` green across workspaces.
- **Renderer root is `apps/desktop/src/`** (CLAUDE.md's `client/src/` is stale). Shared contract is `packages/shared/src/`.
- **DB is at migration v23** — the `settings` table is free-form KV; a new key needs **no** migration.
- **New IPC kinds must NOT be added to `ELECTRON_ONLY_KINDS`** — they must proxy to the orchestrator.

## UX decisions (locked)

- **Week bar when capture is OFF (no weekly data):** hide the Week bar entirely; show only the ccusage-backed Session bar.
- **Genuinely no data (capture off AND ccusage empty):** always render the `<SidebarUsage>` block with a muted "no usage data yet" placeholder.
- Payload lifecycle: keep a **separate** `rateLimits:usage` kind (not folded into `tokenUsage`).

## Data shapes (shared across tasks)

New file `packages/shared/src/rateLimitsFormat.ts`:

```ts
// Dependency-free (no Node/DOM/React) — same contract as tokenUsageFormat.ts.

/** One rolling-window limit as reported by Claude Code's statusline JSON. */
export interface RateLimitEntry {
  /** 0–100, from `rate_limits.<window>.used_percentage`. */
  usedPercent: number;
  /** Epoch **seconds**, from `rate_limits.<window>.resets_at`. */
  resetsAt: number;
}

/** Latest usage snapshot captured from a statusline render. */
export interface RateLimitsSnapshot {
  /** 5-hour rolling window; null if absent (API-key users / older CC). */
  session: RateLimitEntry | null;
  /** 7-day rolling window; null if absent. */
  week: RateLimitEntry | null;
  /** Epoch **ms** when the orchestrator received this snapshot. */
  capturedAt: number;
}

/** IPC payload for `rateLimits:usage` and the `rateLimitsUsage` push. */
export type RateLimitsPayload = RateLimitsSnapshot | null;

/** Shape of the relevant slice of Claude Code's statusline JSON. */
export interface StatuslineRateLimits {
  five_hour?: { used_percentage?: number; resets_at?: number } | null;
  seven_day?: { used_percentage?: number; resets_at?: number } | null;
}

/**
 * Extract a snapshot from a parsed statusline JSON body. Returns null when the
 * body carries no usable `rate_limits` (both windows absent). Never throws.
 * @param capturedAt epoch ms (injected for deterministic tests).
 */
export function extractRateLimits(body: unknown, capturedAt: number): RateLimitsSnapshot | null {
  if (!body || typeof body !== 'object') return null;
  const rl = (body as { rate_limits?: StatuslineRateLimits }).rate_limits;
  if (!rl || typeof rl !== 'object') return null;

  const entry = (w: { used_percentage?: number; resets_at?: number } | null | undefined): RateLimitEntry | null => {
    if (!w || typeof w !== 'object') return null;
    const usedPercent = w.used_percentage;
    const resetsAt = w.resets_at;
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return null;
    return { usedPercent, resetsAt: typeof resetsAt === 'number' ? resetsAt : 0 };
  };

  const session = entry(rl.five_hour);
  const week = entry(rl.seven_day);
  if (!session && !week) return null;
  return { session, week, capturedAt };
}
```

---

## Task 1 (#197): Orchestrator foundation — `POST /statusline`, snapshot store, IPC contract

**Files:**
- Create: `packages/shared/src/rateLimitsFormat.ts` (shapes + `extractRateLimits`, above)
- Modify: `packages/shared/src/ipcContract.ts` (request + response + push union entries)
- Modify: `packages/shared/src/messagePort.ts` (request + response + push union entries)
- Modify: `orchestrator/hookListener.ts` (add `onStatusline` option + `POST /statusline` route)
- Modify: `orchestrator/bootstrap.ts` (thread `onStatusline` through `startHookListener`)
- Modify: `orchestrator/index.ts` (snapshot cache, persistence, throttled push, `rateLimits:usage` handler, wire `onStatusline` closure, cold-start load)
- Modify: `apps/desktop/src/state/ipc.ts` (`SILENT_KINDS`)
- Test: `tests/shared/rateLimitsFormat.test.ts`, `tests/orchestrator/statuslineRoute.test.ts`

**Interfaces:**
- Produces: `RateLimitsPayload`, `RateLimitsSnapshot`, `extractRateLimits(body, capturedAt)` from `@watchtower/shared/rateLimitsFormat.js`; IPC request `rateLimits:usage` → `RateLimitsPayload`; push `rateLimitsUsage` → `RateLimitsPayload`; `settings` key `rate_limits_snapshot` (JSON of `RateLimitsSnapshot`).
- Consumes: `SettingsRepo` (`orchestrator/db/repositories/settings.ts`), `emitPush` + `HookListenerOptions` from existing orchestrator code.

- [ ] **Step 1: Write the failing test for `extractRateLimits`**

Create `tests/shared/rateLimitsFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractRateLimits } from '../../packages/shared/src/rateLimitsFormat.js';

const AT = 1_700_000_000_000;

describe('extractRateLimits', () => {
  it('extracts both windows from a full statusline body', () => {
    const snap = extractRateLimits(
      { rate_limits: { five_hour: { used_percentage: 42, resets_at: 1700010000 }, seven_day: { used_percentage: 71, resets_at: 1700600000 } } },
      AT,
    );
    expect(snap).toEqual({
      session: { usedPercent: 42, resetsAt: 1700010000 },
      week: { usedPercent: 71, resetsAt: 1700600000 },
      capturedAt: AT,
    });
  });

  it('returns null when rate_limits is absent', () => {
    expect(extractRateLimits({ session_id: 'x' }, AT)).toBeNull();
    expect(extractRateLimits(null, AT)).toBeNull();
    expect(extractRateLimits('nonsense', AT)).toBeNull();
  });

  it('keeps one window when only that window is present', () => {
    const snap = extractRateLimits({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 5 } } }, AT);
    expect(snap).toEqual({ session: { usedPercent: 10, resetsAt: 5 }, week: null, capturedAt: AT });
  });

  it('tolerates a missing resets_at (defaults to 0)', () => {
    const snap = extractRateLimits({ rate_limits: { five_hour: { used_percentage: 10 } } }, AT);
    expect(snap?.session).toEqual({ usedPercent: 10, resetsAt: 0 });
  });

  it('drops a window with a non-numeric used_percentage', () => {
    expect(extractRateLimits({ rate_limits: { five_hour: { used_percentage: 'x' } } }, AT)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/shared/rateLimitsFormat.test.ts`
Expected: FAIL — cannot resolve `rateLimitsFormat.js`.

- [ ] **Step 3: Create `packages/shared/src/rateLimitsFormat.ts`**

Use the exact contents from the **Data shapes** section above.

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run tests/shared/rateLimitsFormat.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the IPC contract entries**

In `packages/shared/src/ipcContract.ts`, add next to the existing `tokens:usage` / `tokenUsage` entries (find them by grep — do not trust line numbers):

```ts
// In the IpcRequest union (alongside `tokens:usage`):
  | { kind: 'rateLimits:usage'; payload: Record<string, never> }
// In the IpcResponse union:
  | { kind: 'rateLimits:usage'; payload: import('./rateLimitsFormat.js').RateLimitsPayload }
// In the IpcPush union:
  | { kind: 'rateLimitsUsage'; payload: import('./rateLimitsFormat.js').RateLimitsPayload }
```

Do **not** add `rateLimits:usage` to `ELECTRON_ONLY_KINDS`.

In `packages/shared/src/messagePort.ts`, mirror all three (note the request carries an `id`):

```ts
// request union:
  | { id: string; kind: 'rateLimits:usage'; payload: Record<string, never> }
// response union:
  | { kind: 'rateLimits:usage'; payload: import('./rateLimitsFormat.js').RateLimitsPayload }
// push union:
  | { kind: 'rateLimitsUsage'; payload: import('./rateLimitsFormat.js').RateLimitsPayload }
```

- [ ] **Step 6: Add `rateLimits:usage'` to `SILENT_KINDS`**

In `apps/desktop/src/state/ipc.ts`, add to the `SILENT_KINDS` set:

```ts
  'rateLimits:usage', // statusline-capture snapshot poll; card surfaces its own empty state
```

- [ ] **Step 7: Write the failing test for the `POST /statusline` route**

Create `tests/orchestrator/statuslineRoute.test.ts`. This starts the real listener with an injected `onStatusline` and posts a body:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startHookListener } from '../../orchestrator/hookListener.js';
import type { RateLimitsSnapshot } from '../../packages/shared/src/rateLimitsFormat.js';

describe('POST /statusline', () => {
  let stop: (() => Promise<void>) | null = null;
  let port = 0;
  const TOKEN = 'test-token';
  let received: unknown = undefined;

  beforeEach(async () => {
    received = undefined;
    const listener = await startHookListener({
      token: TOKEN,
      portRange: [7451, 7460],
      onEvent: async () => {},
      onStatusline: async (body) => {
        received = body;
      },
    });
    port = listener.port;
    stop = listener.stop;
  });

  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  const post = (headers: Record<string, string>, body: string) =>
    fetch(`http://127.0.0.1:${port}/statusline`, { method: 'POST', headers, body });

  it('rejects a missing/wrong bearer token with 401', async () => {
    const res = await post({ 'content-type': 'application/json' }, '{}');
    expect(res.status).toBe(401);
    expect(received).toBeUndefined();
  });

  it('accepts an authorized body and forwards the parsed JSON', async () => {
    const body = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 33, resets_at: 5 } } });
    const res = await post(
      { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body,
    );
    expect(res.status).toBe(204);
    expect(received).toEqual({ rate_limits: { five_hour: { used_percentage: 33, resets_at: 5 } } });
  });
});
```

Note: confirm the real `startHookListener` return shape (`{ port, stop }`) and `HookListenerOptions` field names by reading `orchestrator/hookListener.ts` first; adjust the harness call if the existing `onEvent` signature differs.

- [ ] **Step 8: Run it — expect FAIL**

Run: `npx vitest run tests/orchestrator/statuslineRoute.test.ts`
Expected: FAIL — `onStatusline` not in options / route 404.

- [ ] **Step 9: Add the route + option in `orchestrator/hookListener.ts`**

Extend `HookListenerOptions` with an optional callback, and register the route inside `startHookListener` mirroring the existing `POST /hooks/:event` handler (same Bearer check, same body-limit, replies 204):

```ts
// In HookListenerOptions:
  onStatusline?: (body: unknown, instanceId: string) => Promise<void> | void;
```

```ts
// Inside startHookListener, after the /hooks/:event route:
  app.post('/statusline', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const instanceId = String(req.headers['x-watchtower-instance'] ?? '');
    if (opts.onStatusline) {
      await opts.onStatusline(req.body, instanceId);
    }
    await reply.code(204).send();
  });
```

(Statusline captures need no instance id — do not 400 when it's absent, unlike `/hooks`.)

- [ ] **Step 10: Run the route test — expect PASS**

Run: `npx vitest run tests/orchestrator/statuslineRoute.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 11: Thread `onStatusline` through `orchestrator/bootstrap.ts`**

In `bootstrap.ts`, where `startHookListener({ ... onEvent, ... })` is called, add `onStatusline: opts.onStatusline` and add `onStatusline?` to the bootstrap options interface (mirror how `onHookEvent` is passed). Then in `orchestrator/index.ts`, in the `bootstrap({...})` call, pass an `onStatusline` closure (defined in the next step).

- [ ] **Step 12: Add snapshot cache + persistence + throttled push + handler in `orchestrator/index.ts`**

Mirror the `latestTokenUsage` / `refreshTokenUsage` block. Add near it:

```ts
import type { RateLimitsPayload, RateLimitsSnapshot } from '@watchtower/shared/rateLimitsFormat.js';
import { extractRateLimits } from '@watchtower/shared/rateLimitsFormat.js';

const RATE_LIMITS_SETTING_KEY = 'rate_limits_snapshot';
const RATE_LIMITS_PUSH_MIN_MS = 5_000;
let latestRateLimits: RateLimitsSnapshot | null = null;
let lastRateLimitsPushAt = 0;

/** Load the persisted snapshot at boot so cold start shows last-known usage. */
function loadPersistedRateLimits(db: SqliteLike): void {
  try {
    const raw = new SettingsRepo(db).getString(RATE_LIMITS_SETTING_KEY, '');
    if (raw) latestRateLimits = JSON.parse(raw) as RateLimitsSnapshot;
  } catch {
    /* ignore corrupt/absent snapshot */
  }
}

/** Handle a statusline POST: extract, persist, and throttle-push a snapshot. */
function onStatuslineBody(db: SqliteLike, body: unknown, now: number): void {
  const snap = extractRateLimits(body, now);
  if (!snap) return; // no rate_limits in this render — nothing to store
  latestRateLimits = snap;
  try {
    new SettingsRepo(db).set(RATE_LIMITS_SETTING_KEY, JSON.stringify(snap));
  } catch (err) {
    console.error('[rateLimits] persist failed:', err);
  }
  // Throttle the push: statuslines render every few seconds.
  if (now - lastRateLimitsPushAt >= RATE_LIMITS_PUSH_MIN_MS) {
    lastRateLimitsPushAt = now;
    emitPush({ kind: 'rateLimitsUsage', payload: snap });
  }
}
```

Wire the closure in the `bootstrap({...})` call:

```ts
    onStatusline: (body) => {
      if (handle) onStatuslineBody(handle.db, body, Date.now());
    },
```

Load persisted snapshot at boot (next to `startTokenUsagePolling()` in the boot callback), using the same db handle used elsewhere in that callback:

```ts
    loadPersistedRateLimits(handle.db);
```

Add the request handler `case` next to `tokens:usage`:

```ts
    case 'rateLimits:usage':
      return latestRateLimits as RateLimitsPayload;
```

Use the actual db-handle identifier from `index.ts` (grep `SettingsRepo(` — the token-usage/hubConfig code shows the correct `handle!.db` accessor). Match `SqliteLike` import already present.

- [ ] **Step 13: Typecheck + full test suite**

Run: `npm run typecheck:ci`
Expected: no new errors.
Run: `npm test`
Expected: green (new tests included).

- [ ] **Step 14: Commit**

```bash
git add packages/shared/src/rateLimitsFormat.ts packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/hookListener.ts orchestrator/bootstrap.ts orchestrator/index.ts apps/desktop/src/state/ipc.ts tests/shared/rateLimitsFormat.test.ts tests/orchestrator/statuslineRoute.test.ts
git commit -m "feat(usage): orchestrator POST /statusline route + rate-limits snapshot store + rateLimits:usage IPC (#197)"
```

---

## Task 2 (#198): `watchtower-statusline` capture helper + build wiring

**Files:**
- Create: `helper/watchtower-statusline.ts` (the wrapper helper)
- Modify: `helper/build.mjs` (second esbuild entry → `dist-helper/watchtower-statusline.mjs`)
- Test: `tests/helper/watchtowerStatusline.test.ts`

**Interfaces:**
- Consumes: `listener.json` (`{ port, token }`) in the support dir; the route `POST /statusline` from Task 1.
- Produces: `dist-helper/watchtower-statusline.mjs` (a `node` executable) reused by Task 3's installer; exported testable fns `postStatusline(body, cfg)` and `runInner(innerCmd, stdin)`.

**Behavior contract:** read stdin once → fire a best-effort POST of that JSON to the listener (≤250ms, never throws/stalls) → exec the inner command (argv-reconstructed) with the same stdin, streaming its stdout/exit code verbatim. If no inner command, print nothing and exit 0.

- [ ] **Step 1: Write the failing helper test**

Create `tests/helper/watchtowerStatusline.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { postStatusline, runInner } from '../../helper/watchtower-statusline.js';

describe('postStatusline', () => {
  let server: http.Server;
  let port = 0;
  let seen: { auth?: string; body?: string } = {};

  beforeEach(async () => {
    seen = {};
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen = { auth: req.headers.authorization, body: data };
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('POSTs the body with a bearer token', async () => {
    await postStatusline('{"rate_limits":{}}', { port, token: 'tok', instanceId: 'i1' });
    expect(seen.auth).toBe('Bearer tok');
    expect(seen.body).toBe('{"rate_limits":{}}');
  });

  it('resolves without throwing when the listener is down', async () => {
    await expect(
      postStatusline('{}', { port: 1, token: 'tok', instanceId: '' }),
    ).resolves.toBeUndefined();
  });
});

describe('runInner', () => {
  it('pipes stdin through to the inner command and returns its stdout+code', async () => {
    const { stdout, code } = await runInner('cat', '{"hello":1}');
    expect(stdout).toBe('{"hello":1}');
    expect(code).toBe(0);
  });

  it('is a no-op (empty output, code 0) when the inner command is empty', async () => {
    const { stdout, code } = await runInner('', 'ignored');
    expect(stdout).toBe('');
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/helper/watchtowerStatusline.test.ts`
Expected: FAIL — cannot resolve `helper/watchtower-statusline.js`.

- [ ] **Step 3: Create `helper/watchtower-statusline.ts`**

```ts
#!/usr/bin/env node
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function supportDir(): string {
  return (
    process.env.WATCHTOWER_SUPPORT_DIR ??
    path.join(homedir(), 'Library', 'Application Support', 'Watchtower')
  );
}

interface ListenerCfg {
  port: number;
  token: string;
  instanceId: string;
}

function discover(): ListenerCfg | null {
  try {
    const sidecar = JSON.parse(readFileSync(path.join(supportDir(), 'listener.json'), 'utf8')) as {
      port?: number;
      token?: string;
    };
    const port = Number(sidecar.port);
    const token = String(sidecar.token ?? '');
    if (!port || !token) return null;
    return { port, token, instanceId: process.env.WATCHTOWER_INSTANCE_ID ?? '' };
  } catch {
    return null;
  }
}

/** Fire-and-forget POST of the statusline body. Always resolves within ~250ms. */
export function postStatusline(body: string, cfg: ListenerCfg): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: cfg.port,
        method: 'POST',
        path: '/statusline',
        timeout: 250,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.token}`,
          'x-watchtower-instance': cfg.instanceId,
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
}

/** Run the user's original statusline command with `stdin`, capturing stdout. */
export function runInner(innerCmd: string, stdin: string): Promise<{ stdout: string; code: number }> {
  if (!innerCmd.trim()) return Promise.resolve({ stdout: '', code: 0 });
  return new Promise((resolve) => {
    const child = spawn(innerCmd, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.on('error', () => resolve({ stdout: '', code: 0 }));
    child.on('close', (code) => resolve({ stdout, code: code ?? 0 }));
    child.stdin.end(stdin);
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    // Guard: never hang if stdin never closes.
    setTimeout(finish, 500).unref?.();
  });
}

async function main(): Promise<void> {
  // The inner command is everything after argv[1], re-joined (installer sets it).
  const innerCmd = process.argv.slice(2).join(' ');
  const body = await readStdin();

  const cfg = discover();
  const post = cfg ? postStatusline(body, cfg) : Promise.resolve();
  const [{ stdout, code }] = await Promise.all([runInner(innerCmd, body), post]);

  process.stdout.write(stdout);
  process.exit(code);
}

// Only run main() when executed directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('watchtower-statusline.mjs')) {
  void main();
}
```

Note the guard at the bottom: tests import `postStatusline`/`runInner` without triggering `main()`. Confirm the ESM entry-point check works for the built `.mjs`; if the test imports the `.ts` (via vitest's TS handling) the guard's suffix check simply won't match, which is correct.

- [ ] **Step 4: Run the helper test — expect PASS**

Run: `npx vitest run tests/helper/watchtowerStatusline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the build entry in `helper/build.mjs`**

Add a second `build()` call mirroring the first, outputting `dist-helper/watchtower-statusline.mjs` with the same `#!/usr/bin/env node` banner:

```js
await build({
  entryPoints: [path.join(__dirname, 'watchtower-statusline.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(__dirname, '..', 'dist-helper', 'watchtower-statusline.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  minify: false,
});
```

- [ ] **Step 6: Verify the helper builds and runs end-to-end**

Run: `npm run build:helper`
Expected: `dist-helper/watchtower-statusline.mjs` created.
Run: `echo '{"rate_limits":{"five_hour":{"used_percentage":9,"resets_at":1}}}' | node dist-helper/watchtower-statusline.mjs 'cat'`
Expected: prints the JSON back verbatim (inner `cat` echoes stdin; POST silently no-ops with no listener), exit 0.

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run typecheck:ci` then `npm test`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add helper/watchtower-statusline.ts helper/build.mjs tests/helper/watchtowerStatusline.test.ts
git commit -m "feat(usage): watchtower-statusline capture helper (stdin -> POST -> chain inner) (#198)"
```

---

## Task 3 (#199): statusLine wrap/restore service + Settings toggle

**Files:**
- Create: `orchestrator/services/statuslineCapture.ts` (enable/disable/status logic)
- Modify: `orchestrator/index.ts` (`resolveStatuslineHelperPath()` + 2 IPC handler cases)
- Modify: `packages/shared/src/ipcContract.ts` + `packages/shared/src/messagePort.ts` (2 new kinds)
- Create: `apps/desktop/src/state/useStatuslineCapture.ts` (renderer hook)
- Modify: `apps/desktop/src/components/SettingsPanel.tsx` (the toggle row)
- Test: `tests/orchestrator/statuslineCapture.test.ts`

**Interfaces:**
- Consumes: `readSettings`/`writeSettings` (`orchestrator/services/claudeSettings.ts`), `SettingsRepo`, the helper path from Task 2.
- Produces: IPC `statuslineCapture:status` → `{ enabled: boolean; available: boolean }`; `statuslineCapture:set` payload `{ enabled: boolean }` → `{ ok: boolean; changed: boolean; backupPath: string | null; error?: string }`. Persisted inner command in `settings` key `statusline_inner_command`.

**Wrap contract:** enabling stores the current `statusLine.command` as the inner command (in the `settings` KV so restore survives backup pruning) and repoints `statusLine.command` at `node "<helperPath>" <innerCommand>`. Disabling restores `statusLine.command` to the stored inner command (removing the key if the inner was empty). Idempotent both ways. Detect "enabled" by whether `statusLine.command` currently references the helper path.

- [ ] **Step 1: Write the failing service test**

Create `tests/orchestrator/statuslineCapture.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { enableCapture, disableCapture, captureStatus } from '../../orchestrator/services/statuslineCapture.js';

const HELPER = '/opt/wt/dist-helper/watchtower-statusline.mjs';

describe('statusline capture wrap/restore', () => {
  let tmp: string;
  let settingsPath: string;
  const store = new Map<string, string>();
  const kv = {
    getString: (k: string, d: string) => store.get(k) ?? d,
    set: (k: string, v: string) => void store.set(k, v),
  };

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'wt-sl-'));
    mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    settingsPath = path.join(tmp, '.claude', 'settings.json');
    store.clear();
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const read = () => JSON.parse(readFileSync(settingsPath, 'utf8'));

  it('enable stores the inner command and repoints statusLine.command at the helper', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh --foo' } }));
    const r = enableCapture(settingsPath, HELPER, kv);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(store.get('statusline_inner_command')).toBe('ccline.sh --foo');
    expect(read().statusLine.command).toBe(`node "${HELPER}" ccline.sh --foo`);
    expect(r.backupPath).toBeTruthy();
  });

  it('enable with no prior statusLine wraps an empty inner command', () => {
    writeFileSync(settingsPath, JSON.stringify({}));
    const r = enableCapture(settingsPath, HELPER, kv);
    expect(r.ok).toBe(true);
    expect(store.get('statusline_inner_command')).toBe('');
    expect(read().statusLine.command).toBe(`node "${HELPER}" `);
  });

  it('enable is idempotent (already-wrapped command does not double-wrap)', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh' } }));
    enableCapture(settingsPath, HELPER, kv);
    const first = read().statusLine.command;
    const r2 = enableCapture(settingsPath, HELPER, kv);
    expect(r2.changed).toBe(false);
    expect(read().statusLine.command).toBe(first);
    expect(store.get('statusline_inner_command')).toBe('ccline.sh');
  });

  it('disable restores the stored inner command', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh --foo' } }));
    enableCapture(settingsPath, HELPER, kv);
    const r = disableCapture(settingsPath, HELPER, kv);
    expect(r.ok).toBe(true);
    expect(read().statusLine.command).toBe('ccline.sh --foo');
  });

  it('disable removes statusLine entirely when the inner command was empty', () => {
    writeFileSync(settingsPath, JSON.stringify({}));
    enableCapture(settingsPath, HELPER, kv);
    disableCapture(settingsPath, HELPER, kv);
    expect(read().statusLine).toBeUndefined();
  });

  it('captureStatus reports enabled only when statusLine points at the helper', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh' } }));
    expect(captureStatus(settingsPath, HELPER).enabled).toBe(false);
    enableCapture(settingsPath, HELPER, kv);
    expect(captureStatus(settingsPath, HELPER).enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/orchestrator/statuslineCapture.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `orchestrator/services/statuslineCapture.ts`**

```ts
import { readSettings, writeSettings } from './claudeSettings.js';

/** Minimal KV surface (SettingsRepo-compatible) for storing the inner command. */
export interface KvLike {
  getString(key: string, def: string): string;
  set(key: string, value: string): void;
}

const INNER_KEY = 'statusline_inner_command';

export interface CaptureResult {
  ok: boolean;
  changed: boolean;
  backupPath: string | null;
  error?: string;
}

interface ParsedSettings {
  statusLine?: { type?: string; command?: string } | undefined;
  [k: string]: unknown;
}

function parseGlobal(settingsPath: string): ParsedSettings {
  // readSettings resolves paths itself; here we read the exact file for testability.
  const raw = existsRaw(settingsPath);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ParsedSettings;
  } catch {
    return {};
  }
}

// Local file read that tolerates absence (writeSettings handles the write+backup).
import { existsSync, readFileSync } from 'node:fs';
function existsRaw(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function wrappedCommand(helperPath: string, inner: string): string {
  return `node "${helperPath}" ${inner}`;
}

function isWrapped(command: string | undefined, helperPath: string): boolean {
  return typeof command === 'string' && command.includes(helperPath);
}

/** True when the current statusLine.command points at our helper. */
export function captureStatus(
  settingsPath: string,
  helperPath: string,
): { enabled: boolean; available: boolean } {
  const parsed = parseGlobal(settingsPath);
  return { enabled: isWrapped(parsed.statusLine?.command, helperPath), available: true };
}

export function enableCapture(settingsPath: string, helperPath: string, kv: KvLike): CaptureResult {
  const parsed = parseGlobal(settingsPath);
  const current = parsed.statusLine?.command ?? '';
  if (isWrapped(current, helperPath)) {
    return { ok: true, changed: false, backupPath: null };
  }
  kv.set(INNER_KEY, current);
  parsed.statusLine = { type: 'command', command: wrappedCommand(helperPath, current) };
  const res = writeGlobal(settingsPath, parsed);
  return { ok: res.ok, changed: res.ok, backupPath: res.backupPath ?? null, error: res.error };
}

export function disableCapture(settingsPath: string, helperPath: string, kv: KvLike): CaptureResult {
  const parsed = parseGlobal(settingsPath);
  if (!isWrapped(parsed.statusLine?.command, helperPath)) {
    return { ok: true, changed: false, backupPath: null };
  }
  const inner = kv.getString(INNER_KEY, '');
  if (inner.trim()) {
    parsed.statusLine = { type: 'command', command: inner };
  } else {
    delete parsed.statusLine;
  }
  const res = writeGlobal(settingsPath, parsed);
  return { ok: res.ok, changed: res.ok, backupPath: res.backupPath ?? null, error: res.error };
}

// Reuse claudeSettings.writeSettings via 'project' scope pointed at the file's dir
// so we inherit the backup convention. settingsPath is <dir>/.claude/settings.json.
import path from 'node:path';
function writeGlobal(settingsPath: string, parsed: ParsedSettings): { ok: boolean; backupPath?: string; error?: string } {
  const projectDir = path.dirname(path.dirname(settingsPath)); // strip /.claude/settings.json
  return writeSettings('project', projectDir, JSON.stringify(parsed, null, 2));
}
```

Note: `writeGlobal` reuses `writeSettings('project', dir, …)` so the backup convention applies to any path (tests use a temp dir; production passes the real `~/.claude/settings.json` whose dir is `~`, i.e. call `writeSettings('global', undefined, …)` in production — see Step 5's handler, which chooses scope by whether the path is the global one). To keep the service path-driven and testable, the handler passes the resolved global path; adjust `writeGlobal` to accept an explicit scope if the global vs project distinction matters. Simpler: always pass the concrete path and derive the dir as above — `writeSettings` only uses the dir to rebuild `<dir>/.claude/settings.json`, which round-trips correctly for both `~` and a temp dir. Verify this round-trip in Step 4; if `resolveSettingsPath('project', '~')` doesn't reproduce `~/.claude/settings.json`, switch the production call to `writeSettings('global', undefined, …)` and branch in `writeGlobal` on `settingsPath === resolveSettingsPath('global')`.

- [ ] **Step 4: Run the service test — expect PASS**

Run: `npx vitest run tests/orchestrator/statuslineCapture.test.ts`
Expected: PASS (6 tests). If the `writeGlobal` dir round-trip fails for the temp path, fix per the note above before proceeding.

- [ ] **Step 5: Add IPC kinds + orchestrator handlers**

In `ipcContract.ts` and `messagePort.ts`, add (mirroring Task 1's mechanical pattern):

```ts
// ipcContract IpcRequest:
  | { kind: 'statuslineCapture:status'; payload: Record<string, never> }
  | { kind: 'statuslineCapture:set'; payload: { enabled: boolean } }
// ipcContract IpcResponse:
  | { kind: 'statuslineCapture:status'; payload: { enabled: boolean; available: boolean } }
  | { kind: 'statuslineCapture:set'; payload: { ok: boolean; changed: boolean; backupPath: string | null; error?: string } }
// messagePort request union (with id) + response union: same two, id on the requests.
```

In `orchestrator/index.ts`, add `resolveStatuslineHelperPath()` mirroring `resolveHelperPath()` (swap `watchtower-hook.mjs` → `watchtower-statusline.mjs`), and the two handler cases:

```ts
    case 'statuslineCapture:status':
      return captureStatus(userSettingsPath(), resolveStatuslineHelperPath());
    case 'statuslineCapture:set': {
      const helper = resolveStatuslineHelperPath();
      const p = userSettingsPath();
      const kv = new SettingsRepo(handle!.db);
      return req.payload.enabled ? enableCapture(p, helper, kv) : disableCapture(p, helper, kv);
    }
```

Import `captureStatus, enableCapture, disableCapture` from `./services/statuslineCapture.js`.

- [ ] **Step 6: Create the renderer hook `apps/desktop/src/state/useStatuslineCapture.ts`**

Mirror `useCloudSyncConfig` (status read on mount + `save`):

```ts
import { useCallback, useEffect, useState } from 'react';
import { invoke } from './ipc';

export interface StatuslineCaptureState {
  enabled: boolean;
  available: boolean;
  loading: boolean;
  save(enabled: boolean): Promise<void>;
}

export function useStatuslineCapture(): StatuslineCaptureState {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke('statuslineCapture:status', {});
      setEnabled(res.enabled);
      setAvailable(res.available);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: boolean) => {
      await invoke('statuslineCapture:set', { enabled: next });
      setEnabled(next);
    },
    [],
  );

  return { enabled, available, loading, save };
}
```

- [ ] **Step 7: Add the toggle row in `SettingsPanel.tsx`**

In the General settings panel, add a `SettingRow` with a `Switch` bound to the hook (import `Switch`, `FormControlLabel` from `@mui/material` if not present; import `useStatuslineCapture` from `../state/useStatuslineCapture`):

```tsx
const capture = useStatuslineCapture();
// …inside the render, in an appropriate section:
<SettingRow
  label="Capture usage from statusline"
  description="Wrap the Claude Code statusLine command so Watchtower can show Session + Week usage bars. Reversible; backs up settings.json."
>
  <Switch
    checked={capture.enabled}
    disabled={capture.loading || !capture.available}
    onChange={(e) => void capture.save(e.target.checked)}
    size="small"
  />
</SettingRow>
```

- [ ] **Step 8: Manual verification (enable → wrap, disable → restore)**

Since this mutates `~/.claude/settings.json`, verify against a temp HOME to avoid touching real config:

Run:
```bash
WT_TMP=$(mktemp -d) && mkdir -p "$WT_TMP/.claude" && printf '{"statusLine":{"type":"command","command":"echo hi"}}' > "$WT_TMP/.claude/settings.json"
node -e 'const s=require("./dist-orch/services/statuslineCapture.js"); const kv={_:{},getString(k,d){return this._[k]??d},set(k,v){this._[k]=v}}; const p=process.env.WT_TMP+"/.claude/settings.json"; console.log(s.enableCapture(p,"/x/watchtower-statusline.mjs",kv)); console.log(require("fs").readFileSync(p,"utf8")); console.log(s.disableCapture(p,"/x/watchtower-statusline.mjs",kv)); console.log(require("fs").readFileSync(p,"utf8"));'
```
Expected: after enable, `command` is `node "/x/watchtower-statusline.mjs" echo hi` + a `.bak.*` file exists; after disable, `command` is back to `echo hi`. (Requires `npm run build:orch` first, or run the vitest suite as the primary evidence.)

- [ ] **Step 9: Typecheck + full suite**

Run: `npm run typecheck:ci` then `npm test`
Expected: green.

- [ ] **Step 10: Commit**

```bash
git add orchestrator/services/statuslineCapture.ts orchestrator/index.ts packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts apps/desktop/src/state/useStatuslineCapture.ts apps/desktop/src/components/SettingsPanel.tsx tests/orchestrator/statuslineCapture.test.ts
git commit -m "feat(usage): statusLine wrap/restore service + Settings capture toggle (#199)"
```

---

## Task 4 (#200): `useRateLimits` hook + `<SidebarUsage>` in ModuleRail

**Files:**
- Create: `apps/desktop/src/state/useRateLimits.ts` (mirror `useTokenUsage`)
- Create: `apps/desktop/src/components/usage/severityColor.ts` (extracted from `TokenUsageCard`)
- Modify: `apps/desktop/src/components/dashboard/TokenUsageCard.tsx` (import the extracted `severityColor`)
- Create: `apps/desktop/src/components/SidebarUsage.tsx`
- Modify: `apps/desktop/src/components/ModuleRail.tsx` (render `<SidebarUsage collapsed={!expanded} />` after the flex spacer)
- Test: `tests/desktop/severityColor.test.ts`, `tests/desktop/SidebarUsage.test.tsx`

**Interfaces:**
- Consumes: `useRateLimits()` → `RateLimitsPayload`, `useTokenUsage()` (ccusage session fallback), `severityColor(pct)`, shared `usageSeverity`/`formatPercent`/`formatRemaining` from `@watchtower/shared/tokenUsageFormat.js`.
- Produces: `<SidebarUsage collapsed: boolean />`.

- [ ] **Step 1: Extract `severityColor` (refactor, keep behavior identical)**

Create `apps/desktop/src/components/usage/severityColor.ts` with the exact function currently private in `TokenUsageCard.tsx`:

```ts
/** Bar/accent color from ccusage status, falling back to % thresholds.
 * Returns an MUI palette path consumed directly in `sx`. */
export function severityColor(status: string | null, pct: number | null): string {
  if (status === 'exceeds') return 'error.main';
  if (status === 'warning') return 'warning.main';
  if (status === 'ok') return 'success.main';
  if (pct != null) {
    if (pct >= 90) return 'error.main';
    if (pct >= 75) return 'warning.main';
  }
  return 'primary.main';
}
```

- [ ] **Step 2: Write the failing test for the extraction**

Create `tests/desktop/severityColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { severityColor } from '../../apps/desktop/src/components/usage/severityColor.js';

describe('severityColor', () => {
  it('prefers ccusage status string', () => {
    expect(severityColor('exceeds', 10)).toBe('error.main');
    expect(severityColor('warning', 10)).toBe('warning.main');
    expect(severityColor('ok', 99)).toBe('success.main');
  });
  it('falls back to 90/75 percent bands', () => {
    expect(severityColor(null, 95)).toBe('error.main');
    expect(severityColor(null, 80)).toBe('warning.main');
    expect(severityColor(null, 50)).toBe('primary.main');
    expect(severityColor(null, null)).toBe('primary.main');
  });
});
```

- [ ] **Step 3: Run it — expect FAIL, then wire the import**

Run: `npx vitest run tests/desktop/severityColor.test.ts`
Expected: FAIL (module missing) → after Step 1 it PASSes. Then update `TokenUsageCard.tsx`: delete its local `severityColor` and `import { severityColor } from '../usage/severityColor';`. Confirm the path depth (`dashboard/` → `usage/` is `../usage/severityColor`).

- [ ] **Step 4: Run it — expect PASS + suite still green**

Run: `npx vitest run tests/desktop/severityColor.test.ts`
Expected: PASS. Run `npm test` to confirm TokenUsageCard tests still pass after the refactor.

- [ ] **Step 5: Create `useRateLimits` hook**

Create `apps/desktop/src/state/useRateLimits.ts` (clone of `useTokenUsage`):

```ts
import { useCallback, useEffect, useState } from 'react';
import type { RateLimitsPayload } from '@watchtower/shared/rateLimitsFormat.js';
import { invoke } from './ipc';

export interface RateLimitsState {
  data: RateLimitsPayload;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/** Latest statusline-captured rate-limit snapshot; live via `rateLimitsUsage`. */
export function useRateLimits(): RateLimitsState {
  const [data, setData] = useState<RateLimitsPayload>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await invoke('rateLimits:usage', {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.watchtower.on('rateLimitsUsage', (payload) => {
      setData(payload);
      setLoading(false);
      setError(null);
    });
    return off;
  }, [refresh]);

  return { data, loading, error, refresh };
}
```

- [ ] **Step 6: Write the failing `<SidebarUsage>` test**

Create `tests/desktop/SidebarUsage.test.tsx`. Mock both hooks so the component renders deterministically. (Confirm the repo's renderer test setup — jsdom + `@testing-library/react` — by checking an existing `*.test.tsx`; match its imports/provider wrapper.)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { buildTheme } from '../../apps/desktop/src/theme'; // adjust to the real theme export
import { SidebarUsage } from '../../apps/desktop/src/components/SidebarUsage';

const rl = vi.hoisted(() => ({ value: null as unknown }));
const tu = vi.hoisted(() => ({ value: { data: null } as unknown }));
vi.mock('../../apps/desktop/src/state/useRateLimits', () => ({ useRateLimits: () => ({ data: rl.value, loading: false, error: null, refresh: vi.fn() }) }));
vi.mock('../../apps/desktop/src/state/useTokenUsage', () => ({ useTokenUsage: () => tu.value }));

const renderIt = (collapsed = false) =>
  render(
    <ThemeProvider theme={buildTheme('dark')}>
      <SidebarUsage collapsed={collapsed} />
    </ThemeProvider>,
  );

describe('SidebarUsage', () => {
  it('shows a muted placeholder when there is no data at all', () => {
    rl.value = null;
    tu.value = { data: null };
    renderIt();
    expect(screen.getByText(/no usage data/i)).toBeInTheDocument();
  });

  it('shows Session + Week bars when rate-limit data is present', () => {
    rl.value = { session: { usedPercent: 42, resetsAt: 0 }, week: { usedPercent: 71, resetsAt: 0 }, capturedAt: Date.now() };
    tu.value = { data: null };
    renderIt();
    expect(screen.getByText(/session/i)).toBeInTheDocument();
    expect(screen.getByText(/week/i)).toBeInTheDocument();
    expect(screen.getByText(/42\s*%/)).toBeInTheDocument();
    expect(screen.getByText(/71\s*%/)).toBeInTheDocument();
  });

  it('hides the Week bar and uses ccusage for Session when capture is off (no rate-limit data)', () => {
    rl.value = null;
    tu.value = { data: { available: true, block: { currentPercentUsed: 55, status: 'ok', endTime: Date.now() + 3_600_000 } } };
    renderIt();
    expect(screen.getByText(/session/i)).toBeInTheDocument();
    expect(screen.queryByText(/week/i)).toBeNull();
    expect(screen.getByText(/55\s*%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run it — expect FAIL**

Run: `npx vitest run tests/desktop/SidebarUsage.test.tsx`
Expected: FAIL — `SidebarUsage` missing.

- [ ] **Step 8: Create `apps/desktop/src/components/SidebarUsage.tsx`**

Implements the locked UX: Session bar uses `rateLimits.session?.usedPercent ?? ccusage.currentPercentUsed`; Week bar renders only when `rateLimits.week` exists; if neither Session source nor Week has data, render the muted placeholder. Collapsed mode uses `S`/`W` tags. Use `severityColor` for bar color, `formatPercent` for labels, `LinearProgress` styled like `TokenUsageCard` (height 6, borderRadius 1).

```tsx
import { Box, Divider, LinearProgress, Tooltip, Typography } from '@mui/material';
import { formatPercent } from '@watchtower/shared/tokenUsageFormat.js';
import { useRateLimits } from '../state/useRateLimits';
import { useTokenUsage } from '../state/useTokenUsage';
import { severityColor } from './usage/severityColor';

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <LinearProgress
      variant="determinate"
      value={Math.min(100, Math.max(0, value))}
      sx={{ height: 6, borderRadius: 1, backgroundColor: 'background.default', '& .MuiLinearProgress-bar': { backgroundColor: color } }}
    />
  );
}

export function SidebarUsage({ collapsed }: { collapsed: boolean }) {
  const { data: rl } = useRateLimits();
  const tokens = useTokenUsage();

  const ccPct = tokens.data?.available ? (tokens.data.block?.currentPercentUsed ?? null) : null;
  const ccStatus = tokens.data?.available ? (tokens.data.block?.status ?? null) : null;

  const sessionPct = rl?.session?.usedPercent ?? ccPct;
  const weekPct = rl?.week?.usedPercent ?? null;

  const hasAny = sessionPct != null || weekPct != null;
  if (!hasAny) {
    return (
      <Box sx={{ px: collapsed ? 0.5 : 1, py: 1 }}>
        <Divider sx={{ mb: 1 }} />
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center' }}>
          no usage data yet
        </Typography>
      </Box>
    );
  }

  const rows = [
    sessionPct != null ? { key: 'session', label: 'Session', tag: 'S', pct: sessionPct, status: rl?.session ? null : ccStatus } : null,
    weekPct != null ? { key: 'week', label: 'Week', tag: 'W', pct: weekPct, status: null } : null,
  ].filter(Boolean) as { key: string; label: string; tag: string; pct: number; status: string | null }[];

  return (
    <Box sx={{ px: collapsed ? 0.5 : 1, py: 1 }}>
      <Divider sx={{ mb: 1 }} />
      {rows.map((r) => {
        const color = severityColor(r.status, r.pct);
        return (
          <Tooltip key={r.key} title={`${r.label}: ${formatPercent(r.pct)}`} placement="right">
            <Box sx={{ mb: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography variant="caption" color="text.secondary">{collapsed ? r.tag : r.label}</Typography>
                {!collapsed && <Typography variant="caption" color="text.secondary">{formatPercent(r.pct)}</Typography>}
              </Box>
              <Bar value={r.pct} color={color} />
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
```

Confirm the real shape of `tokens.data` (`TokenUsagePayload`) — the research shows `{ available, block: { currentPercentUsed, status, endTime } | null, error }`; adjust the `ccPct`/`ccStatus` access to the exact field names. Confirm `formatPercent` exists and accepts a number (it does per the shared util); if its signature differs, format inline as `` `${Math.round(pct)}%` ``.

- [ ] **Step 9: Run the component test — expect PASS**

Run: `npx vitest run tests/desktop/SidebarUsage.test.tsx`
Expected: PASS (3 tests). Fix hook-shape mismatches surfaced here.

- [ ] **Step 10: Insert `<SidebarUsage>` into `ModuleRail.tsx`**

Import it, and render it between the flex spacer and the light/dark toggle (after `<Box sx={{ flex: 1 }} />`):

```tsx
import { SidebarUsage } from './SidebarUsage';
// …
      <Box sx={{ flex: 1 }} />

      <SidebarUsage collapsed={!expanded} />

      {!expanded && (
        // …existing light/dark toggle
```

- [ ] **Step 11: Run the app and verify visually**

Run: `npm run dev` (or the project's `run` skill). With a live Claude session and capture enabled, confirm: expanded rail shows Session + Week bars pinned above the collapse button; collapsed rail shows `S`/`W` mini bars; with capture off, only the ccusage Session bar shows; with no data, the "no usage data yet" placeholder shows. Toggle collapse to check both layouts.

- [ ] **Step 12: Typecheck + full suite**

Run: `npm run typecheck:ci` then `npm test`
Expected: green.

- [ ] **Step 13: Commit**

```bash
git add apps/desktop/src/state/useRateLimits.ts apps/desktop/src/components/usage/severityColor.ts apps/desktop/src/components/dashboard/TokenUsageCard.tsx apps/desktop/src/components/SidebarUsage.tsx apps/desktop/src/components/ModuleRail.tsx tests/desktop/severityColor.test.ts tests/desktop/SidebarUsage.test.tsx
git commit -m "feat(usage): useRateLimits hook + SidebarUsage bars in ModuleRail (#200)"
```

---

## Final integration check (after all four tasks)

- [ ] Full end-to-end: `npm run build` (main + orch + renderer + helper) succeeds.
- [ ] `npm run typecheck:ci` green across all workspaces.
- [ ] `npm test` green.
- [ ] Enable the Settings toggle → `~/.claude/settings.json` `statusLine.command` is wrapped + a `.bak.*` exists → a live Claude session renders → sidebar shows real Session + Week % matching `/status` → disable restores the original command.
- [ ] Whole-branch review (per the SDD cross-task lesson): verify the `RateLimitsSnapshot` shape is produced identically by `extractRateLimits` (orchestrator) and consumed by `SidebarUsage` (renderer) — the `resetsAt` seconds vs `capturedAt` ms distinction and the `session`/`week` nullability must line up end-to-end.

## Self-review notes

- **Spec coverage:** capture helper (#198 → Task 2), install/restore + toggle (#199 → Task 3), orchestrator route + store + IPC (#197 → Task 1), renderer hook + SidebarUsage (#200 → Task 4). ccusage session fallback (Task 4 Step 8). Week "unavailable"/hidden when off (locked UX, Task 4). Backup convention (Task 3 via `writeSettings`). Cold-start persistence (Task 1 Step 12). Throttled push (Task 1 Step 12). All covered.
- **Type consistency:** `RateLimitsSnapshot`/`RateLimitsPayload`/`extractRateLimits` defined once in `rateLimitsFormat.ts` and referenced everywhere; `severityColor` signature `(status, pct)` identical in extraction and both call sites.
- **Open verification points flagged inline** (not placeholders): exact `hookListener` option/return names (Task 1 Step 7/9), `index.ts` db-handle accessor (Task 1 Step 12), `writeGlobal` scope round-trip (Task 3 Step 3/4), `TokenUsagePayload` field names + renderer test harness (Task 4 Step 8/6). These are "read the real file and confirm" checks, with fallback instructions given for each.
