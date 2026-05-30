# Slack Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escalate to a Slack DM when a managed Claude instance needs the user, the app window is unfocused, and no engagement happens within N minutes — and let the user reply in Slack to inject input into the waiting session.

**Architecture:** A new `SlackEscalator` (per-instance timers, the Slack analog of `QuietTimers`/`Notifier`) hangs off the existing `applyTransition` fan-out in `orchestrator/index.ts`. It posts via a `SlackClient` wrapper over `@slack/web-api`. A `SlackListener` (Socket Mode) receives replies and routes them through a pure `routeReply` into the existing `pty.write` path. Config lives in the existing `settings` SQLite table; a new Settings tab edits it.

**Tech Stack:** TypeScript (NodeNext ESM), Electron utilityProcess orchestrator, React + MUI v5 renderer, vitest, `@slack/web-api`, `@slack/socket-mode`.

**Spec:** `docs/superpowers/specs/2026-05-30-slack-escalation-design.md`

**Conventions to honor (from CLAUDE.md):**
- Adding an IPC kind = (1) `shared/ipcContract.ts` `IpcRequest`+`IpcResponse`, (2) mirror in `shared/messagePort.ts` `OrchRequest`+`OrchResponse`, (3) handler in `orchestrator/index.ts`, (4) thin hook in `client/src/state/`.
- All new `.js` imports in `.ts` files (NodeNext): import sibling modules with the `.js` extension.
- Keep test count growing (219+ rule). No real network in tests.
- Commit after each task.

---

## File Structure

**Create:**
- `shared/slackConfig.ts` — `SlackConfig` type, `DEFAULT_SLACK_CONFIG`, setting-key constants. Shared by orchestrator + renderer.
- `orchestrator/services/slackConfig.ts` — `readSlackConfig` / `writeSlackConfig` mapping the typed config to/from the `settings` table.
- `orchestrator/services/slackClient.ts` — `SlackClient` interface + `WebApiSlackClient` impl over `@slack/web-api`.
- `orchestrator/slackEscalator.ts` — `SlackEscalator` class (timers + decision).
- `orchestrator/slackReply.ts` — pure `routeReply` + `InboundMessage` type (phase 2).
- `orchestrator/slackListener.ts` — Socket Mode socket wiring (phase 2).
- `client/src/state/useSlackConfig.ts` — renderer hook.
- `client/src/components/settings/SlackTab.tsx` — Settings UI panel.
- Tests: `tests/shared/slackConfig.test.ts`, `tests/orchestrator/services/slackConfig.test.ts`, `tests/orchestrator/slackEscalator.test.ts`, `tests/orchestrator/slackReply.test.ts`.

**Modify:**
- `shared/ipcContract.ts` — add `slack:getConfig`/`slack:setConfig`/`slack:test` to `IpcRequest`+`IpcResponse`.
- `shared/messagePort.ts` — mirror the three kinds + add `windowFocusChanged` to `OrchRequest`/`OrchResponse`.
- `orchestrator/index.ts` — construct escalator + listener, fan out in `applyTransition`, handle new kinds, thread-map, window focus.
- `electron/main.ts` — forward `BrowserWindow` focus/blur to the orchestrator.
- `client/src/util/settingsUrl.ts` — add `'slack'` to `SETTINGS_TABS`.
- `client/src/components/ModuleRail.tsx` — add the Slack rail entry.
- `client/src/components/settings/ModuleSettings.tsx` — route `tab === 'slack'` → `<SlackTab/>`.
- `package.json` — add `@slack/web-api`, `@slack/socket-mode` dependencies.

---

# PHASE 0 — Dependencies & shared types

### Task 1: Install Slack SDKs

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install**

```bash
npm install @slack/web-api @slack/socket-mode
```

- [ ] **Step 2: Verify orchestrator still builds**

Run: `npm run build:orch`
Expected: exits 0 (tsc compiles; SDKs resolve from node_modules — `build:orch` does not bundle, so no externalization needed).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @slack/web-api and @slack/socket-mode deps"
```

---

### Task 2: Shared SlackConfig type

**Files:**
- Create: `shared/slackConfig.ts`
- Test: `tests/shared/slackConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/slackConfig.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SLACK_CONFIG, SLACK_SETTING_KEYS } from '../../shared/slackConfig.js';

describe('slackConfig defaults', () => {
  it('defaults to disabled with all triggers on and a 5-minute escalation', () => {
    expect(DEFAULT_SLACK_CONFIG.enabled).toBe(false);
    expect(DEFAULT_SLACK_CONFIG.escalateMs).toBe(300_000);
    expect(DEFAULT_SLACK_CONFIG.triggers).toEqual({ permission: true, idle: true, crash: true });
  });

  it('exposes a setting key for every persisted field', () => {
    expect(SLACK_SETTING_KEYS.enabled).toBe('slack_enabled');
    expect(SLACK_SETTING_KEYS.botToken).toBe('slack_bot_token');
    expect(SLACK_SETTING_KEYS.appToken).toBe('slack_app_token');
    expect(SLACK_SETTING_KEYS.dmUserId).toBe('slack_dm_user_id');
    expect(SLACK_SETTING_KEYS.escalateMs).toBe('slack_escalate_ms');
    expect(SLACK_SETTING_KEYS.triggers).toBe('slack_triggers');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/slackConfig.test.ts`
Expected: FAIL — cannot find module `shared/slackConfig.js`.

- [ ] **Step 3: Create the module**

```ts
// shared/slackConfig.ts
export interface SlackTriggers {
  permission: boolean;
  idle: boolean;
  crash: boolean;
}

export interface SlackConfig {
  enabled: boolean;
  /** xoxb- bot token used to post messages. */
  botToken: string;
  /** xapp- app-level token used for Socket Mode (receiving replies). */
  appToken: string;
  /** Slack user id the bot should DM. */
  dmUserId: string;
  /** Escalate to Slack after this many ms of no engagement. */
  escalateMs: number;
  triggers: SlackTriggers;
}

export const DEFAULT_SLACK_CONFIG: SlackConfig = {
  enabled: false,
  botToken: '',
  appToken: '',
  dmUserId: '',
  escalateMs: 300_000,
  triggers: { permission: true, idle: true, crash: true },
};

export const SLACK_SETTING_KEYS = {
  enabled: 'slack_enabled',
  botToken: 'slack_bot_token',
  appToken: 'slack_app_token',
  dmUserId: 'slack_dm_user_id',
  escalateMs: 'slack_escalate_ms',
  triggers: 'slack_triggers',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/slackConfig.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/slackConfig.ts tests/shared/slackConfig.test.ts
git commit -m "feat(slack): shared SlackConfig type and setting keys"
```

---

# PHASE 1 — One-way escalation (shippable)

### Task 3: Config read/write mapping

**Files:**
- Create: `orchestrator/services/slackConfig.ts`
- Test: `tests/orchestrator/services/slackConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/services/slackConfig.test.ts
import { describe, it, expect } from 'vitest';
import { SettingsRepo } from '../../../orchestrator/db/repositories/settings.js';
import { readSlackConfig, writeSlackConfig } from '../../../orchestrator/services/slackConfig.js';
import { DEFAULT_SLACK_CONFIG } from '../../../shared/slackConfig.js';

/** Minimal in-memory stand-in for the SqliteLike surface SettingsRepo uses. */
function fakeDb() {
  const store = new Map<string, string>();
  return {
    prepare(sql: string) {
      if (sql.startsWith('SELECT')) {
        return { get: (key: string) => (store.has(key) ? { value: store.get(key) } : undefined) };
      }
      return { run: (key: string, value: string) => store.set(key, value) };
    },
  } as any;
}

describe('slackConfig read/write', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readSlackConfig(new SettingsRepo(fakeDb()))).toEqual(DEFAULT_SLACK_CONFIG);
  });

  it('round-trips a full config', () => {
    const repo = new SettingsRepo(fakeDb());
    const cfg = {
      enabled: true,
      botToken: 'xoxb-1',
      appToken: 'xapp-1',
      dmUserId: 'U123',
      escalateMs: 120_000,
      triggers: { permission: true, idle: false, crash: true },
    };
    writeSlackConfig(repo, cfg);
    expect(readSlackConfig(repo)).toEqual(cfg);
  });

  it('falls back to default escalateMs when the stored value is junk', () => {
    const repo = new SettingsRepo(fakeDb());
    repo.set('slack_escalate_ms', 'not-a-number');
    expect(readSlackConfig(repo).escalateMs).toBe(DEFAULT_SLACK_CONFIG.escalateMs);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/services/slackConfig.test.ts`
Expected: FAIL — cannot find module `slackConfig.js`.

- [ ] **Step 3: Implement the mapping**

```ts
// orchestrator/services/slackConfig.ts
import type { SettingsRepo } from '../db/repositories/settings.js';
import { DEFAULT_SLACK_CONFIG, SLACK_SETTING_KEYS, type SlackConfig, type SlackTriggers } from '../../shared/slackConfig.js';

function parseTriggers(raw: string): SlackTriggers {
  try {
    const p = JSON.parse(raw) as Partial<SlackTriggers>;
    return {
      permission: p.permission ?? DEFAULT_SLACK_CONFIG.triggers.permission,
      idle: p.idle ?? DEFAULT_SLACK_CONFIG.triggers.idle,
      crash: p.crash ?? DEFAULT_SLACK_CONFIG.triggers.crash,
    };
  } catch {
    return { ...DEFAULT_SLACK_CONFIG.triggers };
  }
}

export function readSlackConfig(settings: SettingsRepo): SlackConfig {
  return {
    enabled: settings.getString(SLACK_SETTING_KEYS.enabled, DEFAULT_SLACK_CONFIG.enabled ? '1' : '0') === '1',
    botToken: settings.getString(SLACK_SETTING_KEYS.botToken, DEFAULT_SLACK_CONFIG.botToken),
    appToken: settings.getString(SLACK_SETTING_KEYS.appToken, DEFAULT_SLACK_CONFIG.appToken),
    dmUserId: settings.getString(SLACK_SETTING_KEYS.dmUserId, DEFAULT_SLACK_CONFIG.dmUserId),
    escalateMs: settings.getNumber(SLACK_SETTING_KEYS.escalateMs, DEFAULT_SLACK_CONFIG.escalateMs),
    triggers: parseTriggers(settings.getString(SLACK_SETTING_KEYS.triggers, '')),
  };
}

export function writeSlackConfig(settings: SettingsRepo, cfg: SlackConfig): void {
  settings.set(SLACK_SETTING_KEYS.enabled, cfg.enabled ? '1' : '0');
  settings.set(SLACK_SETTING_KEYS.botToken, cfg.botToken);
  settings.set(SLACK_SETTING_KEYS.appToken, cfg.appToken);
  settings.set(SLACK_SETTING_KEYS.dmUserId, cfg.dmUserId);
  settings.set(SLACK_SETTING_KEYS.escalateMs, String(cfg.escalateMs));
  settings.set(SLACK_SETTING_KEYS.triggers, JSON.stringify(cfg.triggers));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/services/slackConfig.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/slackConfig.ts tests/orchestrator/services/slackConfig.test.ts
git commit -m "feat(slack): read/write SlackConfig from the settings table"
```

---

### Task 4: SlackClient wrapper

**Files:**
- Create: `orchestrator/services/slackClient.ts`

No unit test (thin network wrapper; exercised via the fake in escalator/test paths). Typecheck is the gate.

- [ ] **Step 1: Implement the interface + WebApi impl**

```ts
// orchestrator/services/slackClient.ts
import { WebClient } from '@slack/web-api';

export interface SlackPostResult {
  channel: string;
  ts: string;
}

export interface SlackClient {
  /** Open (or fetch) the DM channel with the configured user; returns channel id. */
  openDm(userId: string): Promise<string>;
  postMessage(channel: string, text: string, threadTs?: string): Promise<SlackPostResult>;
  updateMessage(channel: string, ts: string, text: string): Promise<void>;
  /** auth.test — confirms the bot token is valid. */
  testAuth(): Promise<{ ok: boolean; userId?: string; error?: string }>;
}

export class WebApiSlackClient implements SlackClient {
  private web: WebClient;
  constructor(botToken: string) {
    this.web = new WebClient(botToken);
  }

  async openDm(userId: string): Promise<string> {
    const res = await this.web.conversations.open({ users: userId });
    const channel = res.channel?.id;
    if (!channel) throw new Error('conversations.open returned no channel id');
    return channel;
  }

  async postMessage(channel: string, text: string, threadTs?: string): Promise<SlackPostResult> {
    const res = await this.web.chat.postMessage({ channel, text, thread_ts: threadTs });
    if (!res.ok || !res.ts) throw new Error(`chat.postMessage failed: ${res.error ?? 'unknown'}`);
    return { channel, ts: res.ts };
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    await this.web.chat.update({ channel, ts, text });
  }

  async testAuth(): Promise<{ ok: boolean; userId?: string; error?: string }> {
    try {
      const res = await this.web.auth.test();
      return { ok: Boolean(res.ok), userId: res.user_id as string | undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no new errors (pre-existing drift noted in CLAUDE.md is acceptable).

- [ ] **Step 3: Commit**

```bash
git add orchestrator/services/slackClient.ts
git commit -m "feat(slack): WebApiSlackClient wrapper over @slack/web-api"
```

---

### Task 5: SlackEscalator (timers + decision)

**Files:**
- Create: `orchestrator/slackEscalator.ts`
- Test: `tests/orchestrator/slackEscalator.test.ts`

The escalator mirrors `Notifier`/`QuietTimers`: `apply(prev,next)` arms or clears a per-instance timer; on fire it re-checks window focus before posting; crashes post immediately. It reads config through an injected getter so config edits take effect without reconstruction.

- [ ] **Step 1: Write the failing test (use fake timers)**

```ts
// tests/orchestrator/slackEscalator.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackEscalator } from '../../orchestrator/slackEscalator.js';
import { DEFAULT_SLACK_CONFIG, type SlackConfig } from '../../shared/slackConfig.js';

function makeEscalator(overrides: Partial<SlackConfig> = {}) {
  const config: SlackConfig = { ...DEFAULT_SLACK_CONFIG, enabled: true, escalateMs: 1000, ...overrides };
  const posts: Array<{ id: string; kind: string }> = [];
  const esc = new SlackEscalator(
    () => config,
    { post: (id, _cwd, kind) => posts.push({ id, kind }) },
  );
  return { esc, posts, config };
}

describe('SlackEscalator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('posts after escalateMs when the user never engages and the window is blurred', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'waiting-permission');
    expect(posts).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(posts).toEqual([{ id: 'a', kind: 'waiting-permission' }]);
  });

  it('does NOT post if the window is focused when the timer fires', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(true);
    esc.apply('a', '/cwd', 'working', 'idle-notify');
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('cancels the timer when the instance leaves the attention state', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'waiting-permission');
    esc.apply('a', '/cwd', 'waiting-permission', 'working'); // user engaged
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('posts crashes immediately (no timer) when the window is blurred', () => {
    const { esc, posts } = makeEscalator();
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'crashed');
    expect(posts).toEqual([{ id: 'a', kind: 'crashed' }]);
  });

  it('respects disabled config and per-trigger toggles', () => {
    const { esc, posts } = makeEscalator({ triggers: { permission: false, idle: true, crash: true } });
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'waiting-permission'); // permission trigger off
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });

  it('does nothing when disabled entirely', () => {
    const { esc, posts } = makeEscalator({ enabled: false });
    esc.setWindowFocused(false);
    esc.apply('a', '/cwd', 'working', 'idle-notify');
    vi.advanceTimersByTime(1000);
    expect(posts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/slackEscalator.test.ts`
Expected: FAIL — cannot find module `slackEscalator.js`.

- [ ] **Step 3: Implement**

```ts
// orchestrator/slackEscalator.ts
import type { InstanceStatus } from '../shared/stateModel.js';
import type { SlackConfig } from '../shared/slackConfig.js';

export type SlackEscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed';

export interface SlackEscalatorEmitters {
  /** Fire-and-forget: the orchestrator turns this into an async Slack post. */
  post(instanceId: string, cwd: string, kind: SlackEscalationKind): void;
}

const ATTENTION: ReadonlyArray<InstanceStatus> = ['waiting-permission', 'idle-notify'];

/**
 * Second escalation tier on top of the macOS Notifier: when an instance is
 * waiting on the user and the app window is unfocused, ping Slack after
 * `escalateMs`. Engagement (which moves the instance out of an attention
 * state) cancels the pending timer. Crashes ping immediately.
 */
export class SlackEscalator {
  private timers = new Map<string, NodeJS.Timeout>();
  private windowFocused = true;

  constructor(
    private getConfig: () => SlackConfig,
    private emit: SlackEscalatorEmitters,
  ) {}

  setWindowFocused(focused: boolean): void {
    this.windowFocused = focused;
  }

  apply(instanceId: string, cwd: string, prev: InstanceStatus, next: InstanceStatus): void {
    if (prev === next) return;
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      this.clear(instanceId);
      return;
    }

    if (next === 'crashed') {
      if (cfg.triggers.crash && !this.windowFocused) this.emit.post(instanceId, cwd, 'crashed');
      this.clear(instanceId);
      return;
    }

    const entered = ATTENTION.includes(next) && !ATTENTION.includes(prev);
    const left = ATTENTION.includes(prev) && !ATTENTION.includes(next);

    if (left) {
      this.clear(instanceId);
      return;
    }
    if (!entered) return;

    const wanted =
      (next === 'waiting-permission' && cfg.triggers.permission) ||
      (next === 'idle-notify' && cfg.triggers.idle);
    if (!wanted) return;

    const kind = next as SlackEscalationKind;
    this.clear(instanceId);
    const t = setTimeout(() => {
      this.timers.delete(instanceId);
      if (!this.windowFocused) this.emit.post(instanceId, cwd, kind);
    }, cfg.escalateMs);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/slackEscalator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/slackEscalator.ts tests/orchestrator/slackEscalator.test.ts
git commit -m "feat(slack): SlackEscalator per-instance escalation timers"
```

---

### Task 6: IPC contract — slack kinds + window focus

**Files:**
- Modify: `shared/ipcContract.ts`
- Modify: `shared/messagePort.ts`

- [ ] **Step 1: Add to `IpcRequest` in `shared/ipcContract.ts`**

Add these lines to the `IpcRequest` union (next to `setSetting`). Add `import type { SlackConfig } from './slackConfig.js';` at the top of the file.

```ts
  | { kind: 'slack:getConfig'; payload: Record<string, never> }
  | { kind: 'slack:setConfig'; payload: { config: SlackConfig } }
  | { kind: 'slack:test'; payload: Record<string, never> }
```

- [ ] **Step 2: Add matching members to `IpcResponse` in `shared/ipcContract.ts`**

```ts
  | { kind: 'slack:getConfig'; payload: { config: SlackConfig; connected: boolean } }
  | { kind: 'slack:setConfig'; payload: { ok: true } }
  | { kind: 'slack:test'; payload: { ok: boolean; error?: string } }
```

- [ ] **Step 3: Mirror into `shared/messagePort.ts` `OrchRequest`**

Add `import type { SlackConfig } from './slackConfig.js';` and these to `OrchRequest` (note the `id` field that the envelope uses, matching the existing `focusChanged` line):

```ts
  | { id: string; kind: 'slack:getConfig'; payload: Record<string, never> }
  | { id: string; kind: 'slack:setConfig'; payload: { config: SlackConfig } }
  | { id: string; kind: 'slack:test'; payload: Record<string, never> }
  | { id: string; kind: 'windowFocusChanged'; payload: { focused: boolean } }
```

- [ ] **Step 4: Add matching members to `OrchResponse` in `shared/messagePort.ts`**

```ts
  | { kind: 'slack:getConfig'; payload: { config: SlackConfig; connected: boolean } }
  | { kind: 'slack:setConfig'; payload: { ok: true } }
  | { kind: 'slack:test'; payload: { ok: boolean; error?: string } }
  | { kind: 'windowFocusChanged'; payload: { ok: true } }
```

- [ ] **Step 5: Typecheck (will fail in index.ts until Task 7 — that's expected here)**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: errors only of the form "no handler / not all code paths" for the new kinds in `orchestrator/index.ts`. No errors in the shared files themselves.

- [ ] **Step 6: Commit**

```bash
git add shared/ipcContract.ts shared/messagePort.ts
git commit -m "feat(slack): IPC contract for slack config + window focus"
```

---

### Task 7: Wire escalator into the orchestrator

**Files:**
- Modify: `orchestrator/index.ts`

- [ ] **Step 1: Add imports near the existing `Notifier`/`QuietTimers` imports (~line 40)**

```ts
import { SlackEscalator } from './slackEscalator.js';
import { WebApiSlackClient, type SlackClient } from './services/slackClient.js';
import { readSlackConfig, writeSlackConfig } from './services/slackConfig.js';
```

- [ ] **Step 2: Add module-level state near `let notifier`/`let quietTimers` (~line 74)**

```ts
let slackEscalator: SlackEscalator | null = null;
/** threadTs ↔ instanceId, populated when we post; read by the reply listener. */
const slackThreadToInstance = new Map<string, string>();
const slackInstanceToThread = new Map<string, string>();
/** DM channel id resolved lazily from the configured user id. */
let slackDmChannel: string | null = null;
```

- [ ] **Step 3: Add a posting helper (place it as a top-level function near `applyTransition`)**

```ts
function slackTextFor(cwd: string, kind: 'waiting-permission' | 'idle-notify' | 'crashed'): string {
  const name = cwd.split('/').filter(Boolean).pop() || cwd;
  if (kind === 'waiting-permission') return `🔐 *${name}* needs a permission decision.`;
  if (kind === 'crashed') return `💥 *${name}* crashed / exited unexpectedly.`;
  return `⏳ *${name}* finished and is waiting for your input.`;
}

async function postSlack(instanceId: string, cwd: string, kind: 'waiting-permission' | 'idle-notify' | 'crashed'): Promise<void> {
  const cfg = readSlackConfig(new SettingsRepo(handle!.db));
  if (!cfg.enabled || !cfg.botToken || !cfg.dmUserId) return;
  try {
    const client: SlackClient = new WebApiSlackClient(cfg.botToken);
    if (!slackDmChannel) slackDmChannel = await client.openDm(cfg.dmUserId);
    const res = await client.postMessage(slackDmChannel, slackTextFor(cwd, kind));
    slackThreadToInstance.set(res.ts, instanceId);
    slackInstanceToThread.set(instanceId, res.ts);
  } catch (err) {
    console.error('[slack] post failed', err);
  }
}
```

- [ ] **Step 4: Construct the escalator where `notifier`/`quietTimers` are wired (after the `quietTimers = new QuietTimers(...)` block, ~line 880)**

```ts
slackEscalator = new SlackEscalator(
  () => readSlackConfig(new SettingsRepo(handle!.db)),
  { post: (id, cwd, kind) => void postSlack(id, cwd, kind) },
);
```

- [ ] **Step 5: Fan out in `applyTransition` (the `if (result.state !== prevStatus)` block, right after the `notifier.apply(...)` line ~262)**

```ts
    if (slackEscalator) slackEscalator.apply(instanceId, inst.cwd, prevStatus, result.state);
```

- [ ] **Step 6: Add the new request handlers in the `handleRequest` switch (next to `setSetting`, ~line 447)**

```ts
    case 'slack:getConfig': {
      const config = readSlackConfig(new SettingsRepo(handle!.db));
      return { config, connected: config.enabled && Boolean(config.botToken) };
    }

    case 'slack:setConfig': {
      writeSlackConfig(new SettingsRepo(handle!.db), req.payload.config);
      slackDmChannel = null; // force DM re-resolution on next post
      return { ok: true };
    }

    case 'slack:test': {
      const cfg = readSlackConfig(new SettingsRepo(handle!.db));
      if (!cfg.botToken || !cfg.dmUserId) return { ok: false, error: 'Bot token and DM user id are required.' };
      try {
        const client = new WebApiSlackClient(cfg.botToken);
        const auth = await client.testAuth();
        if (!auth.ok) return { ok: false, error: auth.error ?? 'auth.test failed' };
        const channel = await client.openDm(cfg.dmUserId);
        await client.postMessage(channel, '✅ Watchtower Slack test message.');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'windowFocusChanged': {
      slackEscalator?.setWindowFocused(req.payload.focused);
      return { ok: true };
    }
```

- [ ] **Step 7: Clean up thread maps on instance exit. Find the `ptyExit` handling / instance-removal path and add map cleanup. In `applyTransition`, extend the `clearAttention` output branch (~line 272):**

```ts
    } else if (out.kind === 'clearAttention') {
      notifier?.clearAttention(instanceId);
      slackEscalator?.clear(instanceId);
      const ts = slackInstanceToThread.get(instanceId);
      if (ts) { slackThreadToInstance.delete(ts); slackInstanceToThread.delete(instanceId); }
    }
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no new errors.

- [ ] **Step 9: Run the full orchestrator test suite**

Run: `npx vitest run tests/orchestrator`
Expected: all green, including the new escalator + config tests.

- [ ] **Step 10: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(slack): wire SlackEscalator + slack IPC into orchestrator"
```

---

### Task 8: Forward window focus from Electron main

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: After the primary window is created in the bootstrap block (`const win = createMainWindow();` ~line 57, where `orch` from `const orch = startOrchestrator();` is in scope), attach focus/blur forwarders**

```ts
  win.on('focus', () => void orch.invoke('windowFocusChanged', { focused: true }));
  win.on('blur', () => void orch.invoke('windowFocusChanged', { focused: false }));
```

- [ ] **Step 2: Typecheck main**

Run: `npx tsc -p electron/tsconfig.json --noEmit`
Expected: no new errors (the `windowFocusChanged` kind exists from Task 6).

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(slack): forward window focus/blur to orchestrator"
```

---

### Task 9: Renderer hook

**Files:**
- Create: `client/src/state/useSlackConfig.ts`

- [ ] **Step 1: Implement the hook (mirrors `useTokenUsage` invoke pattern)**

```ts
// client/src/state/useSlackConfig.ts
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SLACK_CONFIG, type SlackConfig } from '../../../shared/slackConfig.js';

export interface SlackConfigState {
  config: SlackConfig;
  connected: boolean;
  loading: boolean;
  error: string | null;
  save(next: SlackConfig): Promise<void>;
  sendTest(): Promise<{ ok: boolean; error?: string }>;
  refresh(): Promise<void>;
}

export function useSlackConfig(): SlackConfigState {
  const [config, setConfig] = useState<SlackConfig>(DEFAULT_SLACK_CONFIG);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('slack:getConfig', {});
      setConfig(res.config);
      setConnected(res.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next: SlackConfig) => {
    await window.watchtower.invoke('slack:setConfig', { config: next });
    setConfig(next);
    await refresh();
  }, [refresh]);

  const sendTest = useCallback(
    () => window.watchtower.invoke('slack:test', {}),
    [],
  );

  useEffect(() => { void refresh(); }, [refresh]);

  return { config, connected, loading, error, save, sendTest, refresh };
}
```

- [ ] **Step 2: Typecheck client**

Run: `npx tsc -p client/tsconfig.json --noEmit`
Expected: no NEW errors (pre-existing drift from CLAUDE.md is acceptable).

- [ ] **Step 3: Commit**

```bash
git add client/src/state/useSlackConfig.ts
git commit -m "feat(slack): useSlackConfig renderer hook"
```

---

### Task 10: Settings UI — Slack tab

**Files:**
- Create: `client/src/components/settings/SlackTab.tsx`
- Modify: `client/src/util/settingsUrl.ts`
- Modify: `client/src/components/ModuleRail.tsx`
- Modify: `client/src/components/settings/ModuleSettings.tsx`

- [ ] **Step 1: Register the tab id in `client/src/util/settingsUrl.ts`**

Change the `SETTINGS_TABS` constant (~line 16) to include `'slack'`:

```ts
export const SETTINGS_TABS = ['general', 'json', 'hooks', 'skills', 'agents', 'mcp', 'slack'] as const;
```

- [ ] **Step 2: Add the rail entry in `client/src/components/ModuleRail.tsx`**

Add an import for an icon at the top with the other MUI icon imports:

```ts
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
```

Add this entry to the settings sub-tab list (after the `mcp` entry ~line 73):

```ts
  { id: 'slack', label: 'Slack', icon: <NotificationsActiveIcon fontSize="inherit" /> },
```

- [ ] **Step 3: Route the tab in `client/src/components/settings/ModuleSettings.tsx`**

Add the import and the conditional render:

```ts
import { SlackTab } from './SlackTab.js';
```

```tsx
        {view.tab === 'slack' && <SlackTab />}
```

- [ ] **Step 4: Create the Slack tab component**

```tsx
// client/src/components/settings/SlackTab.tsx
import { useState } from 'react';
import {
  Box, Stack, Typography, TextField, Switch, FormControlLabel, Button, Alert, Divider, Chip,
} from '@mui/material';
import { useSlackConfig } from '../../state/useSlackConfig.js';
import type { SlackConfig } from '../../../../shared/slackConfig.js';

export function SlackTab() {
  const { config, connected, loading, error, save, sendTest } = useSlackConfig();
  const [draft, setDraft] = useState<SlackConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const value = draft ?? config;
  const patch = (p: Partial<SlackConfig>) => setDraft({ ...value, ...p });

  const onSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await save(value);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTestResult(null);
    const res = await sendTest();
    setTestResult(res.ok ? '✅ Sent — check your Slack DM.' : `❌ ${res.error ?? 'failed'}`);
  };

  if (loading) return <Box sx={{ p: 3 }}><Typography>Loading…</Typography></Box>;

  return (
    <Box sx={{ p: 3, maxWidth: 560, width: '100%' }}>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">Slack escalation</Typography>
          {connected && <Chip size="small" color="success" label="configured" />}
        </Box>
        <Typography variant="body2" color="text.secondary">
          When an instance needs you and the Watchtower window is unfocused, escalate to a Slack DM
          after a delay. Reply in the thread to send input back into the session.
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}

        <FormControlLabel
          control={<Switch checked={value.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />}
          label="Enable Slack escalation"
        />

        <TextField
          label="Bot token (xoxb-…)" type="password" fullWidth value={value.botToken}
          onChange={(e) => patch({ botToken: e.target.value })}
        />
        <TextField
          label="App-level token (xapp-…, for replies)" type="password" fullWidth value={value.appToken}
          onChange={(e) => patch({ appToken: e.target.value })}
        />
        <TextField
          label="Your Slack user id (e.g. U0123ABCD)" fullWidth value={value.dmUserId}
          onChange={(e) => patch({ dmUserId: e.target.value })}
        />
        <TextField
          label="Escalate after (minutes)" type="number" fullWidth
          value={Math.round(value.escalateMs / 60_000)}
          onChange={(e) => patch({ escalateMs: Math.max(1, Number(e.target.value)) * 60_000 })}
        />

        <Divider />
        <Typography variant="subtitle2">Triggers</Typography>
        <FormControlLabel
          control={<Switch checked={value.triggers.permission} onChange={(e) => patch({ triggers: { ...value.triggers, permission: e.target.checked } })} />}
          label="Permission prompts"
        />
        <FormControlLabel
          control={<Switch checked={value.triggers.idle} onChange={(e) => patch({ triggers: { ...value.triggers, idle: e.target.checked } })} />}
          label="Finished / waiting for input"
        />
        <FormControlLabel
          control={<Switch checked={value.triggers.crash} onChange={(e) => patch({ triggers: { ...value.triggers, crash: e.target.checked } })} />}
          label="Crashes / exits"
        />

        {testResult && <Alert severity={testResult.startsWith('✅') ? 'success' : 'error'}>{testResult}</Alert>}

        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={onSave} disabled={saving || draft === null}>Save</Button>
          <Button variant="outlined" onClick={onTest} disabled={!value.botToken || !value.dmUserId}>Send test message</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 5: Typecheck client + build renderer**

Run: `npx tsc -p client/tsconfig.json --noEmit && npm run build:renderer`
Expected: no NEW type errors; renderer build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/settings/SlackTab.tsx client/src/util/settingsUrl.ts client/src/components/ModuleRail.tsx client/src/components/settings/ModuleSettings.tsx
git commit -m "feat(slack): Settings tab for Slack escalation config"
```

---

### Task 11: Phase 1 manual verification

**Files:** none (manual).

- [ ] **Step 1: Build everything**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 2: Manual smoke (documented for the user; requires a real Slack app)**

In Slack: create an app → add bot scopes `chat:write`, `im:write` → install to workspace → copy the `xoxb-` token. Get your own user id (Slack profile → "Copy member ID").

In Watchtower: Settings → Slack → enable, paste bot token + user id, set 1 minute, Save → "Send test message" → confirm the DM arrives. Then start an instance, trigger a permission prompt, blur the Watchtower window, wait 1 minute → confirm a DM arrives. Focus the window before the minute is up → confirm NO DM.

- [ ] **Step 3: Tag the phase-1 checkpoint**

```bash
git tag slack-phase1
```

---

# PHASE 2 — Two-way reply (Socket Mode)

### Task 12: Pure reply router

**Files:**
- Create: `orchestrator/slackReply.ts`
- Test: `tests/orchestrator/slackReply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/slackReply.test.ts
import { describe, it, expect, vi } from 'vitest';
import { routeReply, type InboundMessage } from '../../orchestrator/slackReply.js';

function deps(over: Partial<Parameters<typeof routeReply>[1]> = {}) {
  return {
    dmChannelId: 'D1',
    resolveInstance: (ts: string) => (ts === 'T1' ? 'inst-1' : null),
    deliver: vi.fn(),
    ack: vi.fn(),
    ...over,
  };
}

const base: InboundMessage = { channel: 'D1', text: 'yes', ts: 'M1', thread_ts: 'T1' };

describe('routeReply', () => {
  it('delivers a thread reply to the mapped instance and acks', () => {
    const d = deps();
    expect(routeReply(base, d)).toBe(true);
    expect(d.deliver).toHaveBeenCalledWith('inst-1', 'yes');
    expect(d.ack).toHaveBeenCalledWith('D1', 'T1');
  });

  it('ignores messages from other channels', () => {
    const d = deps();
    expect(routeReply({ ...base, channel: 'C-other' }, d)).toBe(false);
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it('ignores the bot’s own messages and edits/subtypes', () => {
    const d = deps();
    expect(routeReply({ ...base, bot_id: 'B1' }, d)).toBe(false);
    expect(routeReply({ ...base, subtype: 'message_changed' }, d)).toBe(false);
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it('ignores replies whose thread maps to no instance', () => {
    const d = deps();
    expect(routeReply({ ...base, thread_ts: 'T-unknown' }, d)).toBe(false);
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it('falls back to ts when thread_ts is absent (top-level message)', () => {
    const d = deps({ resolveInstance: (ts) => (ts === 'M1' ? 'inst-1' : null) });
    expect(routeReply({ channel: 'D1', text: 'hi', ts: 'M1' }, d)).toBe(true);
    expect(d.deliver).toHaveBeenCalledWith('inst-1', 'hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/slackReply.test.ts`
Expected: FAIL — cannot find module `slackReply.js`.

- [ ] **Step 3: Implement**

```ts
// orchestrator/slackReply.ts
export interface InboundMessage {
  channel: string;
  text: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export interface ReplyDeps {
  dmChannelId: string | null;
  resolveInstance(threadTs: string): string | null;
  deliver(instanceId: string, text: string): void;
  ack(channel: string, ts: string): void;
}

/** Decide whether an inbound Slack message is a routable reply; route it if so. */
export function routeReply(msg: InboundMessage, deps: ReplyDeps): boolean {
  if (msg.bot_id || msg.subtype) return false;
  if (!deps.dmChannelId || msg.channel !== deps.dmChannelId) return false;
  if (!msg.text.trim()) return false;
  const key = msg.thread_ts ?? msg.ts;
  const instanceId = deps.resolveInstance(key);
  if (!instanceId) return false;
  deps.deliver(instanceId, msg.text);
  deps.ack(msg.channel, key);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/slackReply.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/slackReply.ts tests/orchestrator/slackReply.test.ts
git commit -m "feat(slack): pure routeReply for inbound Slack replies"
```

---

### Task 13: Socket Mode listener

**Files:**
- Create: `orchestrator/slackListener.ts`

Thin Socket Mode wrapper; no unit test (network/event lifecycle). Typecheck + manual smoke are the gates.

- [ ] **Step 1: Implement**

```ts
// orchestrator/slackListener.ts
import { SocketModeClient } from '@slack/socket-mode';
import { routeReply, type InboundMessage, type ReplyDeps } from './slackReply.js';

/**
 * Owns the Socket Mode websocket. On each DM message it runs the pure
 * `routeReply` against the injected deps. `start()` is idempotent: calling it
 * again tears down the previous socket first (used when the app token changes).
 */
export class SlackListener {
  private client: SocketModeClient | null = null;
  private connected = false;

  constructor(private deps: ReplyDeps) {}

  isConnected(): boolean {
    return this.connected;
  }

  async start(appToken: string): Promise<void> {
    await this.stop();
    if (!appToken) return;
    const client = new SocketModeClient({ appToken });
    client.on('connected', () => { this.connected = true; });
    client.on('disconnected', () => { this.connected = false; });
    client.on('message', async ({ event, ack }: { event: InboundMessage; ack: () => Promise<void> }) => {
      await ack();
      try {
        routeReply(event, this.deps);
      } catch (err) {
        console.error('[slack] routeReply failed', err);
      }
    });
    this.client = client;
    await client.start();
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { await this.client.disconnect(); } catch { /* best effort */ }
      this.client = null;
    }
    this.connected = false;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: no new errors. (If the `message` event payload typing differs in the installed `@slack/socket-mode` version, narrow with a local `as` cast to `InboundMessage` rather than changing the pure module.)

- [ ] **Step 3: Commit**

```bash
git add orchestrator/slackListener.ts
git commit -m "feat(slack): Socket Mode listener wrapping routeReply"
```

---

### Task 14: Wire the listener + reply delivery into the orchestrator

**Files:**
- Modify: `orchestrator/index.ts`

- [ ] **Step 1: Add imports**

```ts
import { SlackListener } from './slackListener.js';
```

- [ ] **Step 2: Add module state near `slackEscalator`**

```ts
let slackListener: SlackListener | null = null;
```

- [ ] **Step 3: Add a deliver helper near `postSlack`**

```ts
function deliverSlackReply(instanceId: string, text: string): void {
  const session = pty.get(instanceId);
  if (!session) return;
  session.write(text + '\r');
  // Treat a Slack reply as engagement so attention state clears + badge updates.
  applyTransition(instanceId, { kind: 'userPromptSubmit' });
}

function ackSlackReply(channel: string, ts: string): void {
  const cfg = readSlackConfig(new SettingsRepo(handle!.db));
  if (!cfg.botToken) return;
  void new WebApiSlackClient(cfg.botToken)
    .updateMessage(channel, ts, '✅ Reply sent to the session.')
    .catch((err) => console.error('[slack] ack update failed', err));
}
```

> Note: `pty` is the existing pty registry used at `pty.get(req.payload.instanceId)?.write(...)` (index.ts:398). Match its accessor exactly.

- [ ] **Step 4: Construct + start the listener where the escalator is constructed (~line 880)**

```ts
slackListener = new SlackListener({
  dmChannelId: null, // updated below before start
  resolveInstance: (threadTs) => slackThreadToInstance.get(threadTs) ?? null,
  deliver: deliverSlackReply,
  ack: ackSlackReply,
});
void startSlackListener();
```

Add a top-level helper that resolves the DM channel (so `dmChannelId` is known for filtering) and starts the socket:

```ts
async function startSlackListener(): Promise<void> {
  const cfg = readSlackConfig(new SettingsRepo(handle!.db));
  if (!slackListener || !cfg.enabled || !cfg.appToken || !cfg.botToken || !cfg.dmUserId) return;
  try {
    if (!slackDmChannel) slackDmChannel = await new WebApiSlackClient(cfg.botToken).openDm(cfg.dmUserId);
    // Refresh the deps closure's channel id via a setter:
    slackListener.setDmChannel(slackDmChannel);
    await slackListener.start(cfg.appToken);
  } catch (err) {
    console.error('[slack] listener start failed', err);
  }
}
```

- [ ] **Step 5: Add the `setDmChannel` setter to `SlackListener` (edit `orchestrator/slackListener.ts`)**

The deps object holds `dmChannelId`; add a setter so the orchestrator can fill it after resolving the DM:

```ts
  setDmChannel(channel: string | null): void {
    this.deps.dmChannelId = channel;
  }
```

- [ ] **Step 6: Restart the listener on config save. In the `slack:setConfig` handler (Task 7, step 6), append before `return`:**

```ts
      slackDmChannel = null;
      void startSlackListener();
```

(The first `slackDmChannel = null` from Task 7 already exists; ensure the restart call is added.)

- [ ] **Step 7: Report live connection state in `slack:getConfig`. Update its return:**

```ts
      return { config, connected: slackListener?.isConnected() ?? false };
```

- [ ] **Step 8: Stop the socket on orchestrator shutdown. Find the existing teardown/`clearAll` path (where `quietTimers?.clearAll()` or process exit cleanup runs) and add:**

```ts
      slackEscalator?.clearAll();
      void slackListener?.stop();
```

- [ ] **Step 9: Typecheck + full test run**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx vitest run`
Expected: no new type errors; all tests green (count ≥ previous + new tests).

- [ ] **Step 10: Commit**

```bash
git add orchestrator/index.ts orchestrator/slackListener.ts
git commit -m "feat(slack): deliver Slack replies into pty + manage Socket Mode lifecycle"
```

---

### Task 15: Phase 2 manual verification + docs

**Files:**
- Modify: `CLAUDE.md` (schema/IPC notes — add the slack kinds to the IPC namespaces list if appropriate)

- [ ] **Step 1: Slack app scopes for two-way**

In the Slack app: enable **Socket Mode**, generate an app-level token (`xapp-`) with `connections:write`, and under Event Subscriptions subscribe the bot to `message.im`. Reinstall if prompted. Bot needs `im:history` in addition to phase-1 scopes.

- [ ] **Step 2: Build + run**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Manual two-way smoke**

Enable Slack with both tokens + user id, Save. Start an instance, trigger a permission prompt, blur the window, wait for the DM. Reply `1` (or `yes`) in the DM → confirm the session receives the input and advances, and the original message updates to "✅ Reply sent to the session."

- [ ] **Step 4: Update CLAUDE.md IPC notes**

Add `slack:getConfig` / `slack:setConfig` / `slack:test` to the "Settings module's read/write surface" or IPC namespaces section, and note the `windowFocusChanged` push, so future sessions know the surface exists.

- [ ] **Step 5: Final full verification**

Run: `npm run build && npx vitest run`
Expected: build exits 0; all tests green.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note slack IPC kinds in CLAUDE.md"
```

---

## Self-Review Notes

- **Spec coverage:** two-way (Tasks 12–14), all three triggers (Task 5 + config), global timeout (config `escalateMs`), bot DM (postSlack/openDm), free-form reply → pty (Task 14), crash-immediate (Task 5), window-focus gate (Tasks 5, 8), plaintext token storage (Task 3), Settings UI + test button (Task 10), new IPC kinds (Task 6). All covered.
- **Type consistency:** `SlackConfig` shape is identical across `shared/slackConfig.ts`, the IPC contract, the hook, and the UI. `routeReply`/`ReplyDeps`/`InboundMessage` names match between `slackReply.ts`, its test, and `slackListener.ts`. Escalation kind union `'waiting-permission' | 'idle-notify' | 'crashed'` matches between `slackEscalator.ts` and `postSlack`.
- **Known integration risk:** the `@slack/socket-mode` `message` event payload type may not match `InboundMessage` exactly across SDK versions — Task 13 step 2 calls for a local cast rather than weakening the pure module. The orchestrator-shutdown hook location (Task 14 step 8) and the primary-window scope for focus handlers (Task 8) must be confirmed against the current `index.ts` / `main.ts` at execution time.
