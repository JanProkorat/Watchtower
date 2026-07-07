# Native RoyalVNC Remote Mac (#86) — Design

**Issue:** #86 — `[Phase C·8 follow-up] Native VNC client (RoyalVNC) for smooth Remote Mac`
**Depends on:** #75 (noVNC Remote Mac, merged). De-risking spike: branch `spike/86-royalvnc` (throwaway; `SpikeVNCViewController.swift` is the working reference).
**Scope:** iPad only. No iPhone (no Remote Mac view there today).

## Problem

The Remote Mac module (#75) renders macOS Screen Sharing via **noVNC in the WebView**.
It works but interactive control is laggy: noVNC decodes the RFB framebuffer in
JavaScript and repaints a canvas on a Retina-sized framebuffer — JS decode + paint
is the bottleneck, not the LAN. This was the documented, accepted "glance-only"
tradeoff (design §8 of the noVNC spec). #86 replaces the renderer with a **native
RoyalVNC (MIT) client** that decodes on-device, for smooth low-latency control.

Design doc §8 of the noVNC spec already sanctions this as the upgrade path: *"Native
RoyalVNC plugin (documented upgrade path if glance quality falls short — the React
module boundary stays identical)."* So #86 is a contained rendering swap, not a
rearchitecture.

## Acceptance

Smooth, low-latency interactive control of the Mac screen from the iPad over the
LAN/Tailscale (typing, pointer, scroll feel native), with the existing auth-block
handoff preserved.

## Locked decisions

1. **Transport — direct TCP to `host:5900`.** RoyalVNC speaks raw RFB over TCP only
   (no WebSocket), so it cannot reuse the orchestrator's token-authed `/vnc` WS relay.
   The native client connects straight to the Mac's reachable address
   (`connection.host`, typically the Mac's Tailscale CGNAT IP) on port 5900.
   - **Auth:** Apple RFB **type-30** (macOS account short name + login password) — the
     same strong DH challenge-response the noVNC path used. Collected in the existing
     React login form, passed to the plugin.
   - **Access control:** Tailscale ACL (tailnet membership) + the macOS account
     password. The WS bearer token does **not** gate the VNC channel anymore. Accepted
     tradeoff for a single-user personal tool on a private tailnet; matches the noVNC
     spec §2 note that "when Tailscale lands, only the bind interface changes."

2. **UI — native full-screen view controller.** The plugin presents a native VC
   **modally over** the Capacitor WebView. This sidesteps transparent-webview
   compositing, native/JS frame-sync, and touch hit-testing (the two-attempt-rule
   territory). React keeps the credential login form + the auth-block handoff and drives
   the plugin. Trade-off vs. noVNC: the VNC view is always full-screen (the old
   inset-with-Rail normal mode goes away); a native back button returns to React.
   - **No on-screen modifier bar.** Keys come from the hardware keyboard and a
     summonable iOS soft keyboard.

3. **iOS-only — remove noVNC.** Native RoyalVNC on iOS; no web path. `@novnc/novnc`,
   the `/vnc` relay, and their support code are removed. Desktop-browser rendering of
   VNC is no longer possible; VNC is verified by on-device build only.

## Architecture

```
Rail "Vzdálený Mac"  ──┐
auth-block banner    ──┴─► RemoteMacView (React)
   (Instances)                │  creds present?
                              │  yes → RemoteVnc.present({host, username, password})
                              ▼
                    RemoteVncPlugin (Swift, CAPPlugin)
                              │  present() → modal VncViewController
                              ▼
                    VncViewController (VNCConnectionDelegate)
                              │  RoyalVNC direct TCP
                              ▼
                    Mac Screen Sharing  host:5900  (Apple type-30)

   events back to JS:  state(connecting|connected|disconnected), authFailed, closed
```

## Components

| Unit | File | Responsibility |
|---|---|---|
| Plugin | `apps/ipad/ios/App/App/RemoteVncPlugin.swift` | `CAPPlugin`/`CAPBridgedPlugin`, jsName `RemoteVnc`. Methods `present({host,username,password})`, `disconnect()`. Fires listener events `state`, `authFailed`, `closed`. |
| Native VC | `apps/ipad/ios/App/App/VncViewController.swift` | `VNCConnectionDelegate`: render `framebuffer.cgImage` (aspect-fit), gestures, keyboard, glass status pill, back button. Connects RoyalVNC direct TCP to `host:5900`. |
| Registration | `apps/ipad/ios/App/App/MainViewController.swift` | `bridge?.registerPluginInstance(RemoteVncPlugin())` beside `WakePlugin`. |
| SPM wiring | `apps/ipad/ios/App/App.xcodeproj/project.pbxproj`, `.../Package.resolved` | Port the spike's `RoyalVNCKit` SPM refs **+ the Embed Frameworks copy phase** (dyld-crash guard: forced-`.dynamic` product must be embedded). |
| JS wrapper | `apps/ipad/src/lib/remoteVnc.ts` | `registerPlugin<RemoteVnc>('RemoteVnc', { web: no-op })`, TS types, listener helpers. |
| React view | `apps/ipad/src/components/RemoteMacView.tsx` (rewrite) | Login form + `RemoteVnc.present` + event → status. No noVNC / screenRef / immersive plumbing. |
| Runbook | `docs/runbooks/macos-screen-sharing.md` (update) | Screen Sharing reachable on the tailnet at 5900; Apple type-30 creds. |

## Input / gesture model (native, tunable on device)

- **Tap** → left click (down+up at mapped point).
- **One-finger drag** → absolute cursor move (finger maps to framebuffer coords; button
  held during drag = drag-select). Aspect-fit letterbox is accounted for in the mapping.
- **Two-finger pan** → scroll wheel.
- **Long-press** → right click.
- **Keyboard** → hardware keys (`pressesBegan`/`pressesEnded`) and a summonable iOS soft
  keyboard (hidden first-responder text field), both mapped to `VNCKeyCode`.

Gesture tuning is expected to iterate on device (UI two-attempt rule applies).

## Error handling

| Condition | Native | React |
|---|---|---|
| Connect failure / server down | status pill "Odpojeno – zkontrolujte Sdílení obrazovky", retry/close | on `closed`, return to module |
| Type-30 auth reject | dismiss + `authFailed` event | re-open login form (clear saved password) |
| Clean disconnect / user back | `closed` event | return to previously active module |

## Removals (dead-code cleanup, enabled by iOS-only)

- `orchestrator/wsBridge.ts` `/vnc` route + `vncConnect` option.
- `orchestrator/vncRelay.ts` + `tests/orchestrator/vncRelay.test.ts` + `tests/orchestrator/wsBridge.vnc.test.ts`.
- `@novnc/novnc` dependency (`apps/ipad/package.json`), `apps/ipad/src/types/novnc.d.ts`.
- `apps/ipad/src/lib/vncKeys.ts` + `tests/ipad/vncKeys.test.ts` (native owns keys).
- `connectionToVncWsUrl` in `apps/ipad/src/connection.ts` (+ its test).

**Kept:** the auth-block detector (`orchestrator/authBlockDetector.ts`) and the
`authBlock` push — they drive the React handoff, which is unchanged.

## Testing

- vitest is TS/`node`-only — Swift is not unit-tested in this suite.
- TS tests: `remoteVnc.ts` web no-op wrapper; `connection.ts` after `connectionToVncWsUrl`
  removal; remove the relay/vnc-route tests. Keep the full suite green.
- Native: verified by iPad build + on-device smoke against the AC (smooth typing/pointer/
  scroll), per `ipad-iphone-on-device-cli-deploy` (bundle id `cz.watchtower.ipad`,
  `xcodebuild` + `devicectl`, source dev `.env`).

## Execution notes

- Work in an isolated worktree off `origin/main` (concurrent-session safety); **port**
  the spike's `project.pbxproj`/`Package.resolved`/Embed-Frameworks edits rather than
  branching off the throwaway spike. Replace `SpikeVNCViewController.swift` with the real
  `VncViewController` + plugin.
- Copy the git-ignored iPad `.env` into the worktree before any device build (empty
  `VITE_SUPABASE_ANON_KEY` → startup crash otherwise).
