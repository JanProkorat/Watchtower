# Watchtower iPad Remote — System Design

**Date:** 2026-06-22
**Status:** Design approved (brainstorm), pending detailed per-sub-project specs
**Scope:** Remote access to Watchtower from an iPad, anywhere in the world.

---

## 1. Goal

Leave the Mac (MacBook Pro 2021, M1 Pro) at home, asleep. From an iPad anywhere,
wake it, drive Claude Code instances with their terminals mirrored to the iPad,
and view/edit TimeTracker data — including reading old worklogs and reports while
the Mac is offline.

The Mac stays the engine: it hosts the pty sessions, the orchestrator, and the
operational store. The iPad is a remote control surface, **not** a second host —
iOS cannot run the `claude` processes.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| **Mac connectivity** | Wired **Ethernet** via USB-C dock (Wi-Fi WoL is unreliable on Apple Silicon and unsupported by the router for WoL). Deep sleep at home; 80% battery charge cap + Optimized Battery Charging. |
| **Wake** | **Wake-on-LAN magic packet over Ethernet.** Router (TP-Link Archer AX55 Pro) configured with **DDNS + a UDP port-forward**. An **in-app "Wake my Mac" button** fires the packet via a **native UDP Capacitor plugin** to `DDNS:port`. No Raspberry Pi, no Apple TV/HomePod. |
| **Reach (live plane)** | **Tailscale** on Mac + iPad. The orchestrator hosts a **WebSocket + HTTP server** mirroring the existing tagged-union IPC contract, **bound to the Tailscale interface**, gated by a **bearer token**. |
| **Clients** | Three, sharing a common core: **desktop** (Electron, all modules), **iPad** (Capacitor — Instances + TimeTracker + Remote Mac), and a future **iPhone** (Capacitor — **TimeTracker only**, lightweight, data-plane-only). All Capacitor clients via the paid Apple Developer account ($99/yr — user is enrolling anyway). |
| **Messaging** | **In-app cross-device ping/reply hub** as the primary attention channel: orchestrator pings via **Supabase Realtime** + **APNs push**, user replies in-app, reply injected into the pty (reuses `SlackListener` behaviour). **Slack kept as an optional fallback.** |
| **Screen mirroring** | **Embedded native VNC** (RoyalVNC, MIT) against **macOS built-in Screen Sharing** (no third-party host app, no relay). Renders in-app over Tailscale to port 5900. |
| **TimeTracker data** | **Supabase Postgres** (user already runs Supabase) as the convergence hub. **Asymmetric offline:** the **Mac** is full offline read/write (its local SQLite is the working copy) and syncs to Supabase when online; the **iPad** is online-direct via `supabase-js` + RLS with a **read-only offline cache** (browse old worklogs + reports offline; add/edit require connectivity). |
| **Sync** | **Hand-rolled last-write-wins** (no new service/account). Per-row `updated_at` + `deleted_at` **tombstones**, a sync cursor, row-level replacement. Reuse `(source, external_id)` for import idempotency; log resolved conflicts. Single-user → LWW is sufficient; no CRDT/field-merge. |
| **Schema** | Refactor the TimeTracker schema **freely** during the SQLite→Postgres migration (the "don't refactor mid-dogfood" rule is lifted). Port + improve. Add sync columns (`updated_at`, `deleted_at`). |
| **v1 modules** | **Instances**, **TimeTracker** (read-mostly), **Remote Mac** (embedded VNC). Settings module excluded from v1. |

---

## 3. Architecture — two planes

The app splits cleanly into two connectivity/availability planes:

### Live plane — needs the Mac awake
**Instances** and **Remote Mac**. Inherently online: you cannot drive a Claude
session or mirror a screen that isn't running.

```
iPad ──Tailscale──▶ orchestrator WS/HTTP server (on Mac) ──▶ pty / local SQLite
```

- The orchestrator (already owns the pty sessions, the localhost hook listener,
  and the operational SQLite store) gains a **WebSocket + HTTP server** that
  speaks the **same tagged-union IPC contract** as today's MessagePort/preload
  transports. A WS connection is just another client.
- pty output is **broadcast** to all attached clients (Mac renderer via
  MessagePort, iPad via WS). Input from either drives the same session.
- **VNC** (Remote Mac module) connects natively to the Mac's port 5900 over
  Tailscale — independent of the WS server.

### Data plane — offline-first, Supabase as convergence hub
**TimeTracker**. Supabase Postgres is the hub both ends reconcile against. The
two clients have **asymmetric** offline behaviour:

```
Desktop renderer ──IPC──▶ orchestrator ──▶ local SQLite (offline working copy)
                                  │
                                  └──background LWW sync──▶ Supabase Postgres
                                                              ▲
iPad ──supabase-js (online r/w)───────────────────────────────┘
iPad ──read-only snapshot──▶ local cache (offline browse only)
```

- **Mac (desktop):** the renderer keeps its existing IPC → orchestrator →
  **local SQLite** path — so it works **fully offline, read and write**, with no
  rule violation. The orchestrator runs a **background bidirectional sync**:
  push local edits up, pull remote edits (incl. iPad's) down, when online.
- **iPad:** uses `supabase-js` **directly** when online (read/write) — a
  **deliberate, documented exception** to the "renderer only touches data
  through IPC" rule, required so TimeTracker works when the Mac is unreachable.
  Offline, it serves a **read-only snapshot cache**; no offline add/edit in v1.
- **Sync = last-write-wins** by `updated_at`, with `deleted_at` tombstones
  (propagated, hard-purged in a later sweep). Row-level replacement. Outlook
  auto-import stays idempotent via the existing `(source, external_id)` key.
  Resolved conflicts are logged.

---

## 4. The keystone — transport abstraction

The single change that makes the same React renderer run unchanged in both
Electron and the iPad browser:

- Introduce a `Transport` interface behind `window.watchtower`:
  - `invoke(kind, payload): Promise<Response>`
  - `subscribe(handler)` for pushes (`ptyData`, `stateChanged`, …)
- Two implementations:
  - **`ElectronTransport`** — today's preload bridge (unchanged behaviour).
  - **`WebSocketTransport`** — connects to the orchestrator's WS server, same
    tagged-union messages over the wire, bearer-token auth.
- At bootstrap, detect environment: `window.watchtower` present → Electron;
  otherwise → WebSocket transport pointed at the serving origin.
- **Electron-only kinds** (file picker, `openInVSCode`, `triggerNewInstance` —
  see `ELECTRON_ONLY_KINDS`) have no browser equivalent; the WS transport
  reports them unavailable and the iPad UI hides/disables the corresponding
  affordances.

This is provable in a **desktop browser** over the network — no iPad, no
Capacitor, no Apple spend — which is why it is sub-project #1.

---

## 5. Project structure — shared core for multiple clients

Three clients will share code, so restructure the single `client/` into a
workspace with a shared core and thin per-client app shells that each compose
only the modules they need. Proposed layout (npm/pnpm workspaces):

```
packages/
  shared/             # existing shared/ — ipcContract, messagePort, types
  transport/          # Transport abstraction (Electron + WebSocket impls)
  data-supabase/      # supabase-js client, TimeTracker data access + types,
                      #   LWW sync helpers, iPad read-only offline cache
  ui-core/            # theme, cs-CZ locale/format, MUI setup
  module-timetracker/ # TimeTracker UI (grids, charts, reports) — client-agnostic
  module-instances/   # Instances UI (terminals, tabs, attention badges)
  module-remote-mac/  # embedded VNC view + auth handoff
  module-messaging/   # in-app ping/reply hub UI
apps/
  desktop/            # Electron renderer shell → Instances + TT + Settings
  ipad/               # Capacitor shell        → Instances + TT + Remote Mac
  iphone/             # Capacitor shell        → TimeTracker only
electron/             # main process (role unchanged)
orchestrator/         # dual-store + LWW sync + messaging fan-out
helper/
```

Key consequence: the **iPhone app is data-plane only** — it imports
`module-timetracker` + `data-supabase` + `module-messaging` and nothing else.
No transport, no Tailscale, no wake, no VNC. That is why it can be genuinely
lightweight, and nearly free once the shared TimeTracker / Supabase / messaging
packages exist.

## 6. Module notes (v1)

- **Instances** — mirrored terminals, spawn/resume, attention badges, the Wake
  button. Open design points: the **iOS terminal-keyboard problem** (Esc, Ctrl,
  arrows, Tab — soft keyboard lacks them; needs an accessory key bar or hardware
  keyboard assumptions) and **multi-client pty sizing** (one pty, two viewports —
  pty size follows the most-recently-focused client; the other reflows).
- **TimeTracker (read-mostly)** — worklog grids + reports against Supabase;
  read-only offline cache. Edits/adds online-only in v1.
- **Remote Mac** — embedded native VNC. Doubles as: SSO-login handoff (Jira /
  `saml2aws` open **native macOS browser windows** that are *not* in the
  terminal stream — you complete them on the mirrored screen), IDE viewing
  (Rider/WebStorm have **no** iPad client — viewed through VNC), and manual
  on-device actions. Watchtower can **detect when an instance is blocked on a
  browser-auth step** and surface a one-tap jump into the VNC view. (Optional
  fast-follow: a **VS Code Remote Tunnel** door for crisp native code editing —
  VS Code only, not Rider/WebStorm.)
- **Messaging hub (cross-device ping/reply)** — primary attention channel,
  replacing the Slack DM as the main path (Slack stays an optional fallback).
  When an instance needs attention the orchestrator inserts a **ping** row in
  Supabase; **Supabase Realtime** fans it out to every signed-in device and an
  **APNs push** delivers it when the app is backgrounded/closed. The user
  replies in-app; the orchestrator (subscribed) **injects the reply into the
  pty** — what `SlackListener` does today, but device-agnostic. Rides the
  **data plane**, so it works on the lightweight iPhone with no live link.
  Reuses the attention/focus-gate logic from `SlackEscalator`. (Push needs
  device-token registration + the paid dev account; desktop keeps native macOS
  notifications.)

---

## 7. Security model

- **Live plane:** Tailscale restricts reachability to your own devices; a
  **bearer token** on the WS/HTTP server adds defence-in-depth (it spawns
  shells). Server binds to the Tailscale interface, **not** `0.0.0.0`.
- **Wake:** the only internet-exposed surface is the **UDP WoL port-forward**,
  which can do nothing but wake the machine — low risk.
- **Data plane:** Supabase **auth + Row Level Security**; single user, RLS
  scopes rows to the authenticated identity. Independent of the Tailscale token.
- **VNC:** macOS Screen Sharing VNC password, reachable only over Tailscale.

---

## 8. Known constraints / risks

- **iPad offline is read-only.** The Mac is full offline read/write (local
  SQLite + sync); the iPad serves a read-only snapshot when offline. iPad
  airplane-mode *editing* would need an add/edit outbox — explicitly **out of
  scope** for v1.
- **LWW footguns** (mitigated, not eliminated): deletes MUST be tombstones or
  deleted rows resurrect on the next pull; row-level replacement can drop an
  earlier per-field edit if the same row is edited on both ends before syncing
  (rare for one user, accepted). Relies on NTP-synced device clocks.
- **VNC quality.** Embedded VNC will feel laggier/blurrier than dedicated apps
  (Jump/Screens) for heavy use; acceptable because IDE use on iPad is
  glance-only and logins are occasional.
- **iOS terminal input** is a genuine UX problem to solve in the Instances module.
- **AnyDesk dropped** in favour of embedded VNC (no iOS deep link; embedded VNC
  is free, in-app, and uses the built-in macOS server).
- **Migration cost:** SQLite→Postgres DDL port + dialect differences (upserts,
  dates, booleans) + ETL of existing data (~3 projects / 35 epics / 781 tasks).

---

## 9. Decomposition (build order)

Grouped into phases; each sub-project gets its own spec → plan → implement cycle.

**Phase A — foundations (no Apple spend, desktop-testable):**
1. **Remote transport foundation** *(keystone)* — `Transport` abstraction +
   orchestrator WS/HTTP server + token auth + Tailscale binding. Provable in a
   desktop browser; de-risks the whole idea with zero Apple spend.
2. **TimeTracker → Supabase + offline-first sync** — schema port + refactor
   (incl. `updated_at`/`deleted_at`), dual-store orchestrator, **background LWW
   sync loop** (push/pull, tombstones, conflict logging), `supabase-js`
   client-direct access + RLS, iPad read-only offline snapshot cache, data ETL.
   Unlocks the data plane that the iPhone + messaging hub depend on.
3. **Project restructure → workspace + shared core** — extract modules, data
   layer, and transport into `packages/`; desktop becomes `apps/desktop`.
   Prerequisite for any second client.
4. **Cross-device messaging hub** — Supabase table(s) + Realtime fan-out + APNs
   push; orchestrator ping/inject; in-app reply UI. Reuses the attention gate.

**Phase B — connectivity:**
5. **Connectivity & wake** — Tailscale, Ethernet, router DDNS + UDP
   port-forward, native UDP Wake plugin + in-app button.

**Phase C — iPad client:**
6. **Capacitor iPad shell** — native wrapper, build/signing pipeline, touch/iPad
   navigation.
7. **Instances module on iPad** — multi-client terminal mirroring + iOS
   terminal-keyboard accessory bar + pty-sizing policy.
8. **Remote Mac module** — embedded RoyalVNC + macOS Screen Sharing setup +
   auth-block detection/handoff (+ VS Code tunnel later).

**Phase D — iPhone client:**
9. **iPhone shell (TimeTracker-only)** — data-plane-only Capacitor shell;
   nearly free once Phase A lands. TimeTracker + messaging hub, no live plane.

---

## 10. Next step

Detailed spec for **sub-project #1 (remote transport foundation)**, then hand to
`writing-plans` for the implementation plan.
