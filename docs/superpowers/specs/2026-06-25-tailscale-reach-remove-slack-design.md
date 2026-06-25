# Tailscale reach + remove Slack — Design

**Date:** 2026-06-25
**Issue:** #71 follow-on (cross-device hub becomes the sole attention channel) + the Tailscale-reach slice of #72.
**Branch:** `feat/71-messaging-hub` (stacked on the messaging hub; extends PR #103).
**Status:** Design approved (brainstorm), pending implementation plan.
**Parent designs:** `2026-06-25-messaging-hub-design.md`; `2026-06-22-watchtower-ipad-remote-design.md` §3 (live plane), §9 (#72).

---

## 1. Goal

Make the cross-device messaging hub (#71) usable **away from the home LAN**, and
**remove the Slack integration** so the hub is the sole attention channel. We do
**not** use Supabase for messaging — what's in main is a Postgres endpoint for
TimeTracker sync (no Realtime/SDK/auth), and APNs already covers "notify when
away". The remaining gap — foreground ping + reply only working on the LAN
(the WS is LAN-bound) — is closed by making the orchestrator's existing WS
server reachable over **Tailscale**, reusing 100% of #71's WS push + WS reply.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| **Off-LAN transport** | **Tailscale**, not Supabase. Bind the existing WS server to the Tailscale interface; the iPad connects to the Mac's Tailscale IP. Reuses #71's WS push (ping) + WS invoke (reply). APNs unchanged (already internet-wide, still required to wake a locked/closed app). |
| **Bind detection** | Extend `resolveWsRemoteBind`'s `auto` to **prefer a Tailscale CGNAT address (`100.64.0.0/10`)** when present, else fall back to the first non-internal LAN IPv4. Never `0.0.0.0` (unchanged). |
| **iPad** | **No code change** — the user enters the Mac's Tailscale IP as `host` (works both away and at home, since Tailscale routes locally). |
| **Slack** | **Removed entirely.** The hub (`EscalationGate` + `hubSender` + APNs) is the sole attention channel. |
| **Escalation timing** | `escalateMs` + `triggers` (permission/idle/crash) **move from Slack config into `HubConfig`**; the gate reads them from hub config; `armEnabled = hubConfig.enabled`. |
| **pty injection** | Keep `deliverSlackReply` (rename → `deliverReply`); it's the `messaging:reply` injection, no Slack logic. |
| **Sequencing** | Stack on `feat/71-messaging-hub` (extend PR #103). Merge to current main is a later conflict pass (Supabase/liquid-glass). |

---

## 3. Part A — Tailscale reach

### 3.1 Bind detection (`orchestrator/remoteBind.ts`)
`resolveWsRemoteBind(env, interfaces)` with `WATCHTOWER_WS_HOST=auto` currently
returns the first non-internal IPv4 (LAN). Change `auto` to:
1. First pass: return the first non-internal IPv4 whose address is in
   `100.64.0.0/10` (Tailscale CGNAT range).
2. Else: return the first non-internal IPv4 (existing LAN behaviour).
Explicit `WATCHTOWER_WS_HOST=<ip>` and the unset→loopback paths are unchanged.
A `100.x` bind is reachable both away (over Tailscale) and at home (Tailscale
uses a direct local path), so it covers both.

### 3.2 iPad
No change. The user enters the Mac's Tailscale IP (`100.x`) in the connection
form. APNs delivery is unaffected (Apple's push network, internet-wide).

### 3.3 Runbook (deliverable)
`docs/runbooks/tailscale-reach.md`: install Tailscale on the Mac + iPad (same
tailnet); set `WATCHTOWER_WS_HOST=auto` (or the Mac's Tailscale IP) in the
dev `.env`; find the Mac's Tailscale IP (`tailscale ip -4`); enter it as the
host on the iPad. Note: this is the *reachability* slice of #72 — Wake-on-LAN
(waking a sleeping Mac) is still parked on hardware; this only reaches an
awake Mac.

### 3.4 What this does NOT change
APNs (already works away); the VNC relay (connects to `127.0.0.1:5900`
regardless of how the iPad reaches the WS server); the bearer-token auth (still
the access control; Tailscale restricts reachability to your tailnet).

---

## 4. Part B — Remove Slack

### 4.1 Delete (files)
- `orchestrator/slackListener.ts`, `orchestrator/slackReply.ts`,
  `orchestrator/escalationMessage.ts` (Slack Block Kit; no hub consumer),
  `orchestrator/services/slackClient.ts`, `orchestrator/services/slackConfig.ts`.
- `packages/shared/src/slackConfig.ts`.
- `apps/desktop/src/components/settings/SlackTab.tsx`,
  `apps/desktop/src/state/useSlackConfig.ts`.
- Tests: `tests/orchestrator/slackReply.test.ts`,
  `tests/orchestrator/services/slackConfig.test.ts`,
  `tests/shared/slackConfig.test.ts`.

### 4.2 Contract (`messagePort.ts` + `ipcContract.ts`)
Remove the three `slack:*` kinds (`slack:getConfig`, `slack:setConfig`,
`slack:test`) from `OrchRequest`/`OrchResponse` and `IpcRequest`/`IpcResponse`,
and the `SlackConfig` imports.

### 4.3 `orchestrator/index.ts`
- Remove imports: `SlackListener`, `formatEscalationMessage`, `WebApiSlackClient`/`SlackClient`, `readSlackConfig`/`writeSlackConfig`.
- Remove module state: `slackListener`, `slackThreadToInstance`, `slackInstanceToThread`, `slackDmChannel`.
- Remove functions: `postSlack`, `ackSlackReply`, `startSlackListener`, `setSlackDmChannel`, `forgetSlackThread`.
- Remove `forgetSlackThread(...)` callsites in `applyTransition` (crash/finish/clearAttention) and `disposeInstanceRow`.
- Remove the `slack:getConfig`/`slack:setConfig`/`slack:test` handler cases.
- Remove the `SlackListener` construction + `startSlackListener()` call + the two `slackListener?.stop()` shutdown hooks.
- In `onEscalate`: drop the `if (slack.enabled) void postSlack(...)` branch; keep `void hubSender.fire(...)`.
- **Rename** `deliverSlackReply` → `deliverReply` (keep the body; it's the pty injection used by `messaging:reply`). Update its references.

### 4.4 Desktop UI
Remove `'slack'` from `settingsUrl.ts` `SETTINGS_TABS`, the Slack entry in
`ModuleRail.tsx`, and the `SlackTab` import + `{view.tab === 'slack' && …}` in
`ModuleSettings.tsx`. (Leave `McpTab`/`HooksTab` Slack *template strings* — they
are MCP/hook examples, not Watchtower's integration.)

### 4.5 Dependencies
Remove `@slack/socket-mode` and `@slack/web-api` from the root `package.json`
(update `package-lock.json`).

### 4.6 Leave alone
The orphaned `slack_*` rows in the `settings` table (harmless; no code reads
them after removal). No migration to delete them.

---

## 5. Part C — Escalation timing → `HubConfig`

The one Slack↔hub entanglement: the `EscalationGate` reads `escalateMs` +
`triggers` from Slack config.

- Extend `HubConfig` (`packages/shared/src/hubConfig.ts`) with
  `escalateMs: number` and `triggers: { permission: boolean; idle: boolean; crash: boolean }`;
  extend `DEFAULT_HUB_CONFIG` (e.g. `escalateMs: 300000`, all triggers `true`)
  and `HUB_SETTING_KEYS` (`hub_escalate_ms`, `hub_triggers` — JSON).
- `readHubConfig`/`writeHubConfig` read/write the new fields (triggers as JSON).
- In `index.ts`, the gate's `getParams()` reads `escalateMs`/`triggers`/`armEnabled`
  from `readHubConfig(...)` only (no Slack).
- The desktop Messaging-hub panel gains the `escalateMs` (number) +
  three trigger toggles (Czech labels: `Prodleva (ms)`, `Spouštěče` →
  `Povolení` / `Nečinnost` / `Pád`).

---

## 6. Error handling / testing

- `resolveWsRemoteBind`: unit test — interfaces with both a `100.x` (utun) and a
  `192.168.x` (en0) address → `auto` picks `100.x`; with only LAN → picks LAN;
  explicit/unset paths unchanged.
- `hubConfig`: extend the round-trip test to cover `escalateMs` + `triggers`.
- `escalationGate`: existing tests stay green (gate is unchanged; only its param
  *source* moves). The renamed focus-flip test merges into `escalationGate.test.ts`.
- After removal: full suite green; shared + transport + orchestrator + apps/ipad
  + apps/desktop typecheck show **no new errors** (and the Slack-deleted symbols
  are fully gone — a dangling reference fails the build).
- Tailscale + APNs end-to-end remain **device-validated** (runbooks).

---

## 7. Scope

**In:** Tailscale-preferring `auto` bind + runbook; full Slack removal
(files, contract, index.ts, desktop UI, deps, tests); escalation timing moved
into `HubConfig` + desktop fields; `deliverSlackReply`→`deliverReply` rename;
fold the misnamed `slackEscalator.test.ts` into `escalationGate.test.ts`.

**Out:** Supabase for messaging; Wake-on-LAN / the hardware part of #72;
deleting orphaned `slack_*` settings rows; iPhone client (#76).

---

## 8. Next step

Hand to `writing-plans`.
