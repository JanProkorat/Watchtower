# Off-network access to the Mac via Tailscale

**Date:** 2026-07-10
**Status:** Approved (brainstorming) → implementation
**Scope:** Let the iPad reach the Mac's WS bridge (instance control) **and** the
VNC "Vzdálený Mac" screen when the iPad is on a different Wi-Fi / cellular /
any network — not just the same LAN.

## Problem

The iPad's live connection is a single `Connection.host` used by both
`connectionToWsUrl()` (`ws://host:7445/ws`) and the native VNC plugin
(`RemoteVnc.present({ host: connection.host, ... })`). When that host is a
private LAN IP (`192.168.0.52`), the iPad can only reach the Mac on the same
Wi-Fi. There is no LAN↔WAN switching, and `wanHost`/`wanPort` today feed
**only** Wake-on-LAN (`wake.ts`), not the data connection.

Additionally, the iPad has **no in-app connection editor** (issue #161): the
host/port/token form appears only on first launch when no connection is saved.
Once saved it can't be changed from the UI — so a user cannot repoint the iPad
at a Tailscale host at all.

## Chosen approach: Tailscale mesh VPN

One stable `connection.host` = the Mac's Tailscale **MagicDNS name** (e.g.
`jans-mac.<tailnet>.ts.net`). Tailscale (WireGuard overlay) makes that name
resolve and route correctly on the same LAN (direct peer path) and off-network
(encrypted, NAT-traversed tunnel). Because both the WS bridge and VNC already
key off `connection.host`, setting it once makes **both** work everywhere with
no switching logic.

```
iPad (Tailscale on)  ──WireGuard──►  Mac (Tailscale on)
   ws://<magicdns>:7445/ws  ──►  WS bridge       (instance control)
   <magicdns>:5900          ──►  Screen Sharing  (VNC "Vzdálený Mac")
```

**Why this is mostly configuration:**
- WS bridge: `orchestrator/remoteBind.ts` already prefers the Tailscale
  (`100.64/10` CGNAT) address in pass 1, so `WATCHTOWER_WS_HOST=auto` binds the
  tailnet interface once Tailscale runs.
- VNC server: macOS Screen Sharing listens on `0.0.0.0:5900`, already reachable
  over the tailnet.
- iPad: iOS routes any TCP to the MagicDNS name through the tunnel; neither the
  WKWebView WS nor the native VNC plugin needs Tailscale-specific code.

**Security:** traffic is WireGuard-encrypted end-to-end and the bridge is
reachable **only from devices on the tailnet** — never the public internet. This
is what keeps the existing plaintext-`ws://` + static-token acceptable
off-network. We deliberately do **not** add `wss://` or new auth.

## Alternatives rejected

- **Public endpoint (DDNS + port-forward):** exposes the plaintext-token bridge
  to the internet (sniff/replay → remote pty). Would require TLS + stronger auth
  first; CGNAT ISPs break inbound. Rejected.
- **Cloud relay / tunnel (Cloudflare, ngrok):** works behind CGNAT with TLS but
  adds a third-party hop and dependency for a personal tool. Rejected in favour
  of the simpler mesh VPN the codebase already anticipates.

## Code changes

### 1. iPad connection editor (issue #161) — the main work
Add a "Připojení k Macu" section to `apps/ipad/src/components/SettingsModule.tsx`
that:
- loads the saved `Connection`,
- renders the host/port/token (+ optional mac/lanIp/wanHost/wanPort) fields,
  reusing `parseConnection` validation,
- saves via `saveConnection(store, …)`,
- triggers `reconnect()` from `useConnection()` so the new host takes effect
  without an app relaunch.

To avoid duplicating the field markup that currently lives inline in
`App.tsx`'s `ConnectionForm`, extract the form body into a reusable
`ConnectionFields` component (`apps/ipad/src/components/ConnectionFields.tsx`)
consumed by both the first-run `ConnectionForm` and the Settings editor. No data
model change — `Connection.host` already carries a LAN IP or a MagicDNS name.

### 2. Desktop — advertise the tailnet address
`orchestrator/remoteBind.ts` already binds the Tailscale IP; extend
`formatIpadConnectionInfo` (and its bootstrap caller) so the `iPad connect →`
line reports the tailnet host clearly. Optional stretch: a small read-only
"pair iPad" readout in desktop Settings. Keep to the log line for v1.

### 3. Docs
Add `docs/ipad-remote-access.md`: install Tailscale on Mac + iPad, sign into the
same tailnet, enable MagicDNS, set the iPad host to the Mac's MagicDNS name.

## Out of scope (v1 / YAGNI)
- LAN↔WAN auto-switching / endpoint racing (single MagicDNS host suffices;
  Tailscale does direct LAN when possible). A raw-LAN fallback for "Tailscale
  down" is a possible v2 (`bind 0.0.0.0` + race LAN vs tailnet host).
- `wss://` / auth changes (mitigated by tailnet-only reachability).
- VNC changes (already rides `connection.host`).
- Wake-on-LAN over WAN.

## Known limitations (accepted)
- The Mac must be **awake and online**; Tailscale can't wake a sleeping/off Mac,
  and WoL doesn't work on this M1 Pro + USB dongle (finding #105). Off-network
  access ⇒ keep the Mac on.
- The single-host model depends on Tailscale running on both ends (background
  daemon; acceptable).

## Testing
- `parseConnection` already unit-tested; add cases if the editor introduces new
  input shapes.
- New unit tests for `ConnectionFields` extraction (renders + emits parsed
  values) and the Settings editor (loads saved connection, saves, calls
  reconnect) via the existing vitest + testing-library setup.
- `remoteBind`/`formatIpadConnectionInfo` tests updated for the advertised host.
- Verify with `npm run typecheck:ci` + `npm test` (worktree: avoid false-green
  by using typecheck:ci, not a bare tsc against symlinked deps).
