# iPad Capacitor Shell — Walking Skeleton — Design (#73)

**Date:** 2026-06-24
**Status:** Spec — approved; ready for plan → execute
**Parent:** Epic #77 (iPad/iPhone remote access); sub-project #6 of 9 (Phase C·6)
**Branch (to create at execution):** `feat/ipad-shell-skeleton`
**Depends on:** #68 (transport foundation, merged) · #70 (workspace restructure, merged)
**Parallel with:** #72 (connectivity & wake) · #71 (messaging hub) — independent tracks

---

## 1. Goal

Prove the iPad client stack **end-to-end** with the smallest possible app: a
Capacitor app, signed with a **free personal Apple team**, installed on a **real
iPad**, rendering a minimal React screen that connects to the Mac's orchestrator
over `WebSocketTransport` on the **same Wi-Fi LAN** and round-trips a real IPC
call. This is a **walking skeleton** — it de-risks the Apple/Capacitor/build/sign
+ transport pipeline before any real module work. It is explicitly **not** the
full iPad app.

The transport keystone (#68) already proved the renderer runs in a plain browser
over WebSocket; #73 carries that onto a real signed iPad app.

## 2. Scope — what "done" means

A personal-team-signed Capacitor app, installed on the user's real iPad, that:
1. Shows a connection screen (Mac `host:port` + bearer token), persisted on-device.
2. On connect, opens a `WebSocketTransport` to the Mac and round-trips
   `invoke('listInstances', {})`, rendering connection status + the raw instance list.
3. Subscribes to one push (`stateChanged`) and reflects that it received it.
4. Has its build/sign/run steps documented and reproducible.

Acceptance = the app runs on the real iPad, displays the live instance list, and
visibly reflects a push; desktop app unaffected; full test suite green.

## 3. Out of scope (explicit non-goals → later sub-projects)

- **Module carve** (`module-instances` / `module-timetracker` / `ui-core` /
  `data-supabase`) — deferred to #74+ when a real module needs shared components.
- **Real module UI** (Instances mirroring, TimeTracker, Remote-Mac/VNC) — #74/#75.
- **Tailscale / off-LAN / remote access** and **secure (QR/pairing) token
  delivery** — #72.
- **Wake button** — #72.
- **Paid Developer account / TestFlight / no-expiry provisioning** — later cutover.
- The iOS terminal-keyboard accessory bar and multi-client pty sizing — #74.

## 4. Architecture

### 4.1 New workspace `apps/ipad/`
`apps/*` is already a workspace (from #70). The new package:

```
apps/ipad/
  package.json          @watchtower/ipad (private)
  capacitor.config.ts   appId cz.greencode.watchtower.ipad, webDir = dist
  vite.config.ts        Vite + React; resolve.alias @watchtower/* → packages/*/src
  tsconfig.json         Bundler resolution + paths @watchtower/* → packages/*/src
  index.html
  src/
    main.tsx            React mount
    App.tsx             the proof screen (connection + status + result)
    connection.ts       parse/validate/persist the {host, port, token} config
  ios/                  Capacitor-generated native project (committed)
  README.md             build/sign/run steps
```

Dependencies (reused, no carve): `@watchtower/transport` (`WebSocketTransport`,
`selectTransport`) and `@watchtower/shared` (ipcContract types). New runtime deps:
`@capacitor/core`, `@capacitor/ios`, `@capacitor/preferences`, `react`/`react-dom`
(already in the workspace).

### 4.2 Proof screen (`App.tsx`)
A single screen with three states driven by a `Transport`:
- **Disconnected:** form for `host`, `port`, `token`; "Connect" button.
- **Connecting/Connected:** instantiate `WebSocketTransport` pointed at
  `ws://<host>:<port>` with the bearer token; call `invoke('listInstances', {})`;
  render the connection status + the returned `InstanceView[]` as a raw list.
- **Push proof:** `transport.subscribe(...)` (or the existing push API) for
  `stateChanged`; show a counter/timestamp of the last push received.
- **Error:** surfaced inline (bad host, auth failure, connection refused).

The screen depends only on the `Transport` interface — so it is unit-testable
against a fake transport and carries no Capacitor/native coupling in its logic.

### 4.3 Connection config (`connection.ts`)
Pure module: parse + validate a `{host, port, token}` object (non-empty host,
port 1–65535, non-empty token), and load/save it via `@capacitor/preferences`
(with a thin storage interface so tests inject a fake store). Returns typed
results; no UI.

## 5. Orchestrator change (the only desktop-side edit)

The WS bridge already accepts a `wsHost` parameter (default `127.0.0.1`; found at
`orchestrator/index.ts` bootstrap call). Add an **opt-in** bind host so the iPad
can reach the Mac on the LAN:

- Read `WATCHTOWER_WS_HOST` at bootstrap; when set, pass it as `wsHost` so the WS
  bridge binds to the Mac's **specific LAN IP** (never `0.0.0.0`). Unset →
  unchanged `127.0.0.1` behaviour (zero impact on existing desktop runs).
- The listener is protected by the **existing bearer-token auth** (#68).
- Surface the active **bearer token + host:port** in desktop **Settings** (read
  from the existing token source / listener sidecar) so the user can type them
  into the iPad connection screen. Read-only display; no new write paths.

Secure/QR token delivery and Tailscale-interface binding are #72's job; this is
the minimal LAN-reachability needed for the skeleton, gated behind an env var so
it is off by default.

## 6. Build / sign / run pipeline (the core de-risk)

Documented in `apps/ipad/README.md`, with npm scripts:
- `build:ipad` — `vite build` (→ `apps/ipad/dist`).
- `cap:sync` — `npx cap sync ios`.
- Manual: open `apps/ipad/ios` in Xcode → select the free **personal team** →
  set a unique bundle id (`cz.greencode.watchtower.ipad`) → run on the connected
  iPad.

Constraints: min target ~iPadOS 16; free-personal-team certs expire after **7
days** (must re-run from Xcode weekly) — acceptable for a self-run skeleton, noted
in the README. Cutover to the paid account/TestFlight is a later step.

## 7. Testing

Skeleton-appropriate, real-behaviour tests (added to the existing vitest suite,
which must stay green):
- `connection.ts`: parse/validate (valid, empty host, out-of-range port, empty
  token) and persist/load round-trip against a **fake storage** implementing the
  same interface.
- `App.tsx` proof-screen logic: driven by a **fake `Transport`** (real interface,
  fake impl) — asserts it calls `invoke('listInstances')`, renders the
  loading→connected→list transition, surfaces an error when invoke rejects, and
  reflects a received push. No mocking of the component under test.

Not unit-tested (verified manually, = acceptance §2): Capacitor build, code
signing, device install, and the live LAN round-trip. `WebSocketTransport` itself
is already covered by #68's tests.

## 8. Risks

- **Capacitor webview ↔ WebSocket over LAN:** an iOS webview connecting to a
  plaintext `ws://` LAN address may hit App Transport Security (ATS) restrictions.
  Mitigation: configure ATS exception for the LAN host (or `ws` scheme) in the
  iOS project; documented in the README. This is a known, bounded Capacitor config.
- **Free-team 7-day expiry:** the app stops launching after a week until re-signed
  — expected; noted in README; not a blocker for a skeleton.
- **LAN exposure of the WS listener:** mitigated by bearer-token auth + binding to
  a specific LAN IP (not `0.0.0.0`) + the env-var opt-in (off by default).

## 9. Interfaces this establishes for later sub-projects

- `apps/ipad` exists as the Capacitor shell that #74 (Instances mirroring) and #75
  (Remote-Mac/VNC) build their UI into.
- The connection-config + token-entry pattern is the seam #72 later replaces with
  Tailscale + secure token delivery + the Wake button.
