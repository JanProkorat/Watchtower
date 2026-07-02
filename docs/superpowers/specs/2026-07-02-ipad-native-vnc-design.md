# Design — #86 Native VNC client (RoyalVNC) for Remote Mac on iPad

Epic #77. Follow-up to #75 (Remote Mac module), which shipped with a **noVNC**
(web/WebGL) client embedded in the Capacitor WebView. noVNC in a WKWebView is
CPU-heavy and janky (software framebuffer decode + canvas blits on the JS
thread). This replaces it with a **native** VNC client (RoyalVNC, Swift) exposed
through a Capacitor plugin, for smooth full-screen remote control — especially
on the iPad-on-external-monitor primary surface.

> **Status: DRAFT — needs one decision from the maintainer before build (see
> §Decisions → Transport). Native build + on-device VNC test are required to
> verify; this spec is authored while away, so it lands as the plan of record.**

## Current state (from code exploration)

- **Client:** `apps/ipad/src/components/RemoteMacView.tsx` uses `@novnc/novnc`
  `RFB` directly (`RemoteMacView.tsx:51-57`). `rfb.scaleViewport = true`.
- **Endpoint:** `connectionToVncWsUrl(connection)` → `ws://${host}:${port}/vnc`
  (`connection.ts:55-57`) — same host/port as the data channel, path `/vnc`.
- **Transport:** the orchestrator has a **built-in WS→TCP bridge** (no external
  websockify): `orchestrator/wsBridge.ts:80-92` exposes a `/vnc` WebSocket route
  that `net.connect(5900, '127.0.0.1')` and byte-relays via
  `orchestrator/vncRelay.ts` (`setNoDelay(true)`). The Mac's Screen Sharing
  daemon listens on **`127.0.0.1:5900` only** — the orchestrator is the sole
  reachable path to it.
- **Auth (two layers):** (a) the shared WS **bearer token** as `?token=` (same
  token as `/ws`, checked in the `/vnc` preHandler, `wsBridge.ts:83-87`);
  (b) **RFB security type 30 (Apple Diffie-Hellman)** using the macOS account
  short name + login password, stored in Capacitor Preferences under
  `watchtower.vnc.creds` (separate from the connection token).
- **Capacitor:** v6, standard iOS app (`apps/ipad/ios/App`, CocoaPods
  `Podfile`, `App.xcworkspace`), iOS 13 target. One existing custom Swift
  plugin: `WakePlugin.swift`.
- **⚠️ Plugin-registration gotcha (must not repeat):** `WakePlugin` is a valid
  `CAPBridgedPlugin` but is **not registered** — absent from
  `capacitor.config.json` `packageClassList`, not in `project.pbxproj`, and no
  `.m` `CAP_PLUGIN` macro. In Capacitor 6 that means `registerPlugin('Wake')`
  falls through to the web no-op. **A native VNC plugin must get registration
  right** (and this bug should be fixed under #105).

## Decisions

### Transport — the one open decision (needs maintainer input)

RoyalVNC speaks **raw TCP RFB**, not WebSocket. Two ways to feed it:

- **Option A — keep the WS bridge.** Reuse `/vnc?token=…`. RoyalVNC has no WS
  transport, so we'd wrap its socket in an on-device WS→TCP shim (or fork its
  transport). Keeps the bearer-token auth layer. **Cost:** awkward native WS
  plumbing; fighting the library.
- **Option B — direct TCP over Tailscale (recommended).** RoyalVNC connects
  TCP directly to a VNC endpoint on the tailnet. Since Screen Sharing is
  `127.0.0.1:5900`-only, add a **plain-TCP passthrough listener** in the
  orchestrator (a raw-TCP sibling of the existing `/vnc` relay) bound to the
  LAN/Tailscale host, relaying to `127.0.0.1:5900`. **Access control** becomes
  Tailscale ACLs (only tailnet devices reach the port) + the RFB Apple-DH
  password — the bearer token is dropped for this channel. **Cost:** a small
  orchestrator TCP listener; access control shifts to the network layer.

**Recommendation: Option B.** It's the natural fit for a native client, avoids
fighting RoyalVNC's transport, and the reachability is already gated by
Tailscale (the epic's access model). The maintainer should confirm they're
comfortable with Tailscale-ACL + VNC-password as the access control for the
raw-TCP VNC port (no bearer token on that channel).

### Native view presentation

Present RoyalVNC's view as a **full-screen native `UIViewController` overlaid
over the WKWebView** (not embedded into the web layer). This matches the
existing "immersive" toggle in `RemoteMacView` and sidesteps compositing a
native UIView inside the webview. JS calls `Vnc.connect(...)` → the plugin
presents the VC; `Vnc.disconnect()` / a native close control dismisses it and
notifies JS.

## Architecture

1. **Orchestrator (Option B only):** a raw-TCP passthrough listener bound to the
   WS host (when `WATCHTOWER_WS_HOST=auto`), relaying to `127.0.0.1:5900` —
   reuse `vncRelay.ts`'s byte pipe. Gated behind Tailscale reachability. New
   config for the port (or reuse a derived port). Unit-test the relay wiring.
2. **RoyalVNC dependency:** add via Swift Package Manager (Capacitor 6 iOS
   supports SPM) or CocoaPods if a pod exists. Pin a version.
3. **`VncPlugin.swift` (jsName `Vnc`)** — `CAPBridgedPlugin`, methods:
   - `connect({ host, port, username, password })` → open the RoyalVNC session,
     present the full-screen VC, resolve on connected / reject on auth or
     network failure.
   - `disconnect()` → tear down + dismiss.
   - Emits events (connected / disconnected / error) back to JS via
     `notifyListeners`.
   **Registration:** add a `.m` `CAP_PLUGIN(VncPlugin, "Vnc", …)` macro **and**
   ensure the Swift file is in the App target + `packageClassList` — verify the
   plugin actually loads on device (the WakePlugin gotcha).
4. **JS side:** `vncPlugin.ts` (`registerPlugin<VncPlugin>('Vnc', …)`, web
   no-op), and a `RemoteMacView` path that calls the native plugin instead of
   noVNC. Keep noVNC behind a fallback flag for one release (native is unproven
   on-device).
5. **Params:** host/port from the `Connection` model (+ the new TCP port for
   Option B); credentials from `watchtower.vnc.creds` (Preferences). Reuse the
   existing creds-entry UI.

## Scope / build order (for the plan)

1. (Option B) Orchestrator raw-TCP VNC passthrough + tests.
2. RoyalVNC SPM/Pod dependency; confirm Apple-DH (type 30) auth support.
3. `VncPlugin.swift` + **correct registration** (`.m` macro + target +
   packageClassList) + `vncPlugin.ts`.
4. Native full-screen VC overlay presenting the RoyalVNC view; wire
   connect/disconnect/status events.
5. `RemoteMacView` switch to the native plugin, noVNC kept behind a fallback
   flag; migrate the creds/status UI.
6. On-device verification (VNC into an awake, reachable Mac).

## Testing

- **Unit (verifiable without a device):** the orchestrator TCP relay wiring;
  connection-param derivation (host/port/creds).
- **On-device (maintainer):** connect/scale/latency/keyboard+trackpad,
  auth-failure handling, disconnect/reconnect, plugin actually loads (not the
  web no-op), fallback flag.

## Risks / constraints

- **RoyalVNC Apple-DH (type 30) support** — the Mac uses Apple auth; verify
  RoyalVNC handles it (it advertises Apple auth support — confirm at build).
- **Plugin registration** — the exact failure mode seen on `WakePlugin`; get it
  right + verify on device.
- **Native overlay lifecycle** — presenting/dismissing a VC over the Capacitor
  webview, rotation, immersive-mode interplay.
- **Option B access control** — raw-TCP port relies on Tailscale ACLs; confirm
  acceptable.
- **Verification is native + device + reachable-Mac** — cannot be validated CI-
  or desktop-side; keep noVNC as a fallback until the native path is proven.

## Out of scope

- Wake-on-LAN fixes (#105) — separate, though this spec depends on the same
  plugin-registration fix being done there.
- Any change to the `/ws` data channel or the noVNC path beyond adding the
  fallback flag.
