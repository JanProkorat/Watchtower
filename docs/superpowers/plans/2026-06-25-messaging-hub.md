# Cross-device messaging hub (v1: iPad) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an instance needs attention and the user is away from the Mac, escalate to the iPad — in-app over the existing WS push and via APNs when the iPad is locked/closed — and let the user reply from the iPad, injected into the pty.

**Architecture:** Extract the Slack escalation gate into a channel-agnostic `EscalationGate` that fires one "escalate" event; the orchestrator dispatches it to Slack (existing) and a new hub sender (WS `attentionPing` push + APNs). The iPad registers a device token, shows pings + a reply box, and replies over WS, which the orchestrator injects into the pty (reuse `deliverSlackReply`). No Supabase.

**Tech Stack:** Node 25 `node:http2` + `node:crypto` (APNs, no new deps), Fastify WS bridge, better-sqlite3, `@capacitor/push-notifications` (iPad), React (plain, no MUI), vitest (`environment: node`).

## Global Constraints

- **`@watchtower/shared` is a BUILT composite.** After editing `packages/shared/src/*`, rebuild (`tsc -b packages/shared/tsconfig.json`) before orchestrator/iPad typecheck sees it. Tests resolve `@watchtower/shared` → `src` via the vitest alias. **Do NOT commit `dist/`** (gitignored).
- **New push/request kinds go in BOTH `messagePort.ts` (Orch*, with `id`) AND `ipcContract.ts` (Ipc*, no `id`).** A push kind goes in `OrchPush` AND `IpcPush` (the #75 lesson: they silently diverged).
- **No new npm deps in the orchestrator** — APNs uses `node:http2` + `node:crypto`. iPad adds exactly `@capacitor/push-notifications@^6`.
- **APNs auth is token-based** (ES256, `.p8`): JWT header `{alg:'ES256',kid:keyId}`, payload `{iss:teamId,iat:now}`, signed with `dsaEncoding:'ieee-p1363'` (JWT requires raw r||s, not DER).
- **APNs env is configurable**: host `api.sandbox.push.apple.com` (Xcode dev builds) vs `api.push.apple.com` (TestFlight/production). `apns-topic` = bundle id `cz.greencode.watchtower.ipad`.
- **Secrets live in the SQLite `settings` table**, never a file. Czech UI strings, no i18n. iPad app: plain React, no MUI.
- **Keep the suite green** (`npm test`); `npm run typecheck` adds no new errors (known pre-existing desktop drift is acceptable).
- **Behaviour-preservation:** when the hub is disabled, Slack escalation must behave exactly as before.

---

### Task 1: Extract `EscalationGate` (channel-agnostic)

**Files:**
- Create: `orchestrator/escalationGate.ts`
- Test: `tests/orchestrator/escalationGate.test.ts`

**Interfaces:**
- Produces:
  - `type EscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed'`
  - `interface EscalationParams { escalateMs: number; triggers: { permission: boolean; idle: boolean; crash: boolean }; armEnabled: boolean }`
  - `class EscalationGate { constructor(getParams: () => EscalationParams, onFire: (instanceId: string, cwd: string, kind: EscalationKind) => void); setWindowFocused(focused: boolean): void; apply(instanceId: string, cwd: string, prev: InstanceStatus, next: InstanceStatus): void; clear(instanceId: string): void; clearAll(): void }`
- Consumed by Task 2 (index.ts wiring) and Task 7 (hub dispatch).

This is the behaviour of `orchestrator/slackEscalator.ts`, made channel-agnostic: `getConfig().enabled` → `getParams().armEnabled`; `emit.post(...)` → `onFire(...)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/escalationGate.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EscalationGate, type EscalationParams } from '../../orchestrator/escalationGate.js';

const PARAMS: EscalationParams = { escalateMs: 1000, triggers: { permission: true, idle: true, crash: true }, armEnabled: true };

describe('EscalationGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(p: Partial<EscalationParams> = {}) {
    const fired: Array<[string, string, string]> = [];
    const gate = new EscalationGate(() => ({ ...PARAMS, ...p }), (id, cwd, kind) => fired.push([id, cwd, kind]));
    return { gate, fired };
  }

  it('fires after escalateMs when entering attention while unfocused', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([['i1', '/x', 'waiting-permission']]);
  });

  it('does NOT fire if focused at fire time', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'idle-notify');
    gate.setWindowFocused(true);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it('cancels the timer when leaving attention', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    gate.apply('i1', '/x', 'waiting-permission', 'working');
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it('fires crashed immediately (no timer) when unfocused', () => {
    const { gate, fired } = setup();
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'crashed');
    expect(fired).toEqual([['i1', '/x', 'crashed']]);
  });

  it('does not arm when armEnabled is false', () => {
    const { gate, fired } = setup({ armEnabled: false });
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it('respects a disabled trigger', () => {
    const { gate, fired } = setup({ triggers: { permission: false, idle: true, crash: true } });
    gate.setWindowFocused(false);
    gate.apply('i1', '/x', 'working', 'waiting-permission');
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/escalationGate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gate** (port `slackEscalator.ts`, generalised)

```ts
// orchestrator/escalationGate.ts
import type { InstanceStatus } from '@watchtower/shared/messagePort.js';

export type EscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed';

export interface EscalationParams {
  escalateMs: number;
  triggers: { permission: boolean; idle: boolean; crash: boolean };
  armEnabled: boolean; // arm timers when ANY channel (Slack or hub) is enabled
}

const ATTENTION: ReadonlyArray<InstanceStatus> = ['waiting-permission', 'idle-notify'];

export class EscalationGate {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private windowFocused = true;

  constructor(
    private getParams: () => EscalationParams,
    private onFire: (instanceId: string, cwd: string, kind: EscalationKind) => void,
  ) {}

  setWindowFocused(focused: boolean): void { this.windowFocused = focused; }

  apply(instanceId: string, cwd: string, prev: InstanceStatus, next: InstanceStatus): void {
    if (prev === next) return;
    const p = this.getParams();
    if (!p.armEnabled) { this.clear(instanceId); return; }

    if (next === 'crashed') {
      if (p.triggers.crash && !this.windowFocused) this.onFire(instanceId, cwd, 'crashed');
      this.clear(instanceId);
      return;
    }

    const entered = ATTENTION.includes(next) && !ATTENTION.includes(prev);
    const left = ATTENTION.includes(prev) && !ATTENTION.includes(next);
    if (left) { this.clear(instanceId); return; }
    if (!entered) return;

    const kind: EscalationKind = next === 'waiting-permission' ? 'waiting-permission' : 'idle-notify';
    if (kind === 'waiting-permission' && !p.triggers.permission) return;
    if (kind === 'idle-notify' && !p.triggers.idle) return;

    this.clear(instanceId);
    const timer = setTimeout(() => {
      this.timers.delete(instanceId);
      if (!this.windowFocused) this.onFire(instanceId, cwd, kind);
    }, p.escalateMs);
    this.timers.set(instanceId, timer);
  }

  clear(instanceId: string): void {
    const t = this.timers.get(instanceId);
    if (t) { clearTimeout(t); this.timers.delete(instanceId); }
  }

  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/escalationGate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/escalationGate.ts tests/orchestrator/escalationGate.test.ts
git commit -m "feat: #71 extract channel-agnostic EscalationGate"
```

---

### Task 2: Rewire index.ts onto `EscalationGate` (Slack dispatch preserved)

**Files:**
- Modify: `orchestrator/index.ts` (replace `slackEscalator` usage with an `EscalationGate` + dispatch)
- Delete: `orchestrator/slackEscalator.ts` (logic now in `escalationGate.ts`)
- Test: `tests/orchestrator/slackEscalator.test.ts` — update import/shape if it tests the old class; otherwise the gate test covers it.

**Interfaces:**
- Consumes: `EscalationGate`, `EscalationParams`, `EscalationKind` (Task 1); existing `postSlack`, `readSlackConfig`, `SettingsRepo`.
- Produces: a module-level `escalationGate: EscalationGate`; an `onEscalate(instanceId, cwd, kind)` dispatcher (Slack-only here; Task 7 adds the hub). The escalation timing/triggers are read from the existing Slack settings (`slack_escalate_ms`, `slack_triggers`) — these are the shared "escalation" params; `armEnabled` = `slackConfig.enabled` (Task 7 will OR-in hub).

- [ ] **Step 1: Replace the construction**

Find (orchestrator/index.ts ~1214):
```ts
slackEscalator = new SlackEscalator(
  () => readSlackConfig(new SettingsRepo(handle!.db)),
  { post: (id, cwd, kind) => void postSlack(id, cwd, kind) },
);
```
Replace with:
```ts
const onEscalate = (instanceId: string, cwd: string, kind: EscalationKind) => {
  const slack = readSlackConfig(new SettingsRepo(handle!.db));
  if (slack.enabled) void postSlack(instanceId, cwd, kind);
  // Task 7 adds: hub dispatch here.
};
escalationGate = new EscalationGate(() => {
  const slack = readSlackConfig(new SettingsRepo(handle!.db));
  return { escalateMs: slack.escalateMs, triggers: slack.triggers, armEnabled: slack.enabled };
}, onEscalate);
```
Update the module declaration: replace `let slackEscalator: SlackEscalator | null` with `let escalationGate: EscalationGate | null`, and the import.

- [ ] **Step 2: Replace the call sites**

`applyTransition` (~line 388):
```ts
if (!isShell) escalationGate?.apply(instanceId, inst.cwd, prevStatus, result.state);
```
clearAttention output (~line 401): `escalationGate?.clear(instanceId);`
`windowFocusChanged` (~line 702): `escalationGate?.setWindowFocused(focused);` (keep `notifier?.setWindowFocused(focused)`).
Any `slackEscalator?.clearAll()` on shutdown → `escalationGate?.clearAll()`.

- [ ] **Step 3: Delete the old file + fix the test**

```bash
git rm orchestrator/slackEscalator.ts
```
If `tests/orchestrator/slackEscalator.test.ts` imports `SlackEscalator`, rewrite those cases to import `EscalationGate` from `escalationGate.js` (the behaviour is identical) or delete it as superseded by `escalationGate.test.ts`. Keep coverage equivalent.

- [ ] **Step 4: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: orchestrator compiles; Slack escalation behaviour unchanged; suite green.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/index.ts orchestrator/slackEscalator.ts tests/orchestrator/slackEscalator.test.ts
git commit -m "feat: #71 drive escalation via EscalationGate (Slack dispatch preserved)"
```

---

### Task 3: Hub config (shared keys + service + get/set requests)

**Files:**
- Create: `packages/shared/src/hubConfig.ts`
- Create: `orchestrator/services/hubConfig.ts`
- Modify: `packages/shared/src/messagePort.ts`, `packages/shared/src/ipcContract.ts` (add `hub:getConfig`, `hub:setConfig`)
- Modify: `orchestrator/index.ts` (`handleRequest` cases)
- Test: `tests/orchestrator/hubConfig.test.ts`

**Interfaces:**
- Produces:
  - `interface HubConfig { enabled: boolean; apnsKey: string; apnsKeyId: string; apnsTeamId: string; apnsEnv: 'sandbox' | 'production' }`
  - `const HUB_BUNDLE_ID = 'cz.greencode.watchtower.ipad'`
  - `DEFAULT_HUB_CONFIG`, `HUB_SETTING_KEYS`
  - `readHubConfig(settings)`, `writeHubConfig(settings, cfg)`
  - requests `hub:getConfig {} → { config: HubConfig }`, `hub:setConfig { config } → { ok: true }`
- Consumed by Tasks 4, 7 (APNs + dispatch), and the Settings UI (Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/hubConfig.test.ts
import { describe, it, expect } from 'vitest';
import { readHubConfig, writeHubConfig } from '../../orchestrator/services/hubConfig.js';
import { DEFAULT_HUB_CONFIG } from '@watchtower/shared/hubConfig.js';

function fakeSettings() {
  const m = new Map<string, string>();
  return {
    getString: (k: string, d: string) => m.get(k) ?? d,
    getNumber: (k: string, d: number) => (m.has(k) ? Number(m.get(k)) : d),
    set: (k: string, v: string) => void m.set(k, v),
  };
}

describe('hubConfig', () => {
  it('returns defaults when nothing stored', () => {
    expect(readHubConfig(fakeSettings() as never)).toEqual(DEFAULT_HUB_CONFIG);
  });
  it('round-trips through settings', () => {
    const s = fakeSettings();
    const cfg = { enabled: true, apnsKey: '-----P8-----', apnsKeyId: 'ABC123', apnsTeamId: 'TEAM99', apnsEnv: 'sandbox' as const };
    writeHubConfig(s as never, cfg);
    expect(readHubConfig(s as never)).toEqual(cfg);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/hubConfig.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement shared + service**

```ts
// packages/shared/src/hubConfig.ts
export const HUB_BUNDLE_ID = 'cz.greencode.watchtower.ipad';

export interface HubConfig {
  enabled: boolean;
  apnsKey: string;       // .p8 PEM contents
  apnsKeyId: string;
  apnsTeamId: string;
  apnsEnv: 'sandbox' | 'production';
}

export const DEFAULT_HUB_CONFIG: HubConfig = {
  enabled: false, apnsKey: '', apnsKeyId: '', apnsTeamId: '', apnsEnv: 'sandbox',
};

export const HUB_SETTING_KEYS = {
  enabled: 'hub_enabled',
  apnsKey: 'hub_apns_key',
  apnsKeyId: 'hub_apns_key_id',
  apnsTeamId: 'hub_apns_team_id',
  apnsEnv: 'hub_apns_env',
} as const;
```

```ts
// orchestrator/services/hubConfig.ts
import { HUB_SETTING_KEYS, DEFAULT_HUB_CONFIG, type HubConfig } from '@watchtower/shared/hubConfig.js';

interface SettingsLike {
  getString(key: string, def: string): string;
  set(key: string, value: string): void;
}

export function readHubConfig(settings: SettingsLike): HubConfig {
  const env = settings.getString(HUB_SETTING_KEYS.apnsEnv, DEFAULT_HUB_CONFIG.apnsEnv);
  return {
    enabled: settings.getString(HUB_SETTING_KEYS.enabled, String(DEFAULT_HUB_CONFIG.enabled)) === 'true',
    apnsKey: settings.getString(HUB_SETTING_KEYS.apnsKey, DEFAULT_HUB_CONFIG.apnsKey),
    apnsKeyId: settings.getString(HUB_SETTING_KEYS.apnsKeyId, DEFAULT_HUB_CONFIG.apnsKeyId),
    apnsTeamId: settings.getString(HUB_SETTING_KEYS.apnsTeamId, DEFAULT_HUB_CONFIG.apnsTeamId),
    apnsEnv: env === 'production' ? 'production' : 'sandbox',
  };
}

export function writeHubConfig(settings: SettingsLike, cfg: HubConfig): void {
  settings.set(HUB_SETTING_KEYS.enabled, String(cfg.enabled));
  settings.set(HUB_SETTING_KEYS.apnsKey, cfg.apnsKey);
  settings.set(HUB_SETTING_KEYS.apnsKeyId, cfg.apnsKeyId);
  settings.set(HUB_SETTING_KEYS.apnsTeamId, cfg.apnsTeamId);
  settings.set(HUB_SETTING_KEYS.apnsEnv, cfg.apnsEnv);
}
```

- [ ] **Step 4: Add request kinds + handler**

In `packages/shared/src/messagePort.ts` OrchRequest add:
```ts
| { id: string; kind: 'hub:getConfig'; payload: Record<string, never> }
| { id: string; kind: 'hub:setConfig'; payload: { config: HubConfig } }
```
OrchResponse add:
```ts
| { kind: 'hub:getConfig'; payload: { config: HubConfig } }
| { kind: 'hub:setConfig'; payload: { ok: true } }
```
Mirror to `ipcContract.ts` IpcRequest (no `id`) + IpcResponse. Import `HubConfig` in both. In `orchestrator/index.ts` `handleRequest` switch:
```ts
case 'hub:getConfig':
  return { config: readHubConfig(new SettingsRepo(handle!.db)) };
case 'hub:setConfig':
  writeHubConfig(new SettingsRepo(handle!.db), req.payload.config);
  return { ok: true };
```

- [ ] **Step 5: Rebuild shared + test + typecheck**

Run: `tsc -b packages/shared/tsconfig.json && npx vitest run tests/orchestrator/hubConfig.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/hubConfig.ts orchestrator/services/hubConfig.ts packages/shared/src/messagePort.ts packages/shared/src/ipcContract.ts orchestrator/index.ts tests/orchestrator/hubConfig.test.ts
git commit -m "feat: #71 hub config (settings keys + service + hub:get/setConfig)"
```

---

### Task 4: APNs client (`node:http2` + `node:crypto`)

**Files:**
- Create: `orchestrator/services/apns.ts`
- Test: `tests/orchestrator/apns.test.ts`

**Interfaces:**
- Produces:
  - `buildApnsJwt(cfg: { apnsKey: string; apnsKeyId: string; apnsTeamId: string }, nowSec: number): string`
  - `buildApnsPayload(msg: { title: string; body: string; data: Record<string, unknown> }): string`
  - `apnsHost(env: 'sandbox' | 'production'): string`
  - `async sendApns(cfg: HubConfig, deviceToken: string, msg: {title;body;data}, http2mod?): Promise<{ ok: boolean; status: number; reason?: string }>`
- Consumed by Task 7.

- [ ] **Step 1: Write the failing test** (JWT verifies + payload + host; no live send)

```ts
// tests/orchestrator/apns.test.ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildApnsJwt, buildApnsPayload, apnsHost } from '../../orchestrator/services/apns.js';

// A throwaway P-256 key pair for signing/verification in the test.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

describe('apns', () => {
  it('selects host by env', () => {
    expect(apnsHost('sandbox')).toBe('https://api.sandbox.push.apple.com');
    expect(apnsHost('production')).toBe('https://api.push.apple.com');
  });

  it('builds a verifiable ES256 JWT with kid/iss/iat', () => {
    const jwt = buildApnsJwt({ apnsKey: pem, apnsKeyId: 'KEY123', apnsTeamId: 'TEAM99' }, 1_700_000_000);
    const [h, p, sig] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(payload).toEqual({ iss: 'TEAM99', iat: 1_700_000_000 });
    const ok = crypto.verify('SHA256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });

  it('builds an aps payload with alert + custom data', () => {
    const raw = buildApnsPayload({ title: 'watchtower-api', body: 'čeká na povolení', data: { instanceId: 'i1', pingId: 7 } });
    expect(JSON.parse(raw)).toEqual({
      aps: { alert: { title: 'watchtower-api', body: 'čeká na povolení' }, sound: 'default' },
      instanceId: 'i1', pingId: 7,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/apns.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// orchestrator/services/apns.ts
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { HUB_BUNDLE_ID, type HubConfig } from '@watchtower/shared/hubConfig.js';

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function apnsHost(env: 'sandbox' | 'production'): string {
  return env === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
}

export function buildApnsJwt(cfg: { apnsKey: string; apnsKeyId: string; apnsTeamId: string }, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.apnsKeyId }));
  const payload = b64url(JSON.stringify({ iss: cfg.apnsTeamId, iat: nowSec }));
  const signingInput = `${header}.${payload}`;
  // JWT requires raw r||s (ieee-p1363), not DER.
  const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key: cfg.apnsKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

export function buildApnsPayload(msg: { title: string; body: string; data: Record<string, unknown> }): string {
  return JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, ...msg.data });
}

// JWTs are valid up to 1h; cache for ~50 min keyed by keyId.
let cachedJwt: { keyId: string; iat: number; token: string } | null = null;

export async function sendApns(
  cfg: HubConfig,
  deviceToken: string,
  msg: { title: string; body: string; data: Record<string, unknown> },
  http2mod: typeof http2 = http2,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!cachedJwt || cachedJwt.keyId !== cfg.apnsKeyId || nowSec - cachedJwt.iat > 3000) {
    cachedJwt = { keyId: cfg.apnsKeyId, iat: nowSec, token: buildApnsJwt(cfg, nowSec) };
  }
  const body = buildApnsPayload(msg);
  return await new Promise((resolve) => {
    const client = http2mod.connect(apnsHost(cfg.apnsEnv));
    client.on('error', (e) => resolve({ ok: false, status: 0, reason: e.message }));
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${cachedJwt!.token}`,
      'apns-topic': HUB_BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10',
      'content-type': 'application/json',
    });
    let status = 0; let data = '';
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      client.close();
      let reason: string | undefined;
      if (status !== 200 && data) { try { reason = JSON.parse(data).reason; } catch { /* ignore */ } }
      resolve({ ok: status === 200, status, reason });
    });
    req.on('error', (e) => { try { client.close(); } catch { /* ignore */ } resolve({ ok: false, status: 0, reason: e.message }); });
    req.end(body);
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/apns.test.ts`
Expected: PASS (3 tests, incl. signature verification).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/apns.ts tests/orchestrator/apns.test.ts
git commit -m "feat: #71 APNs token-auth client (node:http2 + node:crypto)"
```

---

### Task 5: `push_devices` table + repo + `push:registerDevice`

**Files:**
- Modify: `orchestrator/db/migrations.ts` (add version 15)
- Create: `orchestrator/db/repositories/pushDevices.ts`
- Modify: `packages/shared/src/messagePort.ts`, `ipcContract.ts` (add `push:registerDevice`); `orchestrator/index.ts` (handler)
- Test: `tests/orchestrator/pushDevices.test.ts`

**Interfaces:**
- Produces:
  - migration v15 table `push_devices (id, apns_token UNIQUE, platform, registered_at)`
  - `class PushDevicesRepo { register(token: string, platform: string, now: number): void; remove(token: string): void; listTokens(): string[] }`
  - request `push:registerDevice { token: string; platform: string } → { ok: true }`
- Consumed by Task 7 (`listTokens`) and Task 4 (remove on 410).

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/pushDevices.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { PushDevicesRepo } from '../../orchestrator/db/repositories/pushDevices.js';

function db() { const d = new Database(':memory:'); runMigrations(d as never); return d; }

describe('PushDevicesRepo', () => {
  it('registers (idempotent on token), lists, removes', () => {
    const repo = new PushDevicesRepo(db() as never);
    repo.register('tokA', 'ios', 1);
    repo.register('tokA', 'ios', 2); // upsert, no dup
    repo.register('tokB', 'ios', 3);
    expect(repo.listTokens().sort()).toEqual(['tokA', 'tokB']);
    repo.remove('tokA');
    expect(repo.listTokens()).toEqual(['tokB']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/pushDevices.test.ts` → FAIL.

- [ ] **Step 3: Add migration + repo**

In `orchestrator/db/migrations.ts` append to the `MIGRATIONS` array:
```ts
{
  version: 15,
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS push_devices (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      apns_token    TEXT    NOT NULL UNIQUE,
      platform      TEXT    NOT NULL DEFAULT 'ios',
      registered_at INTEGER NOT NULL
    )`);
  },
},
```

```ts
// orchestrator/db/repositories/pushDevices.ts
import type { SqliteLike } from '../sqliteLike.js'; // match the type used by other repos
export class PushDevicesRepo {
  constructor(private db: SqliteLike) {}
  register(token: string, platform: string, now: number): void {
    this.db.prepare(
      `INSERT INTO push_devices (apns_token, platform, registered_at) VALUES (?, ?, ?)
       ON CONFLICT(apns_token) DO UPDATE SET platform = excluded.platform, registered_at = excluded.registered_at`,
    ).run(token, platform, now);
  }
  remove(token: string): void {
    this.db.prepare(`DELETE FROM push_devices WHERE apns_token = ?`).run(token);
  }
  listTokens(): string[] {
    return (this.db.prepare(`SELECT apns_token FROM push_devices`).all() as Array<{ apns_token: string }>)
      .map((r) => r.apns_token);
  }
}
```
*(Use the exact `SqliteLike`/prepare API the sibling repos in `orchestrator/db/repositories/` use — match `notifications.ts`.)*

- [ ] **Step 4: Add the request kind + handler**

OrchRequest/IpcRequest: `push:registerDevice { token: string; platform: string }`; responses `{ ok: true }`. In `handleRequest`:
```ts
case 'push:registerDevice':
  new PushDevicesRepo(handle!.db).register(req.payload.token, req.payload.platform, Date.now());
  return { ok: true };
```

- [ ] **Step 5: Rebuild shared + test + typecheck**

Run: `tsc -b packages/shared/tsconfig.json && npx vitest run tests/orchestrator/pushDevices.test.ts && npm run typecheck`
Expected: PASS (migration test confirms ADD works on node:sqlite + better-sqlite3 — note the [[sqlite-add-column-engine-divergence]] caveat: this is a CREATE TABLE, not ADD COLUMN, so it's safe).

- [ ] **Step 6: Commit**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/repositories/pushDevices.ts packages/shared/src/messagePort.ts packages/shared/src/ipcContract.ts orchestrator/index.ts tests/orchestrator/pushDevices.test.ts
git commit -m "feat: #71 push_devices table + repo + push:registerDevice"
```

---

### Task 6: Ping log + `messaging:getPing`

**Files:**
- Modify: `orchestrator/db/migrations.ts` (version 16: `pings` table)
- Create: `orchestrator/db/repositories/pings.ts`
- Modify: shared contract (`messaging:getPing`) + `handleRequest`
- Test: `tests/orchestrator/pings.test.ts`

**Interfaces:**
- Produces:
  - migration v16 `pings (id, instance_id, kind, title, body, created_at, answered_at)`
  - `interface PingView { id: number; instanceId: string; kind: string; title: string; body: string; createdAt: number; answeredAt: number | null }`
  - `class PingsRepo { create(p: { instanceId; kind; title; body; now }): number; get(id: number): PingView | null; markAnswered(id: number, now: number): void; markAnsweredByInstance(instanceId: string, now: number): void }`
  - request `messaging:getPing { pingId: number } → { ping: PingView | null }`
- Consumed by Task 7 (create) and Task 8 (markAnswered) and the iPad (getPing on tap).

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/pings.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { PingsRepo } from '../../orchestrator/db/repositories/pings.js';

function db() { const d = new Database(':memory:'); runMigrations(d as never); return d; }

describe('PingsRepo', () => {
  it('creates, gets, and marks answered', () => {
    const repo = new PingsRepo(db() as never);
    const id = repo.create({ instanceId: 'i1', kind: 'waiting-permission', title: 'api', body: 'čeká', now: 100 });
    expect(repo.get(id)).toEqual({ id, instanceId: 'i1', kind: 'waiting-permission', title: 'api', body: 'čeká', createdAt: 100, answeredAt: null });
    repo.markAnswered(id, 200);
    expect(repo.get(id)?.answeredAt).toBe(200);
    expect(repo.get(99999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** → `npx vitest run tests/orchestrator/pings.test.ts` FAIL.

- [ ] **Step 3: Migration v16 + repo**

```ts
{
  version: 16,
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS pings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT    NOT NULL,
      kind        TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      body        TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      answered_at INTEGER
    )`);
  },
},
```

```ts
// orchestrator/db/repositories/pings.ts
import type { SqliteLike } from '../sqliteLike.js';
export interface PingView { id: number; instanceId: string; kind: string; title: string; body: string; createdAt: number; answeredAt: number | null }
export class PingsRepo {
  constructor(private db: SqliteLike) {}
  create(p: { instanceId: string; kind: string; title: string; body: string; now: number }): number {
    const r = this.db.prepare(
      `INSERT INTO pings (instance_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(p.instanceId, p.kind, p.title, p.body, p.now);
    return Number(r.lastInsertRowid);
  }
  get(id: number): PingView | null {
    const row = this.db.prepare(`SELECT * FROM pings WHERE id = ?`).get(id) as
      | { id: number; instance_id: string; kind: string; title: string; body: string; created_at: number; answered_at: number | null } | undefined;
    if (!row) return null;
    return { id: row.id, instanceId: row.instance_id, kind: row.kind, title: row.title, body: row.body, createdAt: row.created_at, answeredAt: row.answered_at };
  }
  markAnswered(id: number, now: number): void { this.db.prepare(`UPDATE pings SET answered_at = ? WHERE id = ?`).run(now, id); }
  markAnsweredByInstance(instanceId: string, now: number): void {
    this.db.prepare(`UPDATE pings SET answered_at = ? WHERE instance_id = ? AND answered_at IS NULL`).run(now, instanceId);
  }
}
```

- [ ] **Step 4: Request + handler**

`messaging:getPing { pingId: number } → { ping: PingView | null }` in both contracts (import `PingView`). Handler:
```ts
case 'messaging:getPing':
  return { ping: new PingsRepo(handle!.db).get(req.payload.pingId) };
```

- [ ] **Step 5: Rebuild + test + typecheck**

Run: `tsc -b packages/shared/tsconfig.json && npx vitest run tests/orchestrator/pings.test.ts && npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/repositories/pings.ts packages/shared/src/messagePort.ts packages/shared/src/ipcContract.ts orchestrator/index.ts tests/orchestrator/pings.test.ts
git commit -m "feat: #71 pings table + repo + messaging:getPing"
```

---

### Task 7: Hub sender — attentionPing push + APNs fan-out

**Files:**
- Modify: `packages/shared/src/messagePort.ts`, `ipcContract.ts` (add `attentionPing` to `OrchPush` AND `IpcPush`)
- Create: `orchestrator/hubSender.ts`
- Modify: `orchestrator/index.ts` (`onEscalate` calls the hub sender)
- Test: `tests/orchestrator/hubSender.test.ts`

**Interfaces:**
- Consumes: `EscalationKind` (T1), `readHubConfig` (T3), `sendApns` (T4), `PushDevicesRepo` (T5), `PingsRepo` (T6), `escalationMessage` formatting, `emitPush`.
- Produces:
  - push `{ kind: 'attentionPing'; payload: { instanceId; pingId; kind; title; body } }`
  - `createHubSender(deps): { fire(instanceId: string, cwd: string, kind: EscalationKind): Promise<void> }` where `deps = { getConfig(): HubConfig; logPing(p): number; listTokens(): string[]; removeToken(t: string): void; emitPush(push): void; sendApns(cfg, token, msg): Promise<{ok;status;reason?}>; buildContext(instanceId, cwd, kind): { title; body } }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/hubSender.test.ts
import { describe, it, expect } from 'vitest';
import { createHubSender } from '../../orchestrator/hubSender.js';
import { DEFAULT_HUB_CONFIG } from '@watchtower/shared/hubConfig.js';

function deps(over = {}) {
  const pushes: any[] = []; const sent: any[] = []; const removed: string[] = [];
  const base = {
    getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: true, apnsKey: 'k', apnsKeyId: 'i', apnsTeamId: 't' }),
    logPing: () => 42,
    listTokens: () => ['tokA', 'tokB'],
    removeToken: (t: string) => removed.push(t),
    emitPush: (p: any) => pushes.push(p),
    sendApns: async (_c: any, token: string) => { sent.push(token); return token === 'tokB' ? { ok: false, status: 410, reason: 'Unregistered' } : { ok: true, status: 200 }; },
    buildContext: () => ({ title: 'api', body: 'čeká na povolení' }),
    ...over,
  };
  return { base, pushes, sent, removed };
}

describe('hubSender.fire', () => {
  it('emits attentionPing and pushes APNs to all tokens, pruning 410s', async () => {
    const { base, pushes, sent, removed } = deps();
    await createHubSender(base).fire('i1', '/x', 'waiting-permission');
    expect(pushes).toEqual([{ kind: 'attentionPing', payload: { instanceId: 'i1', pingId: 42, kind: 'waiting-permission', title: 'api', body: 'čeká na povolení' } }]);
    expect(sent.sort()).toEqual(['tokA', 'tokB']);
    expect(removed).toEqual(['tokB']); // 410 → pruned
  });

  it('does nothing when hub disabled', async () => {
    const { base, pushes, sent } = deps({ getConfig: () => ({ ...DEFAULT_HUB_CONFIG, enabled: false }) });
    await createHubSender(base).fire('i1', '/x', 'idle-notify');
    expect(pushes).toEqual([]); expect(sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement + add push kind**

Add to `OrchPush` (messagePort.ts) AND `IpcPush` (ipcContract.ts):
```ts
| { kind: 'attentionPing'; payload: { instanceId: string; pingId: number; kind: 'waiting-permission' | 'idle-notify' | 'crashed'; title: string; body: string } }
```

```ts
// orchestrator/hubSender.ts
import type { EscalationKind } from './escalationGate.js';
import type { HubConfig } from '@watchtower/shared/hubConfig.js';
import type { OrchPush } from '@watchtower/shared/messagePort.js';

export interface HubSenderDeps {
  getConfig(): HubConfig;
  logPing(p: { instanceId: string; kind: EscalationKind; title: string; body: string }): number;
  listTokens(): string[];
  removeToken(token: string): void;
  emitPush(push: OrchPush): void;
  sendApns(cfg: HubConfig, token: string, msg: { title: string; body: string; data: Record<string, unknown> }): Promise<{ ok: boolean; status: number; reason?: string }>;
  buildContext(instanceId: string, cwd: string, kind: EscalationKind): { title: string; body: string };
}

export function createHubSender(deps: HubSenderDeps) {
  return {
    async fire(instanceId: string, cwd: string, kind: EscalationKind): Promise<void> {
      const cfg = deps.getConfig();
      if (!cfg.enabled) return;
      const { title, body } = deps.buildContext(instanceId, cwd, kind);
      const pingId = deps.logPing({ instanceId, kind, title, body });
      deps.emitPush({ kind: 'attentionPing', payload: { instanceId, pingId, kind, title, body } });
      if (!cfg.apnsKey || !cfg.apnsKeyId || !cfg.apnsTeamId) return;
      const data = { instanceId, pingId };
      for (const token of deps.listTokens()) {
        const r = await deps.sendApns(cfg, token, { title, body, data });
        if (!r.ok && (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered')) deps.removeToken(token);
      }
    },
  };
}
```

- [ ] **Step 4: Wire into index.ts** — in `onEscalate` (Task 2), after the Slack dispatch, add the hub. Construct the sender once with real deps (PingsRepo.create, PushDevicesRepo.listTokens/remove, emitPush, apns.sendApns, and `buildContext` from `escalationMessage.ts`). Also OR-in hub to the gate's `armEnabled`:
```ts
return { escalateMs: slack.escalateMs, triggers: slack.triggers, armEnabled: slack.enabled || readHubConfig(new SettingsRepo(handle!.db)).enabled };
```
And in `onEscalate`: `void hubSender.fire(instanceId, cwd, kind);`

- [ ] **Step 5: Rebuild + test + typecheck + full suite**

Run: `tsc -b packages/shared/tsconfig.json && npx vitest run tests/orchestrator/hubSender.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/messagePort.ts packages/shared/src/ipcContract.ts orchestrator/hubSender.ts orchestrator/index.ts tests/orchestrator/hubSender.test.ts
git commit -m "feat: #71 hub sender — attentionPing push + APNs fan-out, gate OR-includes hub"
```

---

### Task 8: `messaging:reply` → pty injection

**Files:**
- Modify: shared contract (`messaging:reply`), `orchestrator/index.ts` (handler reusing `deliverSlackReply` logic + mark ping answered)
- Test: `tests/orchestrator/messagingReply.test.ts`

**Interfaces:**
- Consumes: the existing `deliverSlackReply(instanceId, text): boolean` injection; `PingsRepo.markAnsweredByInstance`.
- Produces: request `messaging:reply { instanceId: string; text: string } → { ok: boolean }`.

- [ ] **Step 1: Write the failing test** (pure injection helper)

Extract the injection into a tiny testable helper so it isn't buried in `handleRequest`:
```ts
// tests/orchestrator/messagingReply.test.ts
import { describe, it, expect } from 'vitest';
import { routeMessagingReply } from '../../orchestrator/messagingReply.js';

describe('routeMessagingReply', () => {
  it('delivers to the pty and marks the ping answered', () => {
    const writes: string[] = []; let answered: string | null = null;
    const ok = routeMessagingReply({ instanceId: 'i1', text: 'ano' }, {
      deliver: (id, text) => { writes.push(`${id}:${text}`); return true; },
      markAnswered: (id) => { answered = id; },
    });
    expect(ok).toBe(true);
    expect(writes).toEqual(['i1:ano']);
    expect(answered).toBe('i1');
  });
  it('returns false and does not mark answered when the instance is gone', () => {
    let answered = false;
    const ok = routeMessagingReply({ instanceId: 'dead', text: 'x' }, { deliver: () => false, markAnswered: () => { answered = true; } });
    expect(ok).toBe(false); expect(answered).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement helper + handler**

```ts
// orchestrator/messagingReply.ts
export interface MessagingReplyDeps {
  deliver(instanceId: string, text: string): boolean; // = deliverSlackReply
  markAnswered(instanceId: string): void;
}
export function routeMessagingReply(msg: { instanceId: string; text: string }, deps: MessagingReplyDeps): boolean {
  const delivered = deps.deliver(msg.instanceId, msg.text);
  if (delivered) deps.markAnswered(msg.instanceId);
  return delivered;
}
```
Contract: `messaging:reply { instanceId: string; text: string } → { ok: boolean }`. Handler:
```ts
case 'messaging:reply':
  return { ok: routeMessagingReply(req.payload, {
    deliver: deliverSlackReply,
    markAnswered: (id) => new PingsRepo(handle!.db).markAnsweredByInstance(id, Date.now()),
  }) };
```

- [ ] **Step 4: Rebuild + test + typecheck** → PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/messagingReply.ts packages/shared/src/messagePort.ts packages/shared/src/ipcContract.ts orchestrator/index.ts tests/orchestrator/messagingReply.test.ts
git commit -m "feat: #71 messaging:reply → pty injection + mark ping answered"
```

---

### Task 9: iPad — push registration

**Files:**
- Modify: `apps/ipad/package.json` (add `@capacitor/push-notifications@^6`)
- Create: `apps/ipad/src/state/pushRegistration.ts`
- Modify: `apps/ipad/src/App.tsx` (register once inside `ConnectionProvider`)
- Test: `tests/ipad/pushRegistration.test.ts`

**Interfaces:**
- Produces: `registerForPush(deps: { requestPermission(): Promise<boolean>; register(): Promise<void>; onToken(cb: (token: string) => void): void; sendToken(token: string): Promise<void> }): Promise<void>` — pure orchestration, testable without Capacitor.
- Consumes: the connection bridge `invoke('push:registerDevice', { token, platform: 'ios' })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ipad/pushRegistration.test.ts
import { describe, it, expect } from 'vitest';
import { registerForPush } from '../../apps/ipad/src/state/pushRegistration.js';

describe('registerForPush', () => {
  it('registers and forwards the token when permission granted', async () => {
    let tokenCb: (t: string) => void = () => {}; const sent: string[] = []; let registered = false;
    await registerForPush({
      requestPermission: async () => true,
      register: async () => { registered = true; tokenCb('TOKEN123'); },
      onToken: (cb) => { tokenCb = cb; },
      sendToken: async (t) => { sent.push(t); },
    });
    expect(registered).toBe(true);
    expect(sent).toEqual(['TOKEN123']);
  });
  it('does nothing when permission denied', async () => {
    const sent: string[] = [];
    await registerForPush({ requestPermission: async () => false, register: async () => { throw new Error('should not register'); }, onToken: () => {}, sendToken: async (t) => { sent.push(t); } });
    expect(sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement + wire**

```ts
// apps/ipad/src/state/pushRegistration.ts
export interface PushDeps {
  requestPermission(): Promise<boolean>;
  register(): Promise<void>;
  onToken(cb: (token: string) => void): void;
  sendToken(token: string): Promise<void>;
}
export async function registerForPush(deps: PushDeps): Promise<void> {
  deps.onToken((t) => { void deps.sendToken(t); });
  const granted = await deps.requestPermission();
  if (!granted) return;
  await deps.register();
}
```
Add dep: `npm install @capacitor/push-notifications@^6 -w @watchtower/ipad`. In `App.tsx`, inside a component under `ConnectionProvider`, call `registerForPush` with Capacitor-backed deps:
```ts
import { PushNotifications } from '@capacitor/push-notifications';
// requestPermission: async () => (await PushNotifications.requestPermissions()).receive === 'granted'
// register: () => PushNotifications.register()
// onToken: (cb) => { void PushNotifications.addListener('registration', (t) => cb(t.value)); }
// sendToken: (t) => bridge.invoke('push:registerDevice', { token: t, platform: 'ios' })
```

- [ ] **Step 4: Test + typecheck + build**

Run: `npx vitest run tests/ipad/pushRegistration.test.ts && npm run typecheck && npm run build -w @watchtower/ipad`
Expected: PASS (the `@capacitor/push-notifications` import resolves; bundle builds).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/package.json package-lock.json apps/ipad/src/state/pushRegistration.ts apps/ipad/src/App.tsx tests/ipad/pushRegistration.test.ts
git commit -m "feat: #71 iPad push registration → push:registerDevice"
```

---

### Task 10: iPad — ping banner + reply box + tap routing

**Files:**
- Create: `apps/ipad/src/state/usePings.ts`, `apps/ipad/src/state/pingStore.ts`
- Create: `apps/ipad/src/components/PingReply.tsx`
- Modify: `apps/ipad/src/App.tsx` (render PingReply in the Shell; handle notification tap)
- Test: `tests/ipad/pingStore.test.ts`

**Interfaces:**
- Consumes: `attentionPing` push via `bridge.on('attentionPing', …)`; `bridge.invoke('messaging:reply', { instanceId, text })`; `bridge.invoke('messaging:getPing', { pingId })`; Capacitor `pushNotificationActionPerformed`.
- Produces: `applyPing(prev: Ping | null, p: Ping): Ping` (latest-wins reducer); `usePings()` hook; `<PingReply>` component.

- [ ] **Step 1: Write the failing test** (pure reducer)

```ts
// tests/ipad/pingStore.test.ts
import { describe, it, expect } from 'vitest';
import { applyPing, type Ping } from '../../apps/ipad/src/state/pingStore.js';

const p = (id: number): Ping => ({ instanceId: 'i1', pingId: id, kind: 'waiting-permission', title: 't', body: 'b' });

describe('applyPing', () => {
  it('keeps the latest ping', () => {
    expect(applyPing(null, p(1))).toEqual(p(1));
    expect(applyPing(p(1), p(2))).toEqual(p(2));
  });
  it('ignores an older pingId', () => {
    expect(applyPing(p(5), p(3))).toEqual(p(5));
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement reducer + hook + component**

```ts
// apps/ipad/src/state/pingStore.ts
export interface Ping { instanceId: string; pingId: number; kind: string; title: string; body: string }
export function applyPing(prev: Ping | null, next: Ping): Ping {
  if (prev && next.pingId <= prev.pingId) return prev;
  return next;
}
```
`usePings.ts`: subscribe to `attentionPing` push (like `useAuthBlock`), reduce with `applyPing`, expose `{ ping, clear() }`. `PingReply.tsx`: when `ping` set, show a banner (instance title + body) + a text field + "Odpovědět" button → `bridge.invoke('messaging:reply', { instanceId: ping.instanceId, text })` → on `{ok:true}` clear; on `{ok:false}` show "Instance už neběží". Plain React + inline styles (palette `#0e0f12`/`#7c6df0`, like #75's components). In `App.tsx` Shell, render `<PingReply/>` above the module content (visible on any tab). For tap routing, add a `pushNotificationActionPerformed` listener that reads `data.pingId`, calls `messaging:getPing`, and seeds the ping into the store.

- [ ] **Step 4: Test + typecheck + build** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/usePings.ts apps/ipad/src/state/pingStore.ts apps/ipad/src/components/PingReply.tsx apps/ipad/src/App.tsx tests/ipad/pingStore.test.ts
git commit -m "feat: #71 iPad ping banner + reply box + tap routing"
```

---

### Task 11: Desktop Settings — hub config panel

**Files:**
- Create/modify: the desktop Settings module (mirror the existing Slack panel) — `apps/desktop/src/.../settings/` (locate the Slack config panel and add a sibling "Messaging hub" panel)
- Create: `apps/desktop/src/state/useHubConfig.ts` (thin hook over `hub:getConfig`/`hub:setConfig`)
- Test: none new for UI (MUI/desktop, not unit-tested in node env); a small hook reducer test if logic warrants.

**Interfaces:**
- Consumes: `hub:getConfig` / `hub:setConfig` (Task 3).
- Produces: a Settings panel with fields: enabled toggle, APNs `.p8` (multiline), Key ID, Team ID, environment (sandbox/production select). On save → `hub:setConfig`.

- [ ] **Step 1: Locate the Slack settings panel** (`grep -rl "slack:getConfig" apps/desktop/src`) and read it as the template.
- [ ] **Step 2: Add `useHubConfig` hook** mirroring the Slack config hook (`invoke('hub:getConfig')` on mount; `invoke('hub:setConfig', { config })` on save).
- [ ] **Step 3: Add the "Messaging hub" panel** with the five fields (Czech labels: `Povolit`, `APNs klíč (.p8)`, `Key ID`, `Team ID`, `Prostředí`), following the Slack panel's MUI structure.
- [ ] **Step 4: Typecheck + build the desktop app** (`npm run typecheck`; confirm no NEW errors).
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat: #71 desktop Settings panel for messaging-hub APNs config"
```

---

### Task 12: APNs/Apple setup runbook

**Files:**
- Create: `docs/runbooks/apns-messaging-hub.md`

- [ ] **Step 1: Write the runbook**

```markdown
# APNs setup for the Watchtower messaging hub (#71)

1. Apple Developer → Certificates, IDs & Profiles → Keys → **+** → enable
   **Apple Push Notifications service (APNs)** → download the **`.p8`** (once).
   Note the **Key ID**; note your **Team ID** (top-right of the portal).
2. Xcode (apps/ipad) → Signing & Capabilities → **+ Capability → Push
   Notifications**. This adds the `aps-environment` entitlement
   (`development` for Xcode installs, `production` for TestFlight/App Store).
3. Watchtower → Settings → **Messaging hub**: paste the `.p8` contents, Key ID,
   Team ID; set **Environment** to match the installed build
   (**sandbox** for an Xcode/dev install, **production** for TestFlight).
   Enable the hub.
4. On the iPad, accept the notification permission prompt on first launch.

**Gotcha:** a sandbox/production mismatch makes APNs silently not deliver
(no error) — the env must match how the build was signed/installed.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/apns-messaging-hub.md
git commit -m "docs: #71 APNs / Apple Push setup runbook"
```

---

## Self-Review

**Spec coverage:**
- §2 WS push + APNs, no Supabase → Tasks 7 (push), 4 (APNs), and the absence of any Supabase. ✓
- §2 shared escalation gate → Tasks 1–2. ✓
- §2 reply → pty (deliverSlackReply) → Task 8. ✓
- §2 tap-to-open reply → Task 10 (tap routing + getPing). ✓
- §2 APNs token auth, env configurable → Tasks 3 (config) + 4 (client). ✓
- §2 secrets in settings table → Task 3. ✓
- §3.1 device registry → Task 5; ping log → Task 6; hub config → Task 3; reply handler → Task 8; ping context (escalationMessage) → Task 7 `buildContext`. ✓
- §3.2 iPad push registration → Task 9; ping banner + reply + tap → Task 10. ✓
- §3.3 contract (`attentionPing` in OrchPush+IpcPush; the 5 request kinds) → Tasks 3,5,6,7,8. ✓
- §5 error handling (410 prune, dead instance, disabled) → Tasks 7, 8. ✓
- §6 testing (gate, APNs JWT, reply, device, iPad logic) → covered per task. ✓
- §7 runbook → Task 12. ✓
- Desktop config entry point (needed to enter APNs keys) → Task 11. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. Task 11 (desktop MUI panel) references "mirror the Slack panel" — acceptable because the exact panel path is discovered in Step 1 and the field list + IPC are fully specified; the implementer follows the existing Slack panel as the concrete template (not unit-tested in node env).

**Type consistency:** `EscalationKind` identical across Tasks 1,2,7,8. `HubConfig` fields identical across 3,4,7,11. `attentionPing` payload shape identical in the contract (Task 7) and the iPad `Ping` (Task 10: `{instanceId,pingId,kind,title,body}`). `messaging:reply { instanceId, text } → { ok }` consistent across 8 and 10. `PingView`/`PingsRepo` consistent across 6,7,8.

**Note on the SlackEscalator refactor (Task 2):** the gate timing/triggers continue to read the existing `slack_escalate_ms` / `slack_triggers` settings (treated as the shared "escalation" params); `armEnabled` becomes `slack.enabled || hub.enabled`. When the hub is disabled this reproduces the old behaviour exactly — the gate tests (Task 1) lock that in.
