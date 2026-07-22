# Teams Calling Integration — v2 Implementation Plan (meetings popover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the v1 "embed the whole Teams app in a window" behavior with: click the corner pill → a native popover of today's meetings → Join opens only that meeting's call in a scoped window.

**Architecture:** Meetings come from a repo-scoped `/teams-refresh` chat command (uses the M365 MCP, reads each event's `onlineMeeting.joinUrl`) cached in the `settings` KV table under `teams.meetings_today`. The renderer reads that cache (`meetings:listToday`), renders a popover under the pill, and Join navigates a scoped Teams call window (reused v1 `electron/teamsWindow.ts`) directly to the meeting's join URL. Orchestrator/SQLite otherwise untouched (no migration — settings blob).

**Tech Stack:** Electron main + preload IPC, React + MUI v5 (`apps/desktop/src`), TypeScript, Vitest (node env; `.tsx` tests use a jsdom pragma). Shared contract `packages/shared/src/ipcContract.ts`.

Design spec (authoritative v2 section): `docs/superpowers/specs/2026-07-21-teams-calling-integration-design.md`.

## Global Constraints

- Renderer path `apps/desktop/src/`; shared imported as `@watchtower/shared/<mod>.js` (`.js` on TS source). Renderer IPC via `invoke` from `./ipc`; pushes via `window.watchtower.on(kind, handler)` (returns unsubscribe).
- Theme is ocean **cyan/blue — no violet**. Use `primary`/`secondary`/`text.*` + glass helpers (`glassSurface`, `glassFill`, `accentWash`, `accentActiveText`) from `apps/desktop/src/theme/glass.ts`.
- Tests live in `tests/<area>/*.test.ts(x)`; vitest `environment: 'node'` with `@watchtower/shared` aliased to source. Component/hook tests need a `// @vitest-environment jsdom` pragma (see `tests/client/SidebarUsage.test.tsx`, `tests/client/teamsPill.test.tsx`). Put non-UI logic in pure modules.
- UI text English; no i18n. Dates cs-CZ formatting.
- `settings` is the existing key-value table (TEXT values); do NOT add a migration.
- Don't bypass pre-commit hooks / signing. Keep suite green (currently 208 files / 1383 tests). If a build step churns `package-lock.json`, `git checkout -- package-lock.json` before committing.
- Verify: `npm test`, `npm run typecheck`, `npm run build:main`.
- This branch (`feat/teams-calling`) already contains v1 (PR #231). This plan MODIFIES it.

---

## File Structure

**Create:**
- `packages/shared/src/meetings.ts` — `MeetingSummary`, `MeetingsToday`, pure `parseMeetingsToday(raw)`.
- `apps/desktop/src/components/teams/MeetingsPopover.tsx` — the popover UI (mockup #4).
- `.claude/commands/teams-refresh.md` — repo-scoped chat command spec.
- `.claude/commands/write-meetings-cache.mjs` — writer script (JSON → settings blob).
- Tests: `tests/shared/meetingsParse.test.ts`, `tests/client/meetingsPopover.test.tsx`.

**Modify:**
- `packages/shared/src/ipcContract.ts` — remove `teams:open`; add `teams:joinMeeting`, `teams:focusCall`, `meetings:listToday`; adjust `ELECTRON_ONLY_KINDS`.
- `electron/teamsWindow.ts` — `createOrFocusTeamsWindow()` → `joinMeeting(joinUrl)` + `focusCall()`.
- `electron/ipc.ts` — swap the `teams:open` branch for `teams:joinMeeting` + `teams:focusCall`.
- `orchestrator/index.ts` — handle `meetings:listToday` (read + parse settings blob).
- `apps/desktop/src/state/useTeams.ts` — add `meetings`, `syncedAt`, `refresh`, `joinMeeting`, `focusCall`; keep on-call push.
- `apps/desktop/src/components/teams/TeamsPill.tsx` — click toggles the popover.
- `tests/client/teamsPill.test.tsx` — update for popover-toggle behavior.

---

### Task 1: Shared — meeting types, parse helper, IPC contract (v2)

**Files:**
- Create: `packages/shared/src/meetings.ts`
- Modify: `packages/shared/src/ipcContract.ts`
- Test: `tests/shared/meetingsParse.test.ts`

**Interfaces produced:**
- `MeetingSummary = { id: string; subject: string; subtitle: string; startsAt: string; endsAt: string; joinUrl: string | null }` (`startsAt`/`endsAt` = ISO strings).
- `MeetingsToday = { syncedAt: number; meetings: MeetingSummary[] }`.
- `parseMeetingsToday(raw: string | null): { meetings: MeetingSummary[]; syncedAt: number | null }` — tolerant parse of the settings blob; returns `{ meetings: [], syncedAt: null }` on null/invalid/malformed; drops entries missing required string fields (`id`, `subject`, `startsAt`, `endsAt`); coerces missing `subtitle`→`''` and missing/empty `joinUrl`→`null`.
- IPC: remove `teams:open`; add `teams:joinMeeting {joinUrl:string}`→`{ok:boolean}` (electron-only), `teams:focusCall {}`→`{ok:boolean}` (electron-only), `meetings:listToday {}`→`{meetings:MeetingSummary[]; syncedAt:number|null}` (orchestrator-proxied, NOT electron-only).

- [ ] **Step 1: Write the failing test** — `tests/shared/meetingsParse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMeetingsToday } from '@watchtower/shared/meetings.js';
import { ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';

describe('parseMeetingsToday', () => {
  it('returns empty + null syncedAt for null/blank/invalid', () => {
    expect(parseMeetingsToday(null)).toEqual({ meetings: [], syncedAt: null });
    expect(parseMeetingsToday('')).toEqual({ meetings: [], syncedAt: null });
    expect(parseMeetingsToday('not json')).toEqual({ meetings: [], syncedAt: null });
    expect(parseMeetingsToday('{"meetings":123}')).toEqual({ meetings: [], syncedAt: null });
  });

  it('parses a valid blob and normalizes optional fields', () => {
    const raw = JSON.stringify({
      syncedAt: 1000,
      meetings: [
        { id: 'a', subject: 'Standup', subtitle: '6 people', startsAt: '2026-07-21T10:00:00Z', endsAt: '2026-07-21T10:15:00Z', joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
        { id: 'b', subject: 'In person', startsAt: '2026-07-21T13:00:00Z', endsAt: '2026-07-21T14:00:00Z' },
      ],
    });
    expect(parseMeetingsToday(raw)).toEqual({
      syncedAt: 1000,
      meetings: [
        { id: 'a', subject: 'Standup', subtitle: '6 people', startsAt: '2026-07-21T10:00:00Z', endsAt: '2026-07-21T10:15:00Z', joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
        { id: 'b', subject: 'In person', subtitle: '', startsAt: '2026-07-21T13:00:00Z', endsAt: '2026-07-21T14:00:00Z', joinUrl: null },
      ],
    });
  });

  it('drops entries missing required fields', () => {
    const raw = JSON.stringify({ syncedAt: 5, meetings: [{ subject: 'no id', startsAt: 'x', endsAt: 'y' }] });
    expect(parseMeetingsToday(raw)).toEqual({ meetings: [], syncedAt: 5 });
  });
});

describe('teams IPC kinds (v2)', () => {
  it('registers join/focus as electron-only and drops teams:open', () => {
    expect(ELECTRON_ONLY_KINDS.has('teams:joinMeeting')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('teams:focusCall')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('teams:open' as never)).toBe(false);
    expect(ELECTRON_ONLY_KINDS.has('meetings:listToday' as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** — `npx vitest run tests/shared/meetingsParse.test.ts` (module missing; `teams:open` still present).

- [ ] **Step 3: Create `packages/shared/src/meetings.ts`:**

```ts
/** Pure helpers for the Teams meetings cache. No Electron/DOM imports. */

export interface MeetingSummary {
  id: string;
  subject: string;
  subtitle: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  joinUrl: string | null;
}

export interface MeetingsToday {
  syncedAt: number;
  meetings: MeetingSummary[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Tolerant parse of the `teams.meetings_today` settings blob. */
export function parseMeetingsToday(raw: string | null): {
  meetings: MeetingSummary[];
  syncedAt: number | null;
} {
  if (!raw) return { meetings: [], syncedAt: null };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { meetings: [], syncedAt: null };
  }
  if (typeof obj !== 'object' || obj === null) return { meetings: [], syncedAt: null };
  const rec = obj as Record<string, unknown>;
  const syncedAt = typeof rec.syncedAt === 'number' ? rec.syncedAt : null;
  const list = Array.isArray(rec.meetings) ? rec.meetings : [];
  const meetings: MeetingSummary[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    if (!isNonEmptyString(m.id) || !isNonEmptyString(m.subject) || !isNonEmptyString(m.startsAt) || !isNonEmptyString(m.endsAt)) {
      continue;
    }
    meetings.push({
      id: m.id,
      subject: m.subject,
      subtitle: typeof m.subtitle === 'string' ? m.subtitle : '',
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      joinUrl: isNonEmptyString(m.joinUrl) ? m.joinUrl : null,
    });
  }
  return { meetings, syncedAt };
}
```

- [ ] **Step 4: Edit `packages/shared/src/ipcContract.ts`:**
  - In `IpcRequest`: DELETE the `teams:open` line; add:
    ```ts
    | { kind: 'teams:joinMeeting'; payload: { joinUrl: string } }
    | { kind: 'teams:focusCall'; payload: Record<string, never> }
    | { kind: 'meetings:listToday'; payload: Record<string, never> }
    ```
  - In `IpcResponse`: DELETE the `teams:open` response; add:
    ```ts
    | { kind: 'teams:joinMeeting'; payload: { ok: boolean } }
    | { kind: 'teams:focusCall'; payload: { ok: boolean } }
    | { kind: 'meetings:listToday'; payload: { meetings: import('./meetings.js').MeetingSummary[]; syncedAt: number | null } }
    ```
  - In `ELECTRON_ONLY_KINDS`: remove `'teams:open'`; add `'teams:joinMeeting'` and `'teams:focusCall'` (do NOT add `meetings:listToday` — it proxies to the orchestrator).

- [ ] **Step 5: Run — expect PASS** — `npx vitest run tests/shared/meetingsParse.test.ts`.

- [ ] **Step 6:** `npm run typecheck` — expect it to FAIL only in the known consumers of the removed `teams:open` (`electron/ipc.ts`, `electron/teamsWindow.ts`, `apps/desktop/.../useTeams.ts`), which later tasks fix. If it fails ONLY there, that is expected; if it fails in `packages/shared`, fix here. (Do not touch the consumers in this task.)

- [ ] **Step 7: Commit** — `git add packages/shared/src/meetings.ts packages/shared/src/ipcContract.ts tests/shared/meetingsParse.test.ts` → `git commit -m "feat(teams): v2 shared meeting types, cache parse, IPC contract"` (+ Co-Authored-By trailer).

---

### Task 2: Orchestrator — `meetings:listToday` handler

**Files:** Modify `orchestrator/index.ts` (add a handler branch near the other `settings:*`/list handlers).

**Interfaces consumed:** `parseMeetingsToday` (Task 1); the existing settings read path.
**Produces:** handling for `meetings:listToday` returning `{ meetings, syncedAt }`.

- [ ] **Step 1: Find the settings read API.** Read `orchestrator/index.ts` for how a setting value is read (e.g. a `settings` repository `get(key)` or a `settings:read` handler). Identify the function that returns a setting's TEXT value by key.

- [ ] **Step 2: Add the handler.** Where request kinds are dispatched in `orchestrator/index.ts`, add a branch:

```ts
if (kind === 'meetings:listToday') {
  const raw = settingsRepo.get('teams.meetings_today'); // adapt to the real read API found in Step 1
  return parseMeetingsToday(raw ?? null);
}
```
Import `parseMeetingsToday` from `@watchtower/shared/meetings.js` at the top. Adapt `settingsRepo.get(...)` to the actual settings accessor (it may be `getSetting('teams.meetings_today')` or a repo method — use whatever the file already uses for the `timetracker_migration_status` marker).

- [ ] **Step 3:** `npm run typecheck` — the orchestrator project must be clean for this handler. (Electron/desktop may still error on removed `teams:open` until Tasks 3–4.)

- [ ] **Step 4: Commit** — `git add orchestrator/index.ts` → `git commit -m "feat(teams): orchestrator meetings:listToday reads settings cache"`.

> No unit test: this is a thin read+delegate to the Task-1 pure parser (already tested). Verified by typecheck + the Task 6 smoke.

---

### Task 3: Electron — scoped call window (join a specific URL)

**Files:** Modify `electron/teamsWindow.ts`, `electron/ipc.ts`.

**Interfaces:** replace `createOrFocusTeamsWindow()` with `joinMeeting(joinUrl: string)` and add `focusCall()`. Keep `closeTeamsWindow()`, the persistent partition, Edge UA, permission handlers, audio-state → `teamsStateChanged` (all v1, unchanged).

- [ ] **Step 1: Edit `electron/teamsWindow.ts`.** Rename/replace the exported opener. The window must load the passed `joinUrl` instead of the Teams app root; if it already exists, navigate it to the new URL and focus. Replace the `createOrFocusTeamsWindow` export with:

```ts
export function joinMeeting(joinUrl: string): void {
  if (teamsWindow && !teamsWindow.isDestroyed()) {
    if (teamsWindow.isMinimized()) teamsWindow.restore();
    void teamsWindow.loadURL(joinUrl);
    teamsWindow.focus();
    emitState();
    return;
  }
  // ...existing window-creation body (session partition, UA, permission handlers,
  //    audio-state listeners, 'closed' handler, emitState) UNCHANGED, except:
  //    load the meeting URL instead of the Teams root:
  void teamsWindow.loadURL(joinUrl);   // was: loadURL(TEAMS_URL)
  // ...
}

/** Bring an existing call window to the front (no-op if none). */
export function focusCall(): void {
  if (teamsWindow && !teamsWindow.isDestroyed()) {
    if (teamsWindow.isMinimized()) teamsWindow.restore();
    teamsWindow.focus();
  }
}
```
Remove the now-unused `TEAMS_URL` constant. Keep `EDGE_UA`, the session setup, permission handlers, audio wiring, and `closeTeamsWindow()` exactly as-is. `emitState`, `callStartedAt`, and the `teamsStateChanged` push are unchanged.

- [ ] **Step 2: Edit `electron/ipc.ts`.** Change the import to `import { joinMeeting, focusCall, closeTeamsWindow } from './teamsWindow.js';`. Replace the `teams:open` branch with:

```ts
    if (kind === 'teams:joinMeeting') {
      joinMeeting((payload as { joinUrl: string }).joinUrl);
      return { ok: true };
    }
    if (kind === 'teams:focusCall') {
      focusCall();
      return { ok: true };
    }
```
Keep the existing `teams:close` branch.

- [ ] **Step 3:** `npm run typecheck` (electron project clean now) and `npm run build:main` (compiles + regenerates preload). Both must pass.

- [ ] **Step 4: Commit** — `git add electron/teamsWindow.ts electron/ipc.ts` → `git commit -m "feat(teams): scoped call window joins a specific meeting URL"`.

> No unit test (Electron APIs can't run in node vitest); testable audio logic stays in `teamsState.ts`. Gate = typecheck + build:main + Task 6 smoke.

---

### Task 4: Renderer — meetings popover, hook, pill toggle

**Files:** Modify `apps/desktop/src/state/useTeams.ts`, `apps/desktop/src/components/teams/TeamsPill.tsx`; create `apps/desktop/src/components/teams/MeetingsPopover.tsx`; update `tests/client/teamsPill.test.tsx`; create `tests/client/meetingsPopover.test.tsx`.

**Interfaces consumed:** `MeetingSummary`, `parseMeetingsToday`-shaped payload (Task 1); `meetings:listToday`, `teams:joinMeeting`, `teams:focusCall`, `teamsStateChanged` (Tasks 1–3); `formatCallDuration` (v1); glass helpers.

- [ ] **Step 1: Rewrite `useTeams.ts`.** Keep the `teamsStateChanged` subscription (v1). Add meetings state + actions:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { TeamsPushState } from '@watchtower/shared/teamsState.js';
import type { MeetingSummary } from '@watchtower/shared/meetings.js';
import { invoke } from './ipc';

export interface TeamsHook {
  open: boolean;
  inCall: boolean;
  callStartedAt: number | null;
  meetings: MeetingSummary[];
  syncedAt: number | null;
  refreshMeetings(): Promise<void>;
  joinMeeting(joinUrl: string): void;
  focusCall(): void;
}

const INITIAL: TeamsPushState = { open: false, inCall: false, callStartedAt: null };

export function useTeams(): TeamsHook {
  const [state, setState] = useState<TeamsPushState>(INITIAL);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  useEffect(() => window.watchtower.on('teamsStateChanged', (p) => setState(p)), []);

  const refreshMeetings = useCallback(async () => {
    const res = await invoke('meetings:listToday', {});
    setMeetings(res.meetings);
    setSyncedAt(res.syncedAt);
  }, []);

  const joinMeeting = useCallback((joinUrl: string) => {
    void invoke('teams:joinMeeting', { joinUrl });
  }, []);

  const focusCall = useCallback(() => {
    void invoke('teams:focusCall', {});
  }, []);

  return { ...state, meetings, syncedAt, refreshMeetings, joinMeeting, focusCall };
}
```

- [ ] **Step 2: Create `MeetingsPopover.tsx`.** Presentational; receives meetings + state + callbacks as props (so it's testable without IPC). Renders the mockup: header, per-meeting rows (time range via cs-CZ `formatTime`-style — reuse existing time formatting from the codebase if present, else `dayjs`), a `Join` button when `joinUrl != null`, an empty/stale state, a "Refresh meetings" action that copies the `/teams-refresh` command, and a "Return to call" row when `inCall`.

```tsx
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import VideocamIcon from '@mui/icons-material/Videocam';
import dayjs from 'dayjs';
import type { MeetingSummary } from '@watchtower/shared/meetings.js';
import { glassFill, accentWash } from '../../theme/glass';

export interface MeetingsPopoverProps {
  meetings: MeetingSummary[];
  syncedAt: number | null;
  inCall: boolean;
  onJoin(joinUrl: string): void;
  onReturnToCall(): void;
  onRefresh(): void;
}

export function MeetingsPopover(props: MeetingsPopoverProps): JSX.Element {
  const theme = useTheme();
  const { meetings, syncedAt, inCall, onJoin, onReturnToCall, onRefresh } = props;
  return (
    <Box sx={{ width: 380, p: 1.5, ...glassSurfaceOrPlain(theme) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Calendar</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onRefresh}>Refresh</Button>
      </Box>

      {inCall && (
        <Box role="button" onClick={onReturnToCall}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, mb: 1, borderRadius: '10px', cursor: 'pointer', backgroundColor: accentWash(theme), color: 'secondary.main', fontWeight: 600 }}>
          ● On a call — Return to call
        </Box>
      )}

      {meetings.length === 0 ? (
        <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary', fontSize: 12.5 }}>
          No meetings cached{syncedAt == null ? '' : ` (as of ${dayjs(syncedAt).format('D. M. HH:mm')})`}.
          <br />Click Refresh, then paste the copied command into the Claude chat.
        </Box>
      ) : (
        meetings.map((m) => (
          <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: '11px', ...glassFill(theme, { elevation: 1 }), mb: 0.75 }}>
            <Box sx={{ width: 78, flexShrink: 0, fontFamily: 'monospace', fontSize: 11, color: 'secondary.main' }}>
              {dayjs(m.startsAt).format('HH:mm')}–{dayjs(m.endsAt).format('HH:mm')}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>{m.subject}</Typography>
              {m.subtitle && <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary' }}>{m.subtitle}</Typography>}
            </Box>
            {m.joinUrl && (
              <Button size="small" variant="contained" startIcon={<VideocamIcon />} onClick={() => onJoin(m.joinUrl!)}>Join</Button>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}
```
Note: replace `glassSurfaceOrPlain(theme)` with the real `glassSurface(theme, { elevation: 2 })` import (shown pseudo to flag the container should be a glass surface). Verify `dayjs` is already a dependency (it is — used app-wide) and match the app's existing time-format helper if one exists in `apps/desktop/src/util/format.ts`.

- [ ] **Step 3: Rewrite `TeamsPill.tsx`** so a click opens an MUI `Popover` anchored to the pill containing `<MeetingsPopover/>`; keep the three visual states (closed/`open`-status removed → just idle "Teams" vs on-call). On mount and on popover-open, call `refreshMeetings()`. On-call state shows the live timer (v1). Wire `MeetingsPopover` props to the hook. Keep `WebkitAppRegion: 'no-drag'`.

- [ ] **Step 4: Tests.**
  - Create `tests/client/meetingsPopover.test.tsx` (jsdom pragma): render `<MeetingsPopover/>` with (a) two meetings — one with `joinUrl`, one `null` — assert the first shows a "Join" button and clicking it calls `onJoin` with the URL, the second shows no Join; (b) empty meetings → the empty-state text renders; (c) `inCall` → the "Return to call" row renders and calls `onReturnToCall`.
  - Update `tests/client/teamsPill.test.tsx`: the pill now toggles a popover; adjust assertions (mock `useTeams`) so a click opens the popover (assert a meeting row / empty-state text appears), and the on-call pill still shows the timer text.

- [ ] **Step 5:** `npx vitest run tests/client/meetingsPopover.test.tsx tests/client/teamsPill.test.tsx` (pass), then `npm run typecheck` (all clean now) and `npm test` (full suite green).

- [ ] **Step 6: Commit** — `git add apps/desktop/src/state/useTeams.ts apps/desktop/src/components/teams/ tests/client/meetingsPopover.test.tsx tests/client/teamsPill.test.tsx` → `git commit -m "feat(teams): meetings popover under the pill + join/return actions"`.

---

### Task 5: Repo-scoped `/teams-refresh` command + cache writer

**Files:** Create `.claude/commands/teams-refresh.md`, `.claude/commands/write-meetings-cache.mjs`.

- [ ] **Step 1: Writer script `.claude/commands/write-meetings-cache.mjs`.** Reads a JSON file of `MeetingSummary[]` (or `{meetings}`), plus a DB path arg, and upserts the `teams.meetings_today` settings row via `better-sqlite3`. Mirror the connection/insert style of `~/.claude/commands/log-meetings.mjs` (read that first for the DB-open pattern and the `settings` table shape). It must set `syncedAt = Date.now()` and write `{ syncedAt, meetings }` as JSON TEXT with an upsert on the `settings` key.

- [ ] **Step 2: Command spec `.claude/commands/teams-refresh.md`.** Instruct the chat model to: (1) call `outlook_calendar_search` for today's events; (2) for each event, call `read_resource` on its URI and read `onlineMeeting.joinUrl` (null if absent); (3) build `MeetingSummary[]` with `subtitle` from attendee count / location; (4) write the JSON to a temp file and run `node .claude/commands/write-meetings-cache.mjs <tmpjson> "<db path>"`. Document the DB path (the same `WATCHTOWER_DB_PATH` the desktop uses) and that only today's events are included.

- [ ] **Step 3: Verify the writer in isolation.** Create a tiny fixture JSON with 1–2 meetings and run `node .claude/commands/write-meetings-cache.mjs <fixture> "<a throwaway sqlite path>"`; then read the `settings` row back (a one-off `node -e` or `sqlite3`) and confirm the JSON round-trips and `parseMeetingsToday` would accept it. Report the output.

- [ ] **Step 4: Commit** — `git add .claude/commands/teams-refresh.md .claude/commands/write-meetings-cache.mjs` → `git commit -m "feat(teams): repo-scoped /teams-refresh caches today's meetings"`.

> No repo unit test (chat tooling). The parser it targets is tested in Task 1; the writer is verified by the Step 3 round-trip.

---

### Task 6: Verification

- [ ] **Step 1:** `npm test` — full suite green (baseline 1383 + new meetingsParse + meetingsPopover tests; updated teamsPill test).
- [ ] **Step 2:** `npm run typecheck` — clean across all workspaces (no dangling `teams:open`).
- [ ] **Step 3: Manual smoke** (needs the dev app + a real Teams account; run `/teams-refresh` first to populate the cache): open the app → click the pill → popover shows today's meetings (or the empty/refresh state) → click Join on a meeting with a link → only that meeting's call window opens (pre-join → call) → pill shows `On a call · MM:SS` → other scenes stay usable → "Return to call" focuses the window → close the call window → pill returns to idle. Confirm a no-link meeting shows no Join button.
- [ ] **Step 4:** Commit any smoke fixes.
