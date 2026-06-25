# Cross-device messaging hub (v1: iPad) — Design

**Date:** 2026-06-25
**Issue:** #71 (Phase A·4) — Cross-device messaging hub (Realtime + APNs)
**Depends on:** #69 (data layer — but see §2: no Supabase dependency in v1)
**Status:** Design approved (brainstorm), pending implementation plan
**Parent design:** `docs/superpowers/specs/2026-06-22-watchtower-ipad-remote-design.md` §6

---

## 1. Goal

When a Claude instance needs attention **and you're away from the Mac and
haven't responded**, escalate to your **iPad** — both as an in-app ping (when
the app is open) and as an **APNs push** (when the iPad is locked/closed) — and
let you **reply from the iPad**, with the reply injected into the instance's
pty. This is the cross-device twin of the existing Slack DM escalation, landing
on your own device instead of Slack. Slack stays as an optional parallel
fallback.

v1 targets the **iPad only**. The iPhone (data-plane-only client, #76) and a
desktop in-app reply box are later.

---

## 2. Locked decisions

| Area | Decision | Rationale |
|---|---|---|
| **Fan-out transport** | **Existing orchestrator WS push** for connected devices + **APNs** for locked/closed. **No Supabase.** | The orchestrator already broadcasts every `emitPush` to all connected clients (the path #75's `authBlock` used). Supabase isn't wired (deferred to test/prod) and — crucially — Supabase Realtime cannot wake a suspended iOS app anyway; background delivery on iOS **requires APNs** regardless. So Supabase adds nothing to v1. |
| **Trigger** | **Reuse the escalation gate** (instance in attention state + Mac window unfocused + `escalateMs` timer), shared with Slack. | This is exactly "you're away and haven't responded." Already implemented in `SlackEscalator`. |
| **Gate sharing** | **Extract the shared gate** (timer + focus decision) so Slack *and* the hub consume one "escalate" decision, rather than duplicating the timer logic in a parallel escalator. | Cleaner; avoids two copies of the ~30-line gate. Touches the working `SlackEscalator` (mitigate with tests). |
| **Reply path** | iPad → WS `messaging:reply` → orchestrator injects into pty (reuse `deliverSlackReply`: `pty.write(text + '\r')` + `applyTransition(userPromptSubmit)`). | The injection mechanism already exists for Slack replies. |
| **Reply UX** | **Tap notification → open app → reply box.** Inline lock-screen reply is a fast-follow. | Reliable in Capacitor; the text-input notification action is more native plumbing than v1 needs. |
| **APNs auth** | **Token-based** (.p8 + Key ID + Team ID + bundle `cz.greencode.watchtower.ipad`), HTTP/2 to `api.push.apple.com`; sandbox vs production **configurable**. | Token auth is the modern, simpler path (no cert renewal). Env must be configurable: Xcode dev builds use the **sandbox** gateway, TestFlight/App Store use **production**. |
| **Secret storage** | APNs key material + IDs in the SQLite `settings` table, entered via a Settings panel. | Same pattern Slack tokens already use; not a file (respects the no-secret-file rule). |
| **Targets** | **iPad only** in v1. iPhone (#76) + desktop in-app reply box are later. | Desktop is where you're *away from*; it already has macOS notifications + Slack. |

---

## 3. Architecture

One trigger ("instance needs you and you're away"), two delivery paths, one
reply path.

```
attention state + window unfocused + escalateMs  ── shared gate ──▶ orchestrator hub sender
    ├─ emitPush({ kind:'attentionPing', payload }) ──WS broadcast──▶ foreground iPad: banner + reply box
    └─ APNs (HTTP/2, token auth) ──internet──▶ Apple ──▶ locked/closed iPad: banner ─tap─▶ app opens to ping
                                                                          (also fires Slack DM if Slack enabled)

reply ──WS messaging:reply { instanceId, text }──▶ orchestrator ──▶ pty.write(text + '\r') + applyTransition(userPromptSubmit)
```

### 3.1 Orchestrator

- **Shared escalation gate** — extract `SlackEscalator`'s decision (enter
  attention from non-attention + trigger enabled → arm `escalateMs` timer; fire
  on expiry only if `!windowFocused`; cancel on leaving attention; `crashed`
  fires immediately when unfocused) into a reusable unit that emits a single
  "escalate(instanceId, cwd, kind)" event. Slack and the hub are both sinks.
- **Hub sender** — on escalate: (a) `emitPush({ kind:'attentionPing', payload })`;
  (b) APNs send to every registered device token. Builds the alert text/context
  by reusing `escalationMessage.ts`.
- **`orchestrator/services/apns.ts`** — token-based APNs client: signs an ES256
  JWT from the `.p8` (Key ID + Team ID), POSTs over HTTP/2 to the
  sandbox/production host, sets `apns-topic` = bundle id. Payload: `aps.alert`
  (title = instance/project, body = prompt snippet) + custom `instanceId` +
  `pingId`. Pure JWT-signing + payload-building are unit-testable; the HTTP/2
  send is injectable for tests.
- **Device registry** — `push_devices` table: `(token PK, platform, created_at,
  last_seen_at)`. Tokens removed on APNs `410 Gone` / `BadDeviceToken`.
- **Ping log** — persist each fired ping (reuse/extend the `notifications`
  table, or a `pings` table: `id, instance_id, kind, body, created_at,
  answered_at`) so the iPad can fetch the ping on app-open-from-tap and so a
  reconnecting app can show what it missed.
- **Reply handler** — `messaging:reply { instanceId, text }` OrchRequest →
  `deliverSlackReply`-style injection; mark the ping answered; return success.
- **Device registration handler** — `push:registerDevice { token, platform }` →
  upsert into `push_devices`.
- **Config** — `HUB_SETTING_KEYS` in `shared/` (`hub_enabled`, `hub_apns_key`,
  `hub_apns_key_id`, `hub_apns_team_id`, `hub_apns_env`), `readHubConfig` /
  `writeHubConfig` in `orchestrator/services/`, exposed via `hub:getConfig` /
  `hub:setConfig`.

### 3.2 iPad app (`apps/ipad`, plain React, no MUI)

- **Push registration** — `@capacitor/push-notifications`: request permission →
  `register()` → on `registration` token → `push:registerDevice` WS invoke. Add
  the Push Notifications capability + `aps-environment` entitlement in the Xcode
  project.
- **Foreground pings** — subscribe to the `attentionPing` push (via the existing
  bridge `on('attentionPing', …)`) → show an in-app banner with the prompt + a
  reply box.
- **Background → tap** — on `pushNotificationActionPerformed`, read `instanceId`
  / `pingId` from the payload, fetch the ping (`messaging:getPing`) and open the
  reply box for it.
- **Reply box** — small component: shows the instance + prompt context, a text
  field, send → `messaging:reply` WS invoke. On success, dismiss.

### 3.3 Shared contract

- New push: `{ kind:'attentionPing'; payload:{ instanceId, pingId, kind, title, body } }`.
- New requests: `messaging:reply { instanceId, text } → { ok }`,
  `push:registerDevice { token, platform } → { ok }`,
  `messaging:getPing { pingId } → Ping | null`,
  `hub:getConfig` / `hub:setConfig`.
- Mirror into `messagePort.ts` (orchestrator handlers) and `ipcContract.ts` as
  needed; `attentionPing` added to both `OrchPush` and `IpcPush` (the wire
  contract — see #75's lesson where they diverged).

---

## 4. Known constraint (accepted)

APNs travels over the **internet** (Apple's push network), so a ping can reach
the iPad **anywhere**, even off the home Wi-Fi. **The reply, however, goes over
the WS, which is LAN-only** (Tailscale #72 is parked). So in v1 you can
**receive** a ping while away from home but can only **reply** once back on the
home network. Replying from anywhere is what #72 unlocks. v1 fully covers
away-but-on-the-same-Wi-Fi (the common case at home).

Other deferred items: inline lock-screen reply; iPhone client (#76); desktop
in-app reply box; off-LAN reply (#72); Supabase.

---

## 5. Error handling

- **APNs** `410 Gone` / `BadDeviceToken` → delete the token from `push_devices`.
  Other send failures → log; the in-app push and Slack fallback still cover the
  foreground/Slack cases.
- **No registered tokens or hub disabled** → skip APNs; fall back to Slack if
  enabled.
- **Reply to a dead/missing instance** → `messaging:reply` returns a failure the
  iPad surfaces inline ("Instance už neběží").
- **Duplicate delivery** (foreground app also gets the APNs banner): accept mild
  redundancy in v1; the foreground app may suppress the APNs banner via the
  notification delegate as a refinement.

---

## 6. Testing

- **Shared gate** — pure unit tests: arm-on-attention, fire-only-when-unfocused,
  cancel-on-leave, crash-immediate. (Protects the `SlackEscalator` extraction
  from regressions.)
- **APNs client** — unit tests for ES256 JWT signing and payload building; the
  HTTP/2 transport injected/mocked (assert host by env, `apns-topic`, payload
  shape). No live APNs in tests.
- **Reply handler** — `messaging:reply` → injection (reuse the Slack reply test
  pattern); answered-ping bookkeeping.
- **Device registry** — register upsert; prune on 410.
- **iPad UI** — logic only (vitest `environment: node`): ping store/reducer,
  reply payload builder. Native push registration + banner + tap routing
  validated on device (like #75's manual step).
- Keep the suite green; add tests for all new orchestrator code.

---

## 7. macOS / Apple setup (runbook deliverable)

- Apple Developer: create an **APNs Auth Key** (.p8) → note Key ID + Team ID.
- Xcode: enable **Push Notifications** capability; add the `aps-environment`
  entitlement (development for Xcode installs, production for TestFlight).
- Watchtower Settings: paste the `.p8`, Key ID, Team ID; pick the APNs
  environment matching the installed build.

---

## 8. Scope

**In v1:** shared escalation gate; orchestrator hub sender (WS push + APNs);
APNs token-auth client; device registration + token store; ping persistence;
`messaging:reply` → pty injection; iPad push registration + ping banner + reply
box + tap routing; hub config + Settings panel; Slack kept as parallel fallback.

**Out (later):** inline lock-screen reply; iPhone client (#76); desktop in-app
reply box; off-LAN reply (Tailscale #72); Supabase; silent/foreground APNs
suppression beyond the basic case.

---

## 9. Next step

Hand to `writing-plans` for the implementation plan.
