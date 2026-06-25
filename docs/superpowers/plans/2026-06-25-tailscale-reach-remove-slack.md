# Tailscale reach + remove Slack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the #71 messaging hub reachable off the home LAN via Tailscale (reusing its WS push + reply), and remove the Slack integration so the hub is the sole attention channel.

**Architecture:** `resolveWsRemoteBind`'s `auto` mode prefers the Tailscale CGNAT address so the existing WS server is reachable over the tailnet (iPad enters the Mac's `100.x` IP — no iPad change). The `EscalationGate` moves its `escalateMs`/`triggers` source from Slack config to `HubConfig`; then all Slack code (listener, reply router, Block-Kit formatter, client, config, `slack:*` IPC, desktop panel, `@slack/*` deps, tests) is deleted. APNs is untouched.

**Tech Stack:** Node (`os.networkInterfaces`), Fastify WS bridge, better-sqlite3 settings, React (iPad plain / desktop MUI), vitest (`environment: node`).

## Global Constraints

- **Branch:** `feat/71-messaging-hub` worktree at `/Users/jan/Projects/Watchtower/.claude/worktrees/messaging-hub-71` (isolated node_modules). Run git/npm/npx there. Do NOT touch the main checkout.
- **`@watchtower/shared` is a BUILT composite** — after editing `packages/shared/src/*`, run `npx tsc -b packages/shared/tsconfig.json` (worktree-local). Vitest resolves shared via the `src` alias.
- **Build-green invariant:** every task ends with `npm test` green and the relevant typechecks clean (no NEW errors beyond the documented pre-existing desktop drift: slotProps/ThemeMode/BoardTab/EpicDrawer). A dangling Slack reference is a build failure — Slack removal lands atomically per task so no intermediate commit has a half-removed reference.
- **KEEP** (do NOT delete): `EscalationGate`, `hubSender`, `messagingReply`, the `windowFocusChanged`→`setWindowFocused` wiring, and the pty-injection function (renamed `deliverSlackReply`→`deliverReply`).
- **Tailscale CGNAT range** is `100.64.0.0/10` (addresses `100.64.0.0`–`100.127.255.255`).
- **Never bind `0.0.0.0`** (unchanged design rule).
- Czech UI strings; iPad plain React (no MUI); desktop MUI. Do NOT commit `dist/`.

---

### Task 1: Tailscale-preferring `auto` bind

**Files:**
- Modify: `orchestrator/remoteBind.ts`
- Test: `tests/orchestrator/remoteBind.test.ts` (create if absent; else extend)

**Interfaces:**
- `resolveWsRemoteBind(env, interfaces)` unchanged signature; `auto` now prefers a `100.64.0.0/10` IPv4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/remoteBind.test.ts
import { describe, it, expect } from 'vitest';
import { resolveWsRemoteBind } from '../../orchestrator/remoteBind.js';

const IF = {
  en0: [{ address: '192.168.1.50', family: 'IPv4', internal: false }],
  utun3: [{ address: '100.97.12.34', family: 'IPv4', internal: false }],
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
};

describe('resolveWsRemoteBind auto', () => {
  it('prefers the Tailscale (100.64/10) address over LAN', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, IF as never))
      .toEqual({ host: '100.97.12.34', port: 7445 });
  });
  it('falls back to LAN when no Tailscale address is present', () => {
    const lanOnly = { en0: IF.en0, lo0: IF.lo0 };
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, lanOnly as never))
      .toEqual({ host: '192.168.1.50', port: 7445 });
  });
  it('honours an explicit host verbatim', () => {
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: '100.1.2.3', WATCHTOWER_WS_PORT: '9000' }, IF as never))
      .toEqual({ host: '100.1.2.3', port: 9000 });
  });
  it('returns null when unset', () => {
    expect(resolveWsRemoteBind({}, IF as never)).toBeNull();
  });
  it('excludes 100.64/10 boundaries correctly (100.63 is NOT tailscale, 100.64 IS)', () => {
    const edge = { a: [{ address: '100.63.0.1', family: 'IPv4', internal: false }], b: [{ address: '100.64.0.1', family: 'IPv4', internal: false }] };
    expect(resolveWsRemoteBind({ WATCHTOWER_WS_HOST: 'auto' }, edge as never))
      .toEqual({ host: '100.64.0.1', port: 7445 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/remoteBind.test.ts`
Expected: FAIL — `auto` currently returns the first non-internal IPv4 (`192.168.1.50`), not the Tailscale address.

- [ ] **Step 3: Implement**

In `orchestrator/remoteBind.ts`, add a CGNAT test and use it in the `auto` branch:

```ts
// A Tailscale address is in the CGNAT range 100.64.0.0/10 (100.64.0.0–100.127.255.255).
function isTailscale(addr: string): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(addr);
  if (!m) return false;
  const a = Number(m[1]); const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}
```

Replace the `if (raw !== 'auto') ...` / interface-walk body so `auto` does two passes:

```ts
  if (raw !== 'auto') return { host: raw, port };
  const v4 = (i: { family: string | number; internal: boolean }) =>
    (i.family === 'IPv4' || i.family === 4) && !i.internal;
  // Pass 1: prefer a Tailscale (CGNAT) address so the server is reachable off-LAN.
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (v4(i as never) && isTailscale((i as { address: string }).address)) {
        return { host: (i as { address: string }).address, port };
      }
    }
  }
  // Pass 2: fall back to the first non-internal LAN IPv4.
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (v4(i as never)) return { host: (i as { address: string }).address, port };
    }
  }
  return null;
```
(Match the file's existing `Interfaces` type / field access; the above mirrors the original walk, adding the Tailscale-preferring first pass.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/remoteBind.test.ts && npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: PASS (5 tests); orchestrator typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/remoteBind.ts tests/orchestrator/remoteBind.test.ts
git commit -m "feat: #71 auto-bind prefers Tailscale (100.64/10) for off-LAN reach"
```

---

### Task 2: Extend `HubConfig` with `escalateMs` + `triggers`

**Files:**
- Modify: `packages/shared/src/hubConfig.ts`
- Modify: `orchestrator/services/hubConfig.ts`
- Test: `tests/orchestrator/hubConfig.test.ts` (extend)

**Interfaces:**
- Produces: `HubConfig` gains `escalateMs: number` and `triggers: { permission: boolean; idle: boolean; crash: boolean }`. `DEFAULT_HUB_CONFIG` gains `escalateMs: 300000`, `triggers: { permission: true, idle: true, crash: true }`. `HUB_SETTING_KEYS` gains `escalateMs: 'hub_escalate_ms'`, `triggers: 'hub_triggers'`. Consumed by Tasks 3 (gate) and 5 (desktop panel).

- [ ] **Step 1: Write the failing test (extend hubConfig.test.ts)**

```ts
it('round-trips escalateMs + triggers', () => {
  const s = fakeSettings();
  const cfg = { enabled: true, apnsKey: 'k', apnsKeyId: 'i', apnsTeamId: 't', apnsEnv: 'sandbox' as const,
    escalateMs: 120000, triggers: { permission: false, idle: true, crash: true } };
  writeHubConfig(s as never, cfg);
  expect(readHubConfig(s as never)).toEqual(cfg);
});
it('defaults escalateMs=300000 and all triggers true', () => {
  const c = readHubConfig(fakeSettings() as never);
  expect(c.escalateMs).toBe(300000);
  expect(c.triggers).toEqual({ permission: true, idle: true, crash: true });
});
```
(Ensure `fakeSettings()` exposes `getNumber` — the existing test helper already does.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/hubConfig.test.ts` → FAIL (fields missing).

- [ ] **Step 3: Implement**

`packages/shared/src/hubConfig.ts` — extend the interface, default, and keys:
```ts
export interface HubConfig {
  enabled: boolean;
  apnsKey: string;
  apnsKeyId: string;
  apnsTeamId: string;
  apnsEnv: 'sandbox' | 'production';
  escalateMs: number;
  triggers: { permission: boolean; idle: boolean; crash: boolean };
}
export const DEFAULT_HUB_CONFIG: HubConfig = {
  enabled: false, apnsKey: '', apnsKeyId: '', apnsTeamId: '', apnsEnv: 'sandbox',
  escalateMs: 300000, triggers: { permission: true, idle: true, crash: true },
};
export const HUB_SETTING_KEYS = {
  enabled: 'hub_enabled',
  apnsKey: 'hub_apns_key',
  apnsKeyId: 'hub_apns_key_id',
  apnsTeamId: 'hub_apns_team_id',
  apnsEnv: 'hub_apns_env',
  escalateMs: 'hub_escalate_ms',
  triggers: 'hub_triggers',
} as const;
```

`orchestrator/services/hubConfig.ts` — add the new fields to `SettingsLike` (needs `getNumber`), `readHubConfig`, `writeHubConfig`:
```ts
interface SettingsLike {
  getString(key: string, def: string): string;
  getNumber(key: string, def: number): number;
  set(key: string, value: string): void;
}
// in readHubConfig, after apnsEnv:
  escalateMs: settings.getNumber(HUB_SETTING_KEYS.escalateMs, DEFAULT_HUB_CONFIG.escalateMs),
  triggers: parseTriggers(settings.getString(HUB_SETTING_KEYS.triggers, '')),
// helper:
function parseTriggers(raw: string): HubConfig['triggers'] {
  if (!raw) return { ...DEFAULT_HUB_CONFIG.triggers };
  try {
    const t = JSON.parse(raw);
    return { permission: !!t.permission, idle: !!t.idle, crash: !!t.crash };
  } catch { return { ...DEFAULT_HUB_CONFIG.triggers }; }
}
// in writeHubConfig, add:
  settings.set(HUB_SETTING_KEYS.escalateMs, String(cfg.escalateMs));
  settings.set(HUB_SETTING_KEYS.triggers, JSON.stringify(cfg.triggers));
```

- [ ] **Step 4: Rebuild shared + test + typecheck**

Run: `npx tsc -b packages/shared/tsconfig.json && npx vitest run tests/orchestrator/hubConfig.test.ts && npm run typecheck`
Expected: PASS. Note: `npm run typecheck` will now show errors anywhere `HubConfig` is constructed without the new fields (the desktop hub panel from #71). If the panel builds a literal `HubConfig`, it spreads from `config` state (loaded via `hub:getConfig`), so it carries the new fields through — verify no NEW typecheck error appears; if one does, it belongs to Task 5 — note it and proceed only if it's confined to the desktop panel literal (Task 5 fixes it). If orchestrator/shared are clean, that's the gate for THIS task.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/hubConfig.ts orchestrator/services/hubConfig.ts tests/orchestrator/hubConfig.test.ts
git commit -m "feat: #71 HubConfig owns escalateMs + triggers"
```

---

### Task 3: Repoint the gate to `HubConfig`; hub-only escalation; rename `deliverReply`

**Files:**
- Modify: `orchestrator/index.ts`

**Interfaces:**
- Consumes: `readHubConfig` (Task 2). The gate's `getParams()` reads `escalateMs`/`triggers`/`armEnabled` from `HubConfig` only.
- After this task Slack code still EXISTS and compiles, but escalation no longer touches Slack config and the hub no longer shares Slack's timing.

- [ ] **Step 1: Repoint the gate + onEscalate**

In `orchestrator/index.ts`, replace the `onEscalate` closure and the `EscalationGate` constructor (the explore located them ~lines 1260-1268):
```ts
const onEscalate = (instanceId: string, cwd: string, kind: EscalationKind) => {
  void hubSender.fire(instanceId, cwd, kind);
};
escalationGate = new EscalationGate(() => {
  const hub = readHubConfig(new SettingsRepo(handle!.db));
  return { escalateMs: hub.escalateMs, triggers: hub.triggers, armEnabled: hub.enabled };
}, onEscalate);
```
Remove the now-unused `readSlackConfig` call inside these (the import stays until Task 4 if other Slack handlers still use it — they do: `slack:getConfig`/`setConfig`/`test`, `postSlack`, `startSlackListener`).

- [ ] **Step 2: Rename `deliverSlackReply` → `deliverReply`**

Rename the function (the explore: index.ts ~lines 345-352) and update BOTH references:
- the `messaging:reply` handler (`deliver: deliverSlackReply` → `deliver: deliverReply`),
- the `SlackListener` construction (`deliver: deliverSlackReply` → `deliver: deliverReply`) — still present until Task 4.

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: orchestrator compiles (Slack code still present and valid); suite green. Escalation now fires the hub only and reads timing from `HubConfig`.

- [ ] **Step 4: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat: #71 escalation reads HubConfig, dispatches hub-only; rename deliverReply"
```

---

### Task 4: Remove desktop Slack UI; add escalateMs + triggers to the hub panel

> Ordered BEFORE the contract removal: the desktop `useSlackConfig` hook invokes the `slack:*` IPC kinds, so the desktop Slack code must go while those kinds still exist — keeping `npm run typecheck` fully green after this commit.

**Files:**
- Delete: `apps/desktop/src/components/settings/SlackTab.tsx`, `apps/desktop/src/state/useSlackConfig.ts`
- Modify: `apps/desktop/src/util/settingsUrl.ts`, `apps/desktop/src/components/ModuleRail.tsx`, `apps/desktop/src/components/settings/ModuleSettings.tsx`, the hub settings panel + hook from #71 (`grep -rl "hub:getConfig" apps/desktop/src`)

**Interfaces:** Consumes the extended `HubConfig` (Task 2). Leaves the `slack:*` IPC kinds in place (orphaned handlers — removed in Task 5).

- [ ] **Step 1: Delete the Slack panel + hook, deregister**

```bash
git rm apps/desktop/src/components/settings/SlackTab.tsx apps/desktop/src/state/useSlackConfig.ts
```
- `settingsUrl.ts`: remove `'slack'` from `SETTINGS_TABS`.
- `ModuleRail.tsx`: remove the `{ id: 'slack', label: 'Slack', … }` entry.
- `ModuleSettings.tsx`: remove `import { SlackTab }` and `{view.tab === 'slack' && <SlackTab />}`.
(Leave `McpTab`/`HooksTab` Slack template strings — not the integration.)

- [ ] **Step 2: Add escalateMs + triggers to the hub panel**

In the hub settings panel (the #71 Task 11 component, found via the grep), add MUI fields bound to `config.escalateMs` (a number `TextField`) and `config.triggers.{permission,idle,crash}` (three `Switch`/`Checkbox`), wired through the same `patch`/save pattern the panel already uses for the APNs fields. Czech labels: `Prodleva (ms)`, `Spouštěče`, `Povolení`, `Nečinnost`, `Pád`.

- [ ] **Step 3: Typecheck + suite**

Run: `npm run typecheck && npm test`
Expected: no NEW desktop typecheck errors (the `slack:*` kinds still exist so nothing dangles; pre-existing drift only); suite green. Verify desktop Slack integration gone: `grep -rniE "slack" apps/desktop/src --include=*.tsx | grep -viE "mcp|hook|server-slack|hooks.slack.com" || echo CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: #71 remove desktop Slack panel; hub panel gains escalateMs + triggers"
```

---

### Task 5: Remove orchestrator Slack code + shared contract + deps + tests

> Runs AFTER the desktop is Slack-free (Task 4), so removing the `slack:*` kinds leaves nothing dangling and `npm run typecheck` stays fully green.

**Files:**
- Delete: `orchestrator/slackListener.ts`, `orchestrator/slackReply.ts`, `orchestrator/escalationMessage.ts`, `orchestrator/services/slackClient.ts`, `orchestrator/services/slackConfig.ts`, `packages/shared/src/slackConfig.ts`, `tests/orchestrator/slackReply.test.ts`, `tests/orchestrator/services/slackConfig.test.ts`, `tests/shared/slackConfig.test.ts`
- Modify: `orchestrator/index.ts`, `packages/shared/src/messagePort.ts`, `packages/shared/src/ipcContract.ts`, root `package.json`

**Interfaces:** removes the `slack:getConfig|setConfig|test` IPC kinds and all Slack symbols. Every reference (orchestrator + contract; desktop already clean from Task 4) is removed together → build green.

- [ ] **Step 1: Delete the Slack files**

```bash
git rm orchestrator/slackListener.ts orchestrator/slackReply.ts orchestrator/escalationMessage.ts orchestrator/services/slackClient.ts orchestrator/services/slackConfig.ts packages/shared/src/slackConfig.ts tests/orchestrator/slackReply.test.ts tests/orchestrator/services/slackConfig.test.ts tests/shared/slackConfig.test.ts
```

- [ ] **Step 2: Strip Slack from `orchestrator/index.ts`**

Remove (per the explore's line refs):
- Imports: `SlackListener`, `formatEscalationMessage`, `WebApiSlackClient`/`SlackClient`, `readSlackConfig`/`writeSlackConfig`.
- Module state: `slackListener`, `slackThreadToInstance`, `slackInstanceToThread`, `slackDmChannel`.
- Functions: `postSlack`, `ackSlackReply`, `startSlackListener`, `setSlackDmChannel`, `forgetSlackThread`.
- `forgetSlackThread(...)` callsites in `applyTransition` (crash/finish/clearAttention branches) and `disposeInstanceRow`.
- Handler cases `slack:getConfig`, `slack:setConfig`, `slack:test`.
- `SlackListener` construction + `void startSlackListener()` + the two `slackListener?.stop()` shutdown hooks.

- [ ] **Step 3: Remove `slack:*` kinds from both contract files**

In `packages/shared/src/messagePort.ts`: remove the three `slack:*` entries from `OrchRequest` + `OrchResponse` and the `SlackConfig` import. In `packages/shared/src/ipcContract.ts`: remove them from `IpcRequest` + `IpcResponse` and the `SlackConfig` import.

- [ ] **Step 4: Remove `@slack/*` deps**

In root `package.json`, delete `@slack/socket-mode` and `@slack/web-api`. Then `npm install` (worktree) to update the lockfile.

- [ ] **Step 5: Verify no Slack references remain + build green**

```bash
grep -rniE "slack" orchestrator/ packages/shared/src/ --include=*.ts | grep -viE "test|\.bak" || echo "NO SLACK REFS"
npx tsc -b packages/shared/tsconfig.json && npm run typecheck && npm test
```
Expected: "NO SLACK REFS" in orchestrator + shared src; **full `npm run typecheck` clean** (desktop already Slack-free from Task 4; only pre-existing drift remains); suite green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: #71 remove Slack integration (orchestrator, contract, deps, tests)"
```

---

### Task 6: Tailscale runbook + fold the misnamed gate test

**Files:**
- Create: `docs/runbooks/tailscale-reach.md`
- Modify: `tests/orchestrator/escalationGate.test.ts` (absorb the focus-flip/timer-reset cases)
- Delete: `tests/orchestrator/slackEscalator.test.ts` (it currently tests `EscalationGate` under a misleading name — its cases move into `escalationGate.test.ts`)

- [ ] **Step 1: Fold the gate test**

Open `tests/orchestrator/slackEscalator.test.ts` (despite the name, it tests `EscalationGate`'s focus-flip + timer-reset). Move its two test cases verbatim into `tests/orchestrator/escalationGate.test.ts` (same imports already present there), then `git rm tests/orchestrator/slackEscalator.test.ts`.

- [ ] **Step 2: Verify the merged test passes**

Run: `npx vitest run tests/orchestrator/escalationGate.test.ts`
Expected: PASS (original 6 + the 2 folded-in cases).

- [ ] **Step 3: Write the runbook**

```markdown
# Tailscale reach for the Watchtower iPad (#71 / #72 reachability)

Make the messaging hub (and the rest of the iPad live plane) work away from
the home Wi-Fi by reaching the Mac over Tailscale.

1. Install **Tailscale** on the Mac and the iPad; sign both into the **same
   tailnet**.
2. On the Mac, find its Tailscale IP: `tailscale ip -4` (a `100.x.x.x` address).
3. In the dev env (`.env` / shell), set `WATCHTOWER_WS_HOST=auto` — the
   orchestrator now **prefers the Tailscale (`100.64.0.0/10`) address** when
   binding, so it's reachable both away (over Tailscale) and at home (Tailscale
   routes locally). (Or set `WATCHTOWER_WS_HOST` to the `100.x` IP explicitly.)
4. On the iPad, enter that **`100.x` Tailscale IP** as the host (port 7445,
   same bearer token). Pings, the reply box, and the terminal mirror now work
   off-LAN.

**Still required:** APNs (to wake a locked/closed iPad — unchanged). **Not
covered here:** Wake-on-LAN to wake a *sleeping* Mac (the hardware part of #72,
still parked) — this reaches an **awake** Mac.

**Security:** Tailscale restricts reachability to your tailnet; the bearer
token remains the access control. The server never binds `0.0.0.0`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/tailscale-reach.md tests/orchestrator/escalationGate.test.ts tests/orchestrator/slackEscalator.test.ts
git commit -m "docs: #71 Tailscale runbook; fold gate focus-flip test into escalationGate.test.ts"
```

---

## Self-Review

**Spec coverage:**
- §3 Tailscale bind (`auto` prefers 100.64/10) + runbook → Tasks 1, 6. ✓
- §3.2 iPad no change → no task (correct). ✓
- §4.1 delete Slack files → Task 4 Step 1. ✓
- §4.2 contract `slack:*` removal → Task 4 Step 3. ✓
- §4.3 index.ts Slack strip → Tasks 3 (gate/onEscalate/rename) + 5 (everything else). ✓
- §4.4 desktop UI removal → Task 4 Step 1. ✓
- §4.5 `@slack/*` deps → Task 5 Step 4. ✓
- §4.6 leave orphaned settings rows → no task (correct). ✓
- §5 escalation params → `HubConfig` (shared + service + gate + desktop fields) → Tasks 2 (config), 3 (gate), 4 (desktop fields). ✓
- §6 testing (remoteBind, hubConfig round-trip, build-green, gate test fold) → Tasks 1, 2, 4/5 verification, 6. ✓
- `deliverSlackReply`→`deliverReply` → Task 3 Step 2. ✓

**Placeholder scan:** Deletion tasks (4, 5) list exact files/symbols + a grep verification command rather than "complete code" — appropriate for removals (the precise removal set + a "no refs remain" check is the content). Code-adding steps (1, 2) show complete code. No TBD/TODO.

**Type/name consistency:** `HubConfig` extended shape (`escalateMs`, `triggers`) identical across Tasks 2, 3, 5. `deliverReply` name consistent (Task 3 rename → Task 4 keeps it). `EscalationKind`/`EscalationGate`/`hubSender` untouched. The build-green invariant is explicitly sequenced: Task 3 leaves Slack compiling-but-unused; Task 4 removes it atomically; Task 5 clears desktop.

**Note (build-green ordering):** Desktop Slack removal (Task 4) runs BEFORE the `slack:*` contract-kind removal (Task 5), because the desktop `useSlackConfig` hook invokes those kinds — removing the kinds first would dangle the desktop. With this order, the orphaned orchestrator `slack:*` handlers between Tasks 4 and 5 still compile (the kinds still exist), so `npm run typecheck` is **fully green after every task**, and Task 5 removes the now-unused kinds + handlers together.
