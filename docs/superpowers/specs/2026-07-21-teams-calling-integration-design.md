# Teams calling integration — design

**Date:** 2026-07-21
**Status:** ⚠️ SUPERSEDED by the "v2 revision" section below. The original
approach (embed the full Teams web app in a dedicated window) shipped as PR #231,
was live-reviewed, and rejected by the user: clicking the pill opened the entire
Teams web app, which is exactly what they wanted to avoid. The v2 design replaces
it. Read the v2 section as the authoritative design; the sections after it are
kept only as pivot history.
**Prototype:** `docs/prototypes/teams-integration.html` (the calendar-list popover
mockup is now the primary UI; the embedded-window flow is obsolete).

---

## v2 revision (post-live-review) — AUTHORITATIVE

### What the user actually wants

Click the corner pill → a **compact native popover drops down below it** listing
**today's meetings** (exactly `docs/prototypes/teams-integration.html`'s calendar
list) → click **Join** on one → **only that meeting's call** opens. No Teams web
app shell, ever. No always-on background process.

### Data source (decided): reuse the existing `/sync-meetings` pipeline

A native list needs a calendar data source. The two candidates were live in-app
MS Graph (revived device-code OAuth + an Azure AD app registration) versus reusing
the repo's existing `/sync-meetings` flow. **Chosen: reuse `/sync-meetings`** — no
in-app OAuth, no Azure app registration (the user already runs `/sync-meetings`,
which fetches calendar events through Claude's Microsoft 365 MCP connector).

Accepted trade-off: the popover list is **only as fresh as the user's last
`/sync-meetings` run** — it is NOT live/auto-refreshing, because the app itself
cannot run the MCP fetch (`claude -p` hangs on MCP init inside the orchestrator
subprocess — see `TaskGridView.tsx`, which is why the current "Sync meetings"
button only copies a slash command to the clipboard).

Note: the repo's in-app MS Graph integration was built and then **reverted**
(commit `e34b4247` — "drop MS Graph approach; drive global /sync-meetings skill"),
which is why option 2 (revive Graph) was declined — it re-adopts what was dropped.

### Data pipeline (validated against the live M365 MCP)

Validation (2026-07-21): `outlook_calendar_search` lists events but truncates the
body and omits the join link; **`read_resource` on an event returns a structured
`onlineMeeting.joinUrl`** (`https://teams.microsoft.com/l/meetup-join/...`) — the
reliable source. Events with no `onlineMeeting` (in-person) have no join link.

1. **Capture join URLs via a REPO-SCOPED refresh command (no global-tooling
   edit):** add `.claude/commands/teams-refresh.md` (+ a small writer script)
   inside the Watchtower repo. It fetches today's events via the M365 MCP
   (`outlook_calendar_search`), calls `read_resource` per event to read
   `onlineMeeting.joinUrl`, and writes the cache below. This is versioned with the
   app and does NOT modify the user's global `~/.claude/commands/sync-meetings.*`
   (the billing sync stays untouched). Rationale: the app cannot run the MCP itself
   (`claude -p` hangs on MCP init in the orchestrator subprocess), so refresh is a
   chat-run command, mirroring the existing clipboard-copy "Sync meetings" button.
2. **Store:** a single row in the existing key-value `settings` table under key
   `teams.meetings_today` holding `{ syncedAt: number, meetings: MeetingSummary[] }`
   where `MeetingSummary = { id, subject, subtitle, startsAt, endsAt, joinUrl | null }`.
   Deliberately NOT a new table/migration — ephemeral cache; the `settings` KV
   store already holds similar markers (`timetracker_migration_status`).
3. **Read:** a new `meetings:listToday` IPC (renderer → main → orchestrator)
   returns `{ meetings: MeetingSummary[]; syncedAt: number | null }` (orchestrator
   reads + parses the settings blob; empty/absent → empty list, `syncedAt: null`).

### Windows & IPC (v2)

- **Pill click → popover** (renderer-only; no window, no IPC to "open").
- **`teams:joinMeeting` `{ joinUrl }`** (electron-only) → the scoped **call
  window**: reuse the existing `electron/teamsWindow.ts` window (persistent
  `persist:teams` partition so login sticks, Edge UA, `media` permission handler,
  `setDisplayMediaRequestHandler`, audio-state → `teamsStateChanged` push), but it
  now `loadURL(joinUrl)` for the specific meeting instead of the Teams app root. If
  a call window already exists, navigate/focus it to the new join URL.
- **`teams:close`** and the **`teamsStateChanged`** push are retained unchanged.
- The old **`teams:open`** kind (open the full app) is **removed**.

### Pill states (v2)

- **Idle:** `Teams` — click toggles the meetings popover.
- **On a call:** `On a call · MM:SS` (audio-state heuristic, unchanged from v1) —
  the popover header shows a **"Return to call"** row that focuses the call window.
  Clicking the pill still opens the popover.
- The v1 "open" (window-open-but-idle) state is gone — there is no persistent
  browse window now, only a transient call window.

### The meetings popover (new UI)

`MeetingsPopover` anchored below the pill (MUI `Popover`), rendering the mockup:
"Calendar" header + account line, a per-day group, and a row per meeting
(time range, title, subtitle, **Join** button). Empty state when the cache is
absent/old: "No meetings — run `/sync-meetings` to refresh," with the `syncedAt`
age shown so staleness is visible. Join → `teams:joinMeeting({ joinUrl })` +
close popover.

### What is reused vs. changed from PR #231

- **Reused as-is:** `packages/shared/src/teamsState.ts` (audio-state derivation +
  MM:SS), the `teamsStateChanged` push, the corner `TeamsPill` shell + its on-call
  state, the `electron/teamsWindow.ts` window scaffolding (partition, UA,
  permission handlers, audio wiring).
- **Changed:** `teamsWindow.ts` loads a specific join URL, not the app root;
  `teams:open` → `teams:joinMeeting { joinUrl }`; add `meetings:listToday`; the
  pill click opens a popover instead of invoking a window; new `MeetingsPopover`;
  extend `useTeams` to fetch meetings + expose `joinMeeting`.
- **New external:** the `/sync-meetings` global-tooling extension (join-URL
  capture + settings-cache write).

### v2 risks

- **Staleness:** the list reflects the last `/teams-refresh` run, not live state —
  surfaced in the popover via `syncedAt` (shown as an age; empty-state prompts a
  refresh).
- **Join-URL availability:** only meetings with `onlineMeeting.joinUrl` get a Join
  button; in-person/no-link events render without one.
- **Refresh cost:** the refresh command does one `read_resource` per event to get
  the structured join URL (search results omit it) — a handful of extra MCP calls
  per refresh, acceptable for a day's meetings.
- The v1 audio-state on-call heuristic and unsupported-client (Edge UA) risks
  carry over unchanged.

---

## Problem

The user keeps the Microsoft Teams desktop app installed *only* for calls —
1:1 VoIP, scheduled meetings, and ad-hoc group calls. They dislike the app for
everything else and want the calling capability surfaced inside Watchtower so
Teams can otherwise stay out of the way.

Explicitly **out of scope:** PSTN / phone-number calling, chat, files, and any
Teams surface other than "join/place a call."

## Approach (and rejected alternatives)

**Chosen: embed the Teams web app (PWA) in a dedicated Electron window.**

Teams calling rides on Microsoft's proprietary signaling/media stack — there is
no open protocol to tap. Two integration doors were considered and rejected:

- **Azure Communication Services (ACS) Calling SDK + Teams identity** — the only
  path to a fully native, Watchtower-styled calling UI with real programmatic
  call events. Rejected: requires an Azure subscription, an ACS resource,
  **tenant-admin consent**, and licensing that permits Teams identity. At a
  corporate tenant (Greencode/Skoda context) admin consent is a likely hard
  stop, and the build is weeks of work. Not justified for a personal-use feature.
- **Graph Cloud Communications API** — built for server/bot media (recording,
  IVR), not for a human placing a call from a desktop client. Wrong tool.

The Teams **web app** is just Chromium + WebRTC, so it runs inside Electron and
handles auth, media, and calls for free (precedent: the `teams-for-linux`
Electron wrapper). We embed it and paint minimal native Watchtower chrome on top.

### Two lifecycle constraints set by the user

1. **No incoming-call detection.** Reliably detecting an incoming Teams call
   requires scraping Teams' call-toast DOM, which is brittle and breaks on Teams
   redesigns. Dropped entirely. The user initiates calls by joining from the
   calendar; nobody-can-ring-you-into-Watchtower is an accepted limitation.
2. **No background Teams process.** The Teams window is created on demand and
   destroyed on close. Nothing Teams-related runs when the window is closed.
   Login survives via a persistent Electron session partition (cookies on disk),
   so re-opening never re-prompts login.

## User-facing design

### The dedicated Teams window

One separate `BrowserWindow` hosts the entire Teams experience — calendar, join,
and the in-call UI. Because it is its own OS window, the user can freely use any
other Watchtower scene (Instances, Billing, etc.) while a call continues; the
call is not tied to a tab or to main-window focus.

- Loads `https://teams.microsoft.com`.
- Uses a **persistent session partition** so the login sticks across
  open/close/app-restart.
- Sends a **modern Edge user-agent** string so Teams serves the full web
  experience rather than a degraded/unsupported-browser fallback.
- Meetings are joined via **Teams' own calendar and Join buttons** inside the
  window — Watchtower renders no meeting list of its own (this is why no Graph
  calendar integration / second sign-in is needed).

### The corner pill (the only always-present Watchtower surface)

A standalone pill in the **top-right corner of the title bar**, separate from the
instance tab group and not in the left module rail. It is launcher, state
indicator, and "return to call" control in one. Three states:

| State | Appearance | Click action |
|---|---|---|
| **Closed** | `● 🎥 Teams` (dimmed, no status word) | Open the Teams window |
| **Open (idle)** | `● 🎥 Teams · open` | Focus / raise the Teams window |
| **On a call** | `● 📞 On a call · MM:SS ●` (violet, pulsing dot, live timer) | Focus / raise the Teams window |

Closing the Teams window (its own red traffic-light) returns the pill to the
**Closed** state. The pill never closes the window itself — that mirrors normal
window behavior.

> **Default decision:** the Closed state is dimmed with no status word; "open"
> appears only once the window is actually open. Trivially changeable to an
> always-"Teams · open" launcher affordance if preferred later.

### On-call detection (the one soft spot)

Since DOM scraping is rejected, the pill's **On a call** state is driven by the
Electron-native **audio-state signal**: when the Teams `WebContents` becomes
audible, we treat the window as being in a call and start the timer; when it goes
silent, we revert to **open**. This is approximate — a call where everyone is
muted may read as idle, and a played notification/video could briefly read as a
call. It is chosen deliberately over DOM scraping for robustness. The timer is
therefore "time audible," a best-effort proxy for call duration.

**Accuracy upgrade (deferred, only if the heuristic proves annoying):** observe
the `WebContents` URL/route for Teams' in-call route as a second signal. This is
far more stable than incoming-call-toast scraping (it reads current state, not a
transient event) but is still Teams-DOM-coupled, so it stays out of v1.

*Needs a small spike to confirm Teams-web is reliably audible for the whole
duration of a call inside an Electron WebContents.*

## Architecture

The feature lives in **electron-main + renderer only**. It owns no persistent
data (the session cookie is the only state, persisted by Electron), so the
**orchestrator and SQLite are untouched** — no migration, no `messagePort.ts`
changes.

```
┌─ Electron main ─────────────────────────────────────┐
│ teams/teamsWindow.ts                                 │
│   · creates/destroys the dedicated BrowserWindow     │
│   · persist:"teams" session partition (login sticks) │
│   · modern Edge UA                                    │
│   · session.setPermissionRequestHandler   (mic/cam)  │
│   · session.setDisplayMediaRequestHandler (screen)   │
│   · webContents audio-state → derive on-call + timer │
│        │  IPC push: teamsStateChanged                 │
└────────┼─────────────────────────────────────────────┘
         ▼
┌─ Renderer (React/MUI) ───────────────────────────────┐
│ state/useTeams.ts     — subscribes to push, holds     │
│                          {open, inCall, callStartedAt}│
│ components/teams/TeamsPill.tsx — the corner pill;      │
│   click → invoke("teams:open")                        │
│ mounted top-right in the title-bar / tab-strip comp   │
└───────────────────────────────────────────────────────┘
```

### IPC surface (electron-only)

Added to `shared/ipcContract.ts` and registered in `ELECTRON_ONLY_KINDS`
(handled in `electron/ipc.ts`, not the orchestrator):

- `teams:open` — open the window if closed, else focus/raise it.
- `teams:close` — close/destroy the window (optional; the window's own controls
  already do this).
- **Push** `teamsStateChanged` → `{ open: boolean; inCall: boolean; callStartedAt?: number }`
  in `IpcPush`. The renderer computes the live `MM:SS` from `callStartedAt`.

### Permissions (must-not-forget)

Teams calling will silently fail without explicit grants on the Teams session:
- `setPermissionRequestHandler` — allow `media` (microphone, camera) for the
  Teams origin.
- `setDisplayMediaRequestHandler` — wire `desktopCapturer` so screen-share works.

## Components (single responsibility)

- **`electron/teams/teamsWindow.ts`** — the only owner of the Teams
  `BrowserWindow` and its session. Exposes `openOrFocus()`, `close()`, and emits
  state. Testable seams: the state-derivation from audio events is a pure
  function given `{open, audible, since}`.
- **`client/src/state/useTeams.ts`** — subscribes to `teamsStateChanged`, exposes
  `{ state, open() }` to the pill. No business logic beyond timer formatting.
- **`client/src/components/teams/TeamsPill.tsx`** — presentational pill; renders
  one of three states from `useTeams()`; calls `open()` on click.

## Error handling

- All renderer→main calls go through `invoke()` in `state/ipc.ts` — a failed
  `teams:open` already raises the global error toast; no inline `<Alert>`.
- If the Teams window fails to load (offline, Teams outage), surface via the
  window's own error page; the pill stays in its last state and a failed
  `teams:open` toasts.
- App quit closes the Teams window; closing/minimizing the main window does not
  force-close the Teams window (calls survive main-window minimize).

## Testing

- **Unit — pill state reducer:** `useTeams` state transitions and `MM:SS`
  formatting driven by mocked `teamsStateChanged` pushes
  (closed→open→oncall→open→closed).
- **Unit — on-call derivation:** the pure `{open, audible, since} → state`
  function in `teamsWindow`.
- **Unit — IPC contract shape:** `teams:open` / `teamsStateChanged` typing.
- **Manual (unavoidable):** live login persistence, joining a meeting, roaming
  scenes mid-call, screen-share, close-and-reopen without re-login.
- Keeps the suite at **219+ tests**; new code adds tests.

## Risks

1. **On-call detection is a heuristic** (audio-state). Accepted trade-off vs.
   fragile DOM scraping; URL-route refinement deferred. *Spike to confirm.*
2. **Unsupported-client territory** — embedding Teams-web outside a real browser
   is not officially sanctioned by Microsoft. Works in practice (teams-for-linux
   precedent); mitigated by a modern Edge UA. A future Teams change could break
   it; there is no contractual guarantee.
3. **Screen-share** depends on `setDisplayMediaRequestHandler` wiring — easy to
   omit, breaks share-screen silently.
4. **Electron Chromium version** must be recent enough for Teams-web calling
   (current Electron is; verify at implementation).

## Out of scope (YAGNI)

- Incoming-call banners / notifications.
- Native (ACS) calling UI, PSTN, Graph calendar list.
- Any background/always-on Teams presence.
- Multiple simultaneous Teams windows.
