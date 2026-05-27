# Direct Microsoft Graph meeting sync — design

**Status:** approved (2026-05-27)
**Replaces:** the earlier claude-subprocess + chat-prerequisite flow for the
dashboard "Sync meetings" button.

## Problem

The current Watchtower meetings-sync button cannot deliver one-click sync in
the user's environment:

1. The first attempt spawned `claude -p '/sync-meetings ...'` from the
   orchestrator. `claude -p` hangs indefinitely on the user's machine — the
   Microsoft 365 MCP server can't complete its initial handshake in a
   non-interactive subprocess, even with `--dangerously-skip-permissions`.
2. The current pivot (orchestrator reads `/tmp/timetracker-events.json`
   produced by the user's interactive `/sync-meetings` chat command) is a
   two-step flow: type the slash command in Claude Code chat, then click
   the Watchtower button. The user wants the button to be the only step.

Using an LLM as a middleman to call Microsoft Graph is overkill — the Graph
API is plain REST. We will replace the subprocess pipeline with native
OAuth + Graph calls inside the orchestrator.

## Goal

Clicking **Sync meetings** in the dashboard popover fetches Outlook events
from Microsoft Graph directly and inserts them into Watchtower's SQLite —
with no Claude CLI, no chat command, no temp files.

## Non-goals

- Multi-account / multi-mailbox support. One signed-in user per Watchtower
  install.
- Shared calendars or room mailboxes.
- Reading meeting contents beyond what the existing rules engine needs
  (`id`, `subject`, `isAllDay`, `isCancelled`, `responseStatus`, `start`,
  `end`).
- Replacing the rules engine. `meetingRules.ts` and its test corpus stay.
- Replacing the `/sync-meetings` Claude command on the TimeTracker side.
  TT continues to work for users who want to use it from chat.

## High-level architecture

```
┌─────────────────────────────┐    ┌─────────────────────────────┐
│  Settings → Microsoft 365   │    │  Sprint sync popover        │
│  • Status: Connected as X   │    │  • Date range + Sync button │
│  • Sign in / Sign out       │    │  (existing UI, hint dropped)│
└──────────────┬──────────────┘    └─────────────┬───────────────┘
               │                                  │
               │ ms365:status / startSignIn       │ meetings:sync
               │ /cancelSignIn / signOut          │
               ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│  Orchestrator                                                │
│  ┌────────────────────────┐  ┌──────────────────────────┐    │
│  │ msGraphAuth.ts         │  │ msGraphCalendar.ts       │    │
│  │ • device-code flow     │  │ • GET /me/calendarView   │    │
│  │ • token refresh        │  │ • paginates via nextLink │    │
│  │ • Keychain I/O         │  │ • normalises to RawEvent │    │
│  └───────────┬────────────┘  └────────────┬─────────────┘    │
│              │                             │                  │
│              └──────────────┬──────────────┘                  │
│                             ▼                                 │
│        ┌──────────────────────────────────┐                   │
│        │ meetingsSync.ts (refactored)     │                   │
│        │ • fetch via Graph                │                   │
│        │ • apply meetingRules (existing)  │                   │
│        │ • insert via WorklogsRepo        │                   │
│        └──────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────┘
                             │
                             ▼
            macOS Keychain (access + refresh tokens)
            Watchtower SQLite (worklogs)
```

The dashboard Sync button **assumes** the user is signed in. If not, it
returns `needsAuth: true` and the toast points the user at Settings →
Microsoft 365. All auth state changes happen in Settings; all sync happens
from the dashboard.

## Approach decisions

| Decision | Choice | Why |
|---|---|---|
| OAuth library | Hand-rolled device code (~200 LOC) | Matches Jira auth style; avoids ~5 MB `msal-node` dep for a single-user app. Device code spec is stable. |
| Tenant | `common` (multi-tenant) | Works for `@greencode.cz` and any other M365 account without re-registering. |
| Token storage | macOS Keychain via `security` CLI | Mirrors `JiraSyncService` cookie storage. |
| Config | env vars only | Matches `JIRA_BASE_URL` / `JIRA_KEYCHAIN_*` pattern. No Settings text field to maintain. |
| Auth UX placement | Separate Settings section | Sign-in is occasional; sync is frequent. Keeping them separate keeps the Sync popover focused. |

## One-time user setup (Azure portal)

1. portal.azure.com → Azure AD → **App registrations** → **New registration**.
2. Name: anything (e.g. "Watchtower personal").
3. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts** (multi-tenant).
4. Redirect URI: leave blank — device code doesn't use one.
5. **Register**. Copy the **Application (client) ID** from the Overview tab.
6. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Delegated** → search **`Calendars.Read`** → add.
7. **Authentication** → toggle **Allow public client flows** = Yes.
8. Set `MS_GRAPH_CLIENT_ID=<that-id>` in Watchtower's launch env (e.g. via
   the launchd plist that already configures `JIRA_BASE_URL`).

After step 8, sign in once from Settings; the refresh token persists across
app restarts.

## Components

### `orchestrator/services/msGraphAuth.ts` (new, ~200 LOC)

- `loadConfig()` — reads:
  - `MS_GRAPH_CLIENT_ID` (required)
  - `MS_GRAPH_TENANT_ID` (default `common`)
  - `MS_GRAPH_KEYCHAIN_SERVICE` (default `watchtower-ms-graph`)
  - `MS_GRAPH_KEYCHAIN_ACCOUNT` (default `default`)
- `loadTokens()` / `saveTokens()` — Keychain read/write via the `security`
  CLI. Stored payload: `{ accessToken, refreshToken, expiresAt, account }`
  serialised as JSON in a single keychain secret.
- `startDeviceCode()` — POST to
  `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode`
  with `client_id` + scope `offline_access Calendars.Read`. Returns
  `{ userCode, verificationUri, deviceCode, interval, expiresIn }`.
- `pollForTokens(deviceCode, interval)` — POSTs to `/token` every
  `interval` seconds with `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
  Handles error codes:
  - `authorization_pending` → keep polling
  - `slow_down` → double the interval, keep polling
  - `expired_token` → resolve with `{ status: 'expired' }`
  - `access_denied` → resolve with `{ status: 'error', error }`
  - Success → fetch `/me` for the UPN, save tokens, resolve with
    `{ status: 'success', account }`.
- `refreshTokens(refreshToken)` — POSTs with `grant_type=refresh_token`.
- `getValidAccessToken()` — returns the cached access token; refreshes
  using the refresh token if expired; throws `NotAuthenticatedError` if no
  tokens exist or refresh fails.
- `signOut()` — deletes the Keychain entry.

The active poll is held in a module-level `AbortController` so
`cancelSignIn` and `signOut` can stop it.

### `orchestrator/services/msGraphCalendar.ts` (new, ~80 LOC)

- `fetchCalendarEvents(accessToken, from, to)` — GET
  `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime={from}T00:00:00&endDateTime={to}T23:59:59.999&$select=id,subject,isAllDay,isCancelled,responseStatus,start,end&$top=50`
  with header `Prefer: outlook.timezone="Europe/Prague"`. Paginates via
  `@odata.nextLink` until empty. Caps at 500 events as a sanity guard;
  beyond that, surfaces a warning so the user knows the window was too
  wide.
- Returns `RawEvent[]` (the existing shape consumed by `meetingRules`).

### `orchestrator/services/meetingsSync.ts` (refactor)

- Drop the `/tmp/*-events.json` reader.
- Call `msGraphAuth.getValidAccessToken()`. On `NotAuthenticatedError`,
  return `{ ok: false, needsAuth: true, error: 'Sign in to Microsoft 365 in Settings first.' }`.
- Call `msGraphCalendar.fetchCalendarEvents(token, from, to)`.
- Apply `decide()` and insert via `WorklogsRepo` (unchanged from current
  implementation).
- Return the same `MeetingsSyncResult` shape, optionally with `needsAuth`.

### Settings UI

- New component: `client/src/components/settings/Microsoft365Section.tsx`.
- Mounted inside whichever settings panel currently renders the Jira /
  hooks / MCP sections (verified during implementation; not pinned here so
  the implementation can match the latest structure).
- States:
  - **Not configured** — `MS_GRAPH_CLIENT_ID` missing. Static help text
    pointing to the README's one-time setup section. No buttons.
  - **Not signed in** — Sign in button. Click → starts device flow → opens
    a popover with the user code, the `microsoft.com/devicelogin` link, a
    Copy button, and a spinner labelled "Waiting for sign-in…". Listens
    for `ms365:signInUpdate` push events to flip to success / error /
    expired.
  - **Signed in** — Shows the account UPN + token-expires-at relative time;
    Sign out button + Re-sign in button.
- New hook: `client/src/state/useMicrosoft365.ts` wraps the IPC calls and
  the push subscription.

### IPC contract additions

```ts
// shared/ipcContract.ts
| { kind: 'ms365:status'; payload: Record<string, never> }
| { kind: 'ms365:startSignIn'; payload: Record<string, never> }
| { kind: 'ms365:cancelSignIn'; payload: Record<string, never> }
| { kind: 'ms365:signOut'; payload: Record<string, never> }

// Response shapes
interface Ms365StatusPayload {
  configured: boolean;
  signedIn: boolean;
  account: string | null;
  expiresAt: number | null;
  error?: string;
}

interface Ms365StartSignInPayload {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  error?: string;
}

// Push (IpcPush)
| { kind: 'ms365:signInUpdate';
    payload: {
      status: 'pending' | 'success' | 'expired' | 'error';
      account?: string;
      error?: string;
    } }
```

`MeetingsSyncResultPayload` gains `needsAuth?: boolean`.

Both `shared/messagePort.ts` and `shared/ipcContract.ts` get mirrored
additions. `electron/ipc.ts` requires no change — the new kinds are
generic orchestrator-bound, not electron-only.

## Error & edge cases

| Condition | Behaviour |
|---|---|
| `MS_GRAPH_CLIENT_ID` not set | Settings card shows "Set `MS_GRAPH_CLIENT_ID` in your launch env" with README link. Sync errors immediately with the same message. |
| Refresh token expired / revoked | `getValidAccessToken()` throws `NotAuthenticatedError`; Sync returns `needsAuth: true`; Settings flips to "Sign in again". |
| Device-code poll: `authorization_pending` | Keep polling at current interval. |
| Device-code poll: `slow_down` | Double the interval, keep polling. |
| Device-code poll: `expired_token` | Push `signInUpdate { status: 'expired' }`; renderer closes popover with "Code expired, try again". |
| Device-code poll: `access_denied` | Push `signInUpdate { status: 'error', error }`; renderer shows the message inline. |
| Graph API 401 after refresh | Treat as auth revoked → wipe tokens, `needsAuth: true`. |
| Graph API 429 | Honour `Retry-After`, retry once. Second 429 → fail with toast. |
| Graph API network error | Surface raw error; user can retry. |
| Calendar window >500 events | Process the first 500, return summary with a `warning` field: "Window too large; showing first 500 events". |

## Testing strategy

- **`tests/orchestrator/msGraphAuth.test.ts`** — mocked `fetch`, mocked
  Keychain reader/writer. ~12 cases covering: happy device-code flow,
  `slow_down`, `authorization_pending`, `expired_token`, `access_denied`,
  silent refresh, refresh failure, missing config, sign out.
- **`tests/orchestrator/msGraphCalendar.test.ts`** — mocked `fetch` returning
  1 page, 2 pages with `@odata.nextLink`, empty page, the 500-event cap.
- **`tests/orchestrator/meetingsSync.test.ts`** — wires auth + calendar +
  rules + a real in-memory SQLite (`node:sqlite` via the existing test
  fixture) and asserts row count + summary string.
- **Existing `meetingRules.test.ts`** — untouched.

Target: ~25 new test cases; suite moves from 372 to ~395.

## File changes

**New**
- `orchestrator/services/msGraphAuth.ts`
- `orchestrator/services/msGraphCalendar.ts`
- `client/src/components/settings/Microsoft365Section.tsx`
- `client/src/state/useMicrosoft365.ts`
- `tests/orchestrator/msGraphAuth.test.ts`
- `tests/orchestrator/msGraphCalendar.test.ts`
- `tests/orchestrator/meetingsSync.test.ts`

**Modified**
- `orchestrator/services/meetingsSync.ts` — drop file reader, use Graph.
- `orchestrator/index.ts` — register `ms365:*` handlers; `meetings:sync`
  case unchanged externally.
- `shared/ipcContract.ts` + `shared/messagePort.ts` — new kinds + payloads.
- `client/src/components/settings/SettingsPanel.tsx` (or current settings
  host) — mount the new section.
- `client/src/components/dashboard/SprintStrip.tsx` — drop the "Run
  /sync-meetings in chat first" hint; the popover returns to a clean
  date-range + Sync button.

**No changes**
- `orchestrator/services/meetingRules.ts` and its test file — invariant.
- Schema / migrations — `worklogs(source, external_id)` unique index
  already gives idempotency; we keep `source='outlook'`.

## Open questions resolved during brainstorm

- **OAuth library:** hand-rolled (vs `msal-node`). Approved.
- **Auth UX placement:** separate Settings section (vs inline popover).
  Approved.
- **Tenant:** `common` multi-tenant (vs single greencode tenant). Approved.
- **Config storage:** env var only (vs Settings UI override). Approved.

## Scope estimate

~600–800 LOC of new code + ~150 LOC of modifications, plus ~25 test cases.
Roughly a half-day of careful work.
