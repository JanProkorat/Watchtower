# Native iPad SwiftUI Rewrite — Design

**Date:** 2026-07-15
**Status:** Approved
**Predecessor:** `2026-07-11-native-iphone-swiftui-rewrite-design.md` (shipped, Phases 1–6a)

## 1. Goal

Rewrite the Capacitor/React iPad app (`apps/ipad`) as a native Swift/SwiftUI
app using The Composable Architecture, reusing the `WatchtowerCore` SPM
package the iPhone rewrite established. Scope is **full feature parity plus
improvements**, the headline improvement being a mirror of the desktop
TimeTracker **Project page** (`ProjectDetailPane`) on the iPad.

Decisions locked during brainstorming:

- **Full parity, phased** — terminals + workspace panes, instances, remote
  Mac (VNC + WoL), billing, attention, settings; plus the Project page.
- **English UI** — matches the desktop's app-wide switch; cs-CZ stays for
  date/number/currency *formatting* (`CzFormat` already does this).
- **Project page is CRUD-only on iPad** — no Mac-side actions (no Open in
  VS Code / terminal / Instances).
- **Side-by-side transition** — the native app gets its own bundle id and
  installs alongside the Capacitor app; `apps/ipad` is deleted only after
  dogfooding confirms parity (same safety-net pattern as TimeTracker.app).
- **Approach A** — separate iPad app target + layered SPM targets (below).

## 2. Architecture & repo layout

```
apps/ipad-native/                 # NEW — XcodeGen project (like iphone-native)
  project.yml                     # target Watchtower-iPad
                                  # bundle id cz.greencode.watchtower.ipados
  Watchtower/
    WatchtowerApp.swift           # @main
    AppDelegate.swift             # APNs registration
    Info.plist, Secrets.xcconfig  # git-ignored secrets, sample template
    Views/                        # iPad-sized SwiftUI views only
    Terminal/                     # SwiftTerm UIViewRepresentable host

swift/WatchtowerCore/             # existing package — gains 2 targets
  Sources/WatchtowerCore/         # data plane, unchanged (billing, attention,
                                  # auth, cache) + NEW ProjectPageFeature
  Sources/WatchtowerBridge/       # NEW — Mac control plane
    Transport/                    # BridgeClient (WS protocol client)
    Features/                     # Connection, Instances, TerminalSession,
                                  # WorkspaceLayout, Spawn, AuthBlock
  Sources/WatchtowerRemote/       # NEW — RoyalVNCKit VNC + Wake-on-LAN
```

Linkage rules:

- The iPad app links **WatchtowerCore + WatchtowerBridge + WatchtowerRemote**.
- The iPhone app keeps linking **WatchtowerCore only** — it never pulls in
  SwiftTerm or RoyalVNCKit.
- `WatchtowerBridge` depends on `WatchtowerCore` (models, theme, formatting)
  and TCA. `WatchtowerRemote` depends on RoyalVNCKit; its reducers are TCA
  but the VNC screen itself stays a UIKit `VncViewController` (ported).

New dependencies:

| Dependency | Where | Why |
|---|---|---|
| SwiftTerm | app target only | native terminal emulator view (powers La Terminal); reducer stays UI-free in WatchtowerBridge |
| RoyalVNCKit | WatchtowerRemote | already proven in the Capacitor app's native VNC screen |

### 2.1 BridgeClient (WS transport)

A Swift port of `packages/transport/src/webSocketTransport.ts` +
`apps/ipad/src/lib/reconnectingTransport.ts`, exposed as a TCA
`@DependencyClient` backed by an actor owning a `URLSessionWebSocketTask`.

Protocol (from `packages/shared/src/wsProtocol.ts`) — JSON text frames on
`ws://host:port/ws?token=…`:

- Request: `{ id, kind, payload }` — ids `c1, c2, …`
- Response: `{ id, kind, payload?, error? }`
- Push: `{ push: true, kind, payload }`

Client surface:

- `invoke(_ request: BridgeRequest) async throws -> Response` — typed
  `Codable` request/response pairs mirroring `ipcContract.ts` for only the
  kinds the iPad uses: `listInstances`, `removeInstance`, `spawnInstance`,
  `restartInstance`, `projects:list`, `terminalAttach`, `ptyWrite`,
  `ptyResize`, `terminalFocus`, `board:sync`, `jira:syncPreview`,
  `jira:sync`, `push:registerDevice`.
- `AsyncStream` per push kind: `stateChanged`, `ptyData`
  (`{instanceId, chunk}`), `authBlock`.
- Connection status stream: `connecting | connected | disconnected`, driving
  the shell status pill. Reconnect with backoff + watchdog, mirroring the
  TS implementation's semantics (pre-open error counts as close; post-open
  spurious errors ignored; dedupe close signals).
- Outbox queue for frames sent while connecting (same as TS client).

### 2.2 Shell

Custom compact left rail (not stock `NavigationSplitView` sidebar) matching
the current app's glass look and muscle memory: Dashboard, Instances,
Remote Mac, Billing (with nested sub-sections), Settings. Connection status
pill + attention badge live on the rail.

## 3. Feature map & phases

Each phase ends dogfood-installable on the physical iPad via the
`xcodebuild` + `devicectl` flow.

| Phase | Scope | Character |
|---|---|---|
| **1. Foundation** | XcodeGen project, shell rail, theme, Connection settings editor (finally fixes #161 — editable host/port/token/mac/lanIp/wanHost/wanPort persisted natively), BridgeClient + connectivity probe, Supabase auth reuse | new Swift |
| **2. Instances + terminals** | Instances list + tab strip grouped by project (attention marks), SwiftTerm pane wired to `terminalAttach`/`ptyData`/`ptyWrite`/`ptyResize`/`terminalFocus` (attach replays scrollback `{data, cols, rows}`), spawn/restart modal, authBlock gate, remove instance | new Swift |
| **3. Workspace panes** | Tiling layout tree — pure-logic port of `workspaceLayoutModel.ts` (dense unit tests), pane picker, pane resize, keyboard accessory + pane navigation, layout persisted locally | port logic |
| **4. Remote Mac** | VNC screen + WoL — `VncViewController.swift`, `VncKeyMap`, momentum scrolling, and the WoL UDP sender port ~verbatim from `apps/ipad/ios/App/App/`; magic-packet builder becomes Swift (unit-tested); creds stored in Keychain | port verbatim |
| **5. Billing + Dashboard** | Reuse WatchtowerCore features (Dashboard, Earnings, Reports, Records, Board, Time-off, Attention-adjacent billing) with iPad-sized layouts — wider grids, split views, side-by-side panels | reuse |
| **6. Project page** | New `ProjectPageFeature` in WatchtowerCore (shared; iPhone can adopt later), mirroring desktop `ProjectDetailPane` — see §4 | new shared |
| **7. Attention + push** | Notification hub + thread drawer (reuse `AttentionFeature`), APNs registration via `push:registerDevice` over the bridge; per-device topic routing already shipped (iPhone Phase 6a) | reuse + glue |
| **8. Retire Capacitor app** | Parity checklist pass, delete `apps/ipad`, remove its CI wiring, update docs/README | cleanup |

## 4. Project page (the headline improvement)

Mirrors `apps/desktop/src/components/timetracker/ProjectDetailPane.tsx` as a
new shared `ProjectPageFeature`, CRUD-only:

- **Header card** — color accent, name, archived chip, epic-count/total-hours
  chips (h → MD past 8h), active-rate chip, pin toggle; overflow menu with
  Edit project, Archive/Unarchive, Delete project (cascade confirm). No
  Mac-shell actions.
- **Rate history** — collapsible; Add rate change → contract drawer (reuse
  `ContractDrawerFeature`, including shared multi-project contracts);
  **active-contract progress card**: MD used/limit progress bar (red ≥100%),
  MD remaining, projected total at end, expected workdays, days off booked,
  end date. Per-period rows with rate, unit hint, MD limit, hours + CZK
  earned, inline edit.
- **Epics + tasks** — collapsible epic cards (task count, minutes chip),
  add/edit/delete epic (cascade confirm); per-epic filter row (search +
  status: all/open/in_progress/to_accept/done), task grid (number, title,
  status chip, logged minutes, delete), external task links via
  `task_url_template`, client-side pagination (20/page).
- **Task detail** (sheet/drawer) — status select, editable estimate with
  over-run coloring, external Jira link; add-worklog form (date, tracked,
  reported, description); worklog table with inline edit/delete +
  "mark synced to Jira" (`jiraUploaded`) toggle; honors the worklog lock
  window (`lockedThrough`); delete task.

Data: reads the Supabase `BillingDataset` (epics, tasks, contracts, worklogs,
days-off already synced); writes through the existing mutation clients
(`BillingWriteClient` et al.), computing derived billing fields client-side
per the LWW write-guard rule.

**Read-model gap to close:** the `projects` select in
`packages/data-supabase/src/useBilling.ts` (and the Swift
`BillingFetchMapping`) must add `task_url_template`, `is_pinned`,
`archived` — plus ETL/schema backfill if any of those columns are missing
from the Supabase `projects` table. Verify at implementation time; ship as a
Phase 6 pre-task (touches TS + Swift + possibly a Supabase migration).

## 5. Data flow

Two independent data planes, same as today:

1. **Supabase (data plane)** — billing, attention, auth. Reuses
   `SupabaseClient`, `BillingClient`, `BillingCache` (Codable
   stale-while-revalidate snapshot), `AttentionClient`, `PushRegistrar`.
   Nothing changes for the iPhone.
2. **WS bridge (control plane)** — instances, terminals, spawn, board/Jira
   sync triggers. Live-only; no offline cache. Disconnect ⇒ modules that
   need the bridge show their offline state; billing keeps working.

## 6. Error handling

- **Bridge disconnect** — status pill goes `disconnected`, auto-reconnect
  with backoff; terminals freeze and re-attach (scrollback replay) on
  reconnect. Manual retry from the connection editor.
- **Bridge invoke failure** — transient toast overlay (port of `ToastStack`
  semantics; a lightweight native toast stack in the app shell).
- **Supabase failures** — existing WatchtowerCore feature patterns (inline
  error states + cached snapshot fallback), unchanged.
- **VNC auth failure / close** — same UX as the current native screen
  (auth-failed callback → credential prompt; closed → dismiss to module).

## 7. Testing & verification

- **TCA `TestStore` tests** per feature (Connection, Instances,
  TerminalSession, WorkspaceLayout, Spawn, ProjectPage, …) in
  `Tests/WatchtowerBridgeTests` / existing `WatchtowerCoreTests`.
- **Pure-logic ports get dense unit tests**: workspace layout tree, WoL
  magic packet, VNC key map, project-page derivations (progress card math,
  task filtering/pagination, estimate over-run).
- **BridgeClient** tested against a scripted fake socket (frame encode/
  decode, id matching, push routing, outbox, reconnect signaling).
- `swift test` on the package; app target builds via `xcodebuild`
  (macro-skip / host-test gotchas from the iPhone setup apply).
- **On-device verification per phase** via `devicectl` install/launch.
  Note: the installed Capacitor app's real bundle id is
  `cz.watchtower.ipad` (README says otherwise) — the new app's id
  (`cz.greencode.watchtower.ipados`) must differ from the *installed* id
  for side-by-side.

## 8. Out of scope

- Converging iPhone + iPad into a universal target (possible later; this
  design doesn't preclude it).
- Any Mac-side orchestrator changes (no new RPC kinds needed).
- Momentum-scroll follow-up #160 beyond porting current behavior.
- i18n — single-language English UI, cs-CZ formatting.
