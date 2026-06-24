# Remote Mac module (embedded VNC) — Design

**Date:** 2026-06-25
**Issue:** #75 (Phase C·8) — Remote Mac module (embedded VNC)
**Depends on:** #73 (Capacitor iPad shell — merged), iPad Instances mirroring (#84 — merged)
**Status:** Design approved (brainstorm), pending implementation plan
**Parent design:** `docs/superpowers/specs/2026-06-22-watchtower-ipad-remote-design.md` §6

---

## 1. Goal

Add a second iPad module — **"Vzdálený Mac"** (Remote Mac) — that mirrors and
controls the Mac's screen from the iPad. It covers three real needs the
terminal stream cannot:

1. **Completing browser-SSO logins** (Jira / `saml2aws`) that open native macOS
   browser windows and are *not* in the pty stream.
2. **Glance-only viewing of IDEs with no iPad client** (Rider / WebStorm).
3. **Occasional manual on-device actions.**

Plus an **auth-block handoff**: Watchtower detects when an instance is blocked
on a browser-auth step and offers a one-tap jump into the VNC view.

---

## 2. Locked decisions

| Area | Decision | Rationale |
|---|---|---|
| **VNC client** | **noVNC in the webview** (canvas), not a native RoyalVNC plugin. | Use cases are glance + occasional input — native image/gesture quality buys little. Eliminates Swift plugin + native↔webview compositing. Provable in a **desktop browser** with zero Apple spend. Composes with the existing React shell (Rail, banner, handoff overlay). |
| **Transport** | **WS→TCP relay in the orchestrator**: new Fastify route `GET /vnc` on the existing `wsBridge.ts` server, same `?token=` auth as `/ws`, piping to `127.0.0.1:5900`. | Reuses the orchestrator's token-authed WS server. macOS Screen Sharing speaks raw RFB over TCP 5900; the browser needs WebSocket. Relay is a dumb byte pipe. |
| **Reach** | **Same-Wi-Fi LAN only.** Tailscale/WAN (#72) deferred. | No home hardware yet. When Tailscale lands, only the bind interface changes — no module change. |
| **Auth-block detection** | **Hook-primary + pty safety net.** `PreToolUse(Bash)` command match → `authBlocked`; `PostToolUse` clears. pty-output marker scan as fallback for indirect invocation / plain terminals. | Hooks reuse existing `watchtower-hook` → orchestrator plumbing and are precise. pty fallback closes the coverage gap (saml2aws called from a script, or a plain-terminal instance). |
| **VNC password** | **Stored on the iPad** (Capacitor Preferences), sent client-side by noVNC; relay stays a dumb pipe. | Simplest for v1. The bearer token is the real access control; the 8-char VNC password is secondary defence. Auth-inject relay (password stays on Mac) documented as future hardening. |
| **Code location** | **Flat `apps/ipad/src/`**, not the `packages/` workspace from parent §5. | That restructure (sub-project #3) has not happened. Follow the current layout; do not pretend the workspace exists. |
| **VNC mode** | **View + control.** | SSO logins require clicking and typing. |

---

## 3. Architecture

Two independent concerns: a **VNC relay/view** and an **auth-block detector**.

### 3.1 VNC relay (orchestrator, Mac side)

A new WebSocket route alongside the existing `/ws` IPC endpoint in
`orchestrator/wsBridge.ts`:

- `GET /vnc` (websocket), gated by the **same `?token=` preHandler** as `/ws`
  (returns 401 on token mismatch).
- On upgrade: open `net.connect(5900, '127.0.0.1')` and pipe bytes both ways —
  `socket.on('message')` → `tcp.write`, `tcp.on('data')` → `socket.send(buf,
  { binary: true })`. Close on either side propagates to the other.
- The target is a **fixed constant** (`127.0.0.1:5900`), never client-supplied
  → no SSRF. The relay is **protocol-agnostic** — it never parses RFB.
- **`maxPayload`:** the IPC route caps frames at 1 MB; VNC framebuffer updates
  can exceed that. The `/vnc` route needs a larger payload limit (register the
  websocket plugin per-route, or raise the shared limit).

```
iPad noVNC ──WS /vnc?token=…──▶ orchestrator relay ──TCP 127.0.0.1:5900──▶ macOS Screen Sharing
            (RFB VNC-password auth handled client-side by noVNC)
```

### 3.2 Auth-block detector (orchestrator)

In the per-instance state path (same class as `slackEscalator.ts` attention
logic):

- **Primary — hook:** on an incoming `PreToolUse` hook event where tool =
  `Bash` and `tool_input.command` matches `AUTH_PATTERNS`
  (`saml2aws`, `aws sso login`, `gcloud auth login`, `az login`, extensible),
  set `instance.authBlocked = true` and record the matched command / reason.
  The matching `PostToolUse` (or `Stop`, next `UserPromptSubmit`, or a timeout)
  clears it.
- **Safety net — pty:** scan the instance's pty output (already ingested by the
  orchestrator) for markers — `Opening .* browser`,
  `https?://localhost:\d+/(callback|oauth)`, `saml2aws` — with a debounce. On
  match set `authBlocked`; clear on a quiet period / next prompt. Covers
  indirect invocation (`./deploy.sh` → saml2aws) and plain-terminal instances
  where no hook fires.
- Emits a push carrying `{ instanceId, authBlocked, authBlockReason }`.

```
instance runs auth cmd → PreToolUse hook → watchtower-hook POST
  → orchestrator detector → authBlocked push → iPad banner
  → tap → Remote Mac connects → user logs in on mirrored screen
  → PostToolUse clears flag → banner dismisses
```

### 3.3 Shared contract

- Add `authBlocked?: boolean` and `authBlockReason?: string` to the instance
  state DTO and the `stateChanged` push so both clients (desktop + iPad) can
  react. v1 surfaces it on the iPad; desktop may surface later.
- The `/vnc` relay is **raw bytes — not** a tagged-union IPC kind. No new
  `IpcRequest`/`OrchRequest` kind; just a documented WS path that mirrors
  `/ws`'s auth.

### 3.4 iPad app (`apps/ipad/src/`)

- **Rail** (`components/Rail.tsx`) — add a second interactive entry "Vzdálený
  Mac"; widen `RailModule` from `'instances'` to `'instances' | 'remote'`; wire
  `onSelect` to switch modules.
- **App shell** (`App.tsx`) — lift module-selection state to `App`; render
  `InstancesModule` or `RemoteMacModule` based on the active rail entry.
- **RemoteMacModule** (new) — adds the `@novnc/novnc` dependency (vanilla JS,
  fits the no-MUI / inline-styles convention). Constructs an RFB connection to
  `ws://host:port/vnc?token=…` — reusing the existing `Connection`
  (host/port/token), parity with `connectionToWsUrl`'s `/ws` — and passes the
  VNC password as RFB credentials. Renders into noVNC's canvas. Overlay
  toolbar: disconnect, connection status, a Ctrl/Esc/Tab **modifier strip**
  (reuse the `lib/accessoryKeys.ts` concept from Instances), and a fit / 1:1
  toggle. **View + control:** touch → pointer events via noVNC; the iOS soft
  keyboard drives noVNC text input, with the modifier bar supplying keys it
  lacks.
- **VNC password capture** — extend the connection settings affordance to
  capture the Screen Sharing password; store via Capacitor `Preferences`
  alongside the connection.
- **Auth-block handoff** — `InstancesModule` subscribes to the `authBlocked`
  push. For a blocked instance, show a banner on its terminal:
  *"Mac čeká na přihlášení v prohlížeči — Otevřít obrazovku Macu"*. Tapping
  switches the active module to Remote Mac and connects. Optional attention
  badge on the instance's tab.

---

## 4. Error handling

- **VNC auth failure** (wrong VNC password) vs **connect failure** (Screen
  Sharing off / 5900 unreachable) are distinguished from noVNC's disconnect
  reason and surfaced as distinct inline Czech messages with a **manual retry**
  (VNC reconnect is heavier than the IPC socket — manual retry is acceptable
  for v1; no automatic backoff loop).
- **Relay:** if the TCP connect to `127.0.0.1:5900` fails, the relay closes the
  WS with a code/reason the client surfaces ("Sdílení obrazovky není dostupné").
- The reconnecting-banner pattern from `reconnectingTransport.ts` applies to the
  IPC connection only; the VNC connection has its own explicit lifecycle.

---

## 5. Security

- **Relay** reuses the bearer token (`?token=`) and the LAN bind from
  `remoteBind.ts`; fixed `127.0.0.1:5900` target (no client-controlled host).
- **VNC password:** macOS legacy *"VNC viewers may control screen with
  password"* (8-char limit). Stored on the iPad — secondary to the bearer
  token, which is the real access control.
- **Future hardening (documented, out of v1):** an auth-inject relay that holds
  the VNC password on the Mac and performs the RFB challenge-response itself, so
  the password never leaves the machine.
- **LAN-only:** server binds to the LAN interface; Tailscale (#72) deferred —
  when it lands, only the bind interface changes.

---

## 6. Testing

- **Relay** (Node integration, no Apple needed): bytes flow both ways through a
  fake TCP echo server; connection rejected without a valid token; close on
  either side propagates.
- **Auth-block detector** (unit): `PreToolUse(Bash)` match → `authBlocked` set;
  `PostToolUse` → cleared; pty marker → set; debounce behaviour.
- **noVNC integration:** validated in a **desktop browser** pointed at the relay
  against the real Mac Screen Sharing — *before* any iPad/Xcode build. This is
  the central payoff of the noVNC choice.
- Keep the existing suite green (current baseline); add tests for all new
  orchestrator code.

---

## 7. macOS setup runbook (documentation deliverable)

1. **System Settings → General → Sharing → Screen Sharing → ON.**
2. **Screen Sharing → (i) → Computer Settings →** enable *"VNC viewers may
   control screen with password"* and set a password (**8 characters** — macOS
   truncates longer VNC passwords).
3. Grant **Screen Recording** permission if prompted (Privacy & Security).
4. Confirm port **5900** reachable on the LAN (firewall allow).

---

## 8. Scope

**In v1:**
- View + control VNC via noVNC + orchestrator relay.
- Auth-block detection (hook-primary + pty safety net) + one-tap handoff.
- Rail second entry + App shell module switching.
- macOS setup runbook.

**Out (documented):**
- VS Code Remote Tunnel door (optional fast-follow).
- Tailscale / WAN reach (#72).
- Native RoyalVNC plugin (documented upgrade path if glance quality falls short
  — the React module boundary stays identical).
- Auth-inject relay hardening.
- Audio / clipboard sync.

---

## 9. Known constraints / risks

- **noVNC ↔ macOS Screen Sharing compatibility** (encodings + auth) is the main
  unknown. macOS only offers standard VNC password auth — which noVNC supports —
  when the legacy "VNC viewers" option is enabled (§7). Mitigated by validating
  in a desktop browser on day one.
- **VNC quality** will feel laggier/blurrier than a dedicated app; acceptable
  because IDE use is glance-only and logins are occasional.
- **Auth-block hook coverage:** `PreToolUse` only sees the command Claude ran,
  not indirect invocations or plain-terminal sessions — the pty safety net
  covers those.
- **`maxPayload`:** must be raised for the `/vnc` route or framebuffer updates
  will be dropped/closed.

---

## 10. Next step

Hand to `writing-plans` for the implementation plan.
