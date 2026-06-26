# Wake-on-LAN (#72) — Design

**Date:** 2026-06-26
**Issue:** #72 [Phase B·5] Connectivity & wake — the **wake** half (Tailscale reach already shipped).
**Branch:** `feat/72-wake` (off `main` @ `0ca8d01`).
**Status:** Design approved (brainstorm), pending implementation plan.
**Master design:** `2026-06-22-watchtower-ipad-remote-design.md` §2 (wake decisions).

---

## 1. Why

A sleeping Mac is unreachable: its NIC is the only thing listening, and
Tailscale's daemon is down (so Tailscale cannot wake it). To start a session
remotely you must first wake the machine at layer 2 with a **Wake-on-LAN magic
packet**. This sub-project adds an in-app **"Probudit Mac"** (Wake my Mac)
button that fires that packet, plus the runbook for the router/macOS config.

The Tailscale/Ethernet *reachability* half of #72 already shipped (the
orchestrator WS binds to the Tailscale interface; `resolveWsRemoteBind`
auto-prefers the CGNAT address). This spec covers only the wake path.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| **Scope** | Wake both **at home (LAN)** and **away (off-LAN)**. |
| **Send mechanism** | A **custom minimal Swift Capacitor plugin** (one method), not a third-party UDP socket library. WoL is the only UDP use on the whole iPad-remote roadmap (VNC is TCP, transport is WebSocket, the data plane is HTTPS), so there is no reuse to amortize a dependency against — YAGNI favors ~50 lines we own. |
| **Addressing** | **Unicast only — never broadcast.** iOS 16+ requires the discretionary `com.apple.developer.networking.multicast` entitlement to send to broadcast addresses (255.255.255.255 / subnet-directed); unicast (LAN or WAN) needs no entitlement. Home → unicast to the Mac's LAN IP (Local Network prompt only); away → unicast to DDNS:port (unrestricted). |
| **Targets** | Fire the same packet at **every configured target** each tap (home `lanIp`, away `wanHost`). The off-network target fails harmlessly; no network detection needed. |
| **Button placement** | On the **connection form** and the **"Mac odpojen" reconnect banner** — the two moments the Mac is unreachable. |
| **Packet construction** | Built in **TypeScript** (pure, testable) and passed to native as base64; the Swift side only does the socket send. |

### Deferred (non-breaking to add later)

- LAN **broadcast** + the multicast entitlement (would make pure-LAN wake
  robust against ARP-table expiry, at the cost of Apple's approval form).
- Auto-discovery of the Mac's MAC / LAN IP (Bonjour / `NWBrowser`).

---

## 3. Components

Four small units, each independently understandable and (where logic lives)
unit-tested.

### 3.1 `apps/ipad/src/lib/wakeOnLan.ts` — pure, testable

```ts
export interface ParsedMac { bytes: number[] } // 6 octets

/** Accept "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF" (case-insensitive). */
export function parseMac(input: string): ParsedMac | null;

/** 102-byte magic packet: 6×0xFF then the 6-byte MAC repeated 16×. */
export function buildMagicPacket(mac: ParsedMac): Uint8Array;

/** Base64 of the packet, for the Capacitor bridge (binary can't cross as-is). */
export function magicPacketBase64(mac: ParsedMac): string;
```

`parseMac` returns `null` on anything not exactly 6 hex octets. No I/O.

### 3.2 Native `Wake` plugin (Swift, local Capacitor plugin)

A `CAPPlugin` subclass registered locally in the iOS app (no npm package).
Single method:

```
wake({ payloadBase64: string, host: string, port: number }): Promise<void>
```

Implementation: decode base64 → `Data`; open a POSIX `SOCK_DGRAM` socket;
`sendto(host:port)`; close. **Plain unicast — no `SO_BROADCAST`.**
Fire-and-forget: the promise resolves once the datagram is handed to the OS
(UDP has no delivery ack); rejects only on a socket/`sendto` error. The JS side
exposes it via `registerPlugin('Wake')` with a typed interface; on web it is a
no-op stub (so the desktop/browser build still compiles).

### 3.3 `apps/ipad/src/state/useWake.ts` — thin hook

```ts
type WakeStatus = 'idle' | 'sending' | 'sent' | 'error';

export function useWake(): {
  status: WakeStatus;
  wake(cfg: WakeConfig): Promise<void>; // builds packet once, sends to each target
};
```

`wake()` parses the MAC, builds the base64 packet once, then calls
`Wake.wake(...)` for each configured target (`lanIp`, `wanHost`). Per-target
errors are collected; status is `sent` if at least one send succeeded, `error`
only if all sends threw (or the MAC is invalid). No-op (stays `idle`,
button disabled) when no MAC is configured.

### 3.4 Config — extends the existing `Connection`

`apps/ipad/src/connection.ts` gains optional wake fields, persisted with the
rest of the connection via Capacitor Preferences:

```ts
interface Connection {
  host: string; port: number; token: string;   // existing
  mac?: string;        // required for wake; e.g. "AA:BB:CC:DD:EE:FF"
  lanIp?: string;      // home target, e.g. "192.168.1.50"
  wanHost?: string;    // away target, DDNS hostname or public IP
  wanPort?: number;    // away target port (default 9)
}
```

`parseConnection` validates: `mac` (if present) must `parseMac`; `wanPort`
defaults to `9`; all wake fields are optional (a user who only wants the live
plane can ignore them). The WoL port for the LAN send is also `9`.

### 3.5 UI

- **`ConnectionForm`** gains a collapsible **"Probuzení"** section with `mac`,
  `lanIp`, `wanHost`, `wanPort` inputs, and a **"⏻ Probudit Mac"** button.
- The **reconnect banner** in `InstancesModule` ("Mac odpojen – obnovuji
  připojení…") gains the same button when wake config exists.
- The button is disabled (with an inline hint) until a valid `mac` is set.
  Plain React + inline styles (no MUI), palette consistent with the form.

---

## 4. Data flow

```
HOME (on the LAN):
  tap Probudit ─▶ buildMagicPacket(mac) ─▶ Wake.wake(pkt, lanIp, 9)
    └─ first send triggers the iOS Local Network prompt
    └─ packet ─▶ Mac NIC (Wake-for-network) ─▶ Mac wakes ─▶ WS reconnects

AWAY (off the LAN):
  tap Probudit ─▶ Wake.wake(pkt, wanHost, wanPort)
    └─ packet ─▶ router (DDNS + UDP port-forward) ─▶ router broadcasts on LAN
       ─▶ Mac wakes ─▶ Tailscale daemon comes up ─▶ WS reachable

Both targets are fired each tap; the off-network one fails harmlessly. After
the packet is sent the existing reconnecting transport re-establishes the
session — wake does not itself manage the connection.
```

---

## 5. Error handling / UX

- **Invalid/empty MAC** → button disabled, inline hint ("Zadejte MAC adresu").
- **No delivery confirmation** is possible (UDP). After a tap the button shows a
  transient **"Paket odeslán"**; the normal reconnect loop takes over. The UI
  must not claim the Mac woke — only that the packet was sent.
- **Native send error** (socket/`sendto` failure on every target) → surface
  inline ("Nepodařilo se odeslat paket.").
- **`NSLocalNetworkUsageDescription`** (Czech string) is added to the iOS
  `Info.plist` so the first LAN unicast triggers the standard Local Network
  permission prompt rather than failing silently. No other entitlement.

---

## 6. Testing

- **`wakeOnLan.ts`** — unit tests (vitest, `environment: node`): `parseMac`
  accepts `:` and `-` separators and is case-insensitive; rejects wrong octet
  counts / non-hex; `buildMagicPacket` is exactly 102 bytes with the correct
  `0xFF`-prefix + 16× MAC structure; `magicPacketBase64` round-trips.
- **`parseConnection`** — tests for the new fields (mac validation, `wanPort`
  default, wake fields optional).
- **`useWake`** — thin, logic-light React → covered by typecheck + build +
  device smoke (same justification the messaging-hub spec used for its
  logic-light components).
- **Native send + actual wake** — **device/hardware-validated**, not unit-
  testable (parallels APNs Tier 2). Covered by the runbook + a manual check.

The full suite stays green; iPad typecheck clean; iPad builds.

---

## 7. Runbook

`docs/runbooks/wake-on-lan.md`:

- **macOS:** wired Ethernet via the USB-C dock; System Settings → "Wake for
  network access" on; deep sleep at home; 80 % charge cap + Optimized Battery
  Charging. How to find the Mac's **Ethernet MAC** and **LAN IP**.
- **Router (TP-Link Archer AX55 Pro):** DDNS hostname; a **UDP port-forward**
  for the WoL port that the router turns into an internal LAN broadcast (or the
  router's built-in WoL feature). The forwarded WAN port = the app's `wanPort`.
- **App:** enter MAC, LAN IP, DDNS host, port in the connection form's
  Probuzení section; accept the Local Network prompt on the first home wake.
- **Gotcha:** home **unicast** WoL relies on the router retaining the sleeping
  Mac's ARP entry; if a long-sleep home wake ever fails, use the DDNS path (or
  revisit broadcast + the multicast entitlement — see §2 Deferred).

---

## 8. Scope

**In:** `wakeOnLan.ts`, the native `Wake` plugin (+ web no-op stub), `useWake`,
the `Connection` wake fields + `parseConnection` validation, the connection-form
Probuzení section, the "Probudit Mac" button on the form and reconnect banner,
the `NSLocalNetworkUsageDescription` Info.plist key, and the runbook.

**Out:** LAN broadcast + the multicast entitlement; MAC/IP auto-discovery; any
change to the already-shipped Tailscale/WS reachability; the iPhone shell.

---

## 9. Next step

Hand to `writing-plans`.
