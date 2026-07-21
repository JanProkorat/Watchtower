# Teams Calling Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Microsoft Teams calls (1:1, group, scheduled meetings) into Watchtower via a dedicated embedded-Teams window launched from a corner pill, with no chat/PSTN/incoming-call surface and no background Teams process.

**Architecture:** A single dedicated Electron `BrowserWindow` loads `teams.microsoft.com` on a persistent session partition (login sticks; window destroyed on close so nothing runs in the background). Electron main derives a `{open, inCall, callStartedAt}` state from the Teams `WebContents` audio state and pushes it to the renderer, which renders a standalone pill in the top-right corner. The feature touches only `packages/shared`, `electron/`, and `apps/desktop/src/` — the orchestrator and SQLite are untouched.

**Tech Stack:** Electron (main + preload IPC), React + MUI v5 (renderer, `apps/desktop/src`), TypeScript, Vitest (node environment). Shared IPC contract in `packages/shared/src/ipcContract.ts`.

## Global Constraints

- **Renderer path is `apps/desktop/src/`** (NOT `client/src/` — the CLAUDE.md note is stale). Shared package is `packages/shared/src/`, imported as `@watchtower/shared/<module>.js` (note the `.js` extension on TS source imports — NodeNext/ESM).
- **All renderer IPC goes through `invoke()` in `apps/desktop/src/state/ipc.ts`**, never `window.watchtower.invoke` directly. Push subscriptions use `window.watchtower.on(kind, handler)` which returns an unsubscribe function.
- **Theme is ocean cyan/blue — there is NO violet token.** Use `primary.main` (`#38bdf8`) / `secondary.main` (`#22d3ee`) and the glass helpers in `apps/desktop/src/theme/glass.ts`. The prototype's violet is illustrative only.
- **Tests live in top-level `tests/<area>/*.test.ts`** (vitest `include: tests/**/*.test.ts(x)`, `environment: 'node'`). Vitest aliases `@watchtower/shared` → `packages/shared/src` (source), so tests need no shared rebuild. **Node environment means no jsdom — do not write React-rendering/renderHook tests; put testable logic in a pure module.**
- **UI text is English.** No i18n. Date/number formatting stays cs-CZ (not relevant here).
- **Don't bypass pre-commit hooks or GPG signing.** Keep the suite green (219+ tests; new code adds tests).
- **Verification commands:** `npm test` (vitest), `npm run typecheck` (builds shared, typechecks electron + desktop + others). `npm run build:main` builds the electron main/preload for a manual run.

---

## File Structure

**Create:**
- `packages/shared/src/teamsState.ts` — pure state helpers (`deriveTeamsState`, `formatCallDuration`) + the `TeamsPushState` type. The only unit-tested logic.
- `electron/teamsWindow.ts` — owns the dedicated Teams `BrowserWindow`, its session/partition, UA, permission handlers, and audio-state → push wiring.
- `apps/desktop/src/state/useTeams.ts` — thin hook: subscribes to the `teamsStateChanged` push, exposes `openTeams()`.
- `apps/desktop/src/components/teams/TeamsPill.tsx` — the corner pill (three states + live timer).
- `tests/shared/teamsState.test.ts` — tests for the pure helpers + the new electron-only kinds.

**Modify:**
- `packages/shared/src/ipcContract.ts` — add `teams:open` / `teams:close` to `IpcRequest` + `IpcResponse`, both to `ELECTRON_ONLY_KINDS`, and `teamsStateChanged` to `IpcPush`.
- `electron/ipc.ts` — add electron-only handler branches for `teams:open` / `teams:close`.
- `apps/desktop/src/App.tsx` — mount `<TeamsPill/>` absolutely in the top-right corner of the content column.

---

### Task 1: Shared foundation — pure state helpers + IPC contract

**Files:**
- Create: `packages/shared/src/teamsState.ts`
- Modify: `packages/shared/src/ipcContract.ts` (IpcRequest ~line 89 area, IpcResponse ~line 770 area, IpcPush ~line 970 area, ELECTRON_ONLY_KINDS lines 985-997)
- Test: `tests/shared/teamsState.test.ts`

**Interfaces:**
- Produces: `TeamsPushState = { open: boolean; inCall: boolean; callStartedAt: number | null }`; `deriveTeamsState(input: { open: boolean; audible: boolean; prevCallStartedAt: number | null; now: number }): TeamsPushState`; `formatCallDuration(ms: number): string`. IPC kinds `teams:open` / `teams:close` (payload `Record<string, never>`, response `{ ok: boolean }`) and push `teamsStateChanged` (payload `TeamsPushState`).

- [ ] **Step 1: Write the failing test**

Create `tests/shared/teamsState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveTeamsState, formatCallDuration } from '@watchtower/shared/teamsState.js';
import { ELECTRON_ONLY_KINDS } from '@watchtower/shared/ipcContract.js';

describe('deriveTeamsState', () => {
  it('is closed and not-in-call when the window is closed', () => {
    expect(deriveTeamsState({ open: false, audible: true, prevCallStartedAt: 42, now: 100 }))
      .toEqual({ open: false, inCall: false, callStartedAt: null });
  });

  it('is open but not in a call when the window is silent', () => {
    expect(deriveTeamsState({ open: true, audible: false, prevCallStartedAt: null, now: 100 }))
      .toEqual({ open: true, inCall: false, callStartedAt: null });
  });

  it('starts the call clock when audio first begins', () => {
    expect(deriveTeamsState({ open: true, audible: true, prevCallStartedAt: null, now: 1000 }))
      .toEqual({ open: true, inCall: true, callStartedAt: 1000 });
  });

  it('keeps the original start time while the call continues', () => {
    expect(deriveTeamsState({ open: true, audible: true, prevCallStartedAt: 1000, now: 5000 }))
      .toEqual({ open: true, inCall: true, callStartedAt: 1000 });
  });

  it('resets the clock when audio stops', () => {
    expect(deriveTeamsState({ open: true, audible: false, prevCallStartedAt: 1000, now: 5000 }))
      .toEqual({ open: true, inCall: false, callStartedAt: null });
  });
});

describe('formatCallDuration', () => {
  it('formats seconds as MM:SS', () => {
    expect(formatCallDuration(0)).toBe('00:00');
    expect(formatCallDuration(134_000)).toBe('02:14');
  });
  it('lets minutes grow past 59', () => {
    expect(formatCallDuration(3_661_000)).toBe('61:01');
  });
  it('never returns negative time', () => {
    expect(formatCallDuration(-5_000)).toBe('00:00');
  });
});

describe('teams IPC kinds', () => {
  it('registers teams:open and teams:close as electron-only', () => {
    expect(ELECTRON_ONLY_KINDS.has('teams:open')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('teams:close')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/teamsState.test.ts`
Expected: FAIL — cannot resolve `@watchtower/shared/teamsState.js`, and `teams:open` not in `ELECTRON_ONLY_KINDS`.

- [ ] **Step 3: Create the pure helper module**

Create `packages/shared/src/teamsState.ts`:

```ts
/**
 * Pure state helpers for the Teams-calling feature. Kept free of any Electron
 * import so it can be unit-tested under the node vitest environment and shared
 * between electron-main (deriveTeamsState) and the renderer (formatCallDuration).
 */

export interface TeamsPushState {
  /** Whether the dedicated Teams window is currently open. */
  open: boolean;
  /** Whether we believe a call is active (open && the WebContents is audible). */
  inCall: boolean;
  /** Epoch ms when the current call became audible, or null when not in a call. */
  callStartedAt: number | null;
}

export function deriveTeamsState(input: {
  open: boolean;
  audible: boolean;
  prevCallStartedAt: number | null;
  now: number;
}): TeamsPushState {
  const inCall = input.open && input.audible;
  let callStartedAt: number | null;
  if (!inCall) callStartedAt = null;
  else if (input.prevCallStartedAt != null) callStartedAt = input.prevCallStartedAt;
  else callStartedAt = input.now;
  return { open: input.open, inCall, callStartedAt };
}

/** Format an elapsed duration (ms) as MM:SS; minutes grow past 59. */
export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Extend the IPC contract**

In `packages/shared/src/ipcContract.ts`:

Add to the `IpcRequest` union (near the other electron-only kinds, e.g. after `openExternalUrl` ~line 89):
```ts
  | { kind: 'teams:open'; payload: Record<string, never> }
  | { kind: 'teams:close'; payload: Record<string, never> }
```

Add to the `IpcResponse` union (after the matching `openExternalUrl` response ~line 770):
```ts
  | { kind: 'teams:open'; payload: { ok: boolean } }
  | { kind: 'teams:close'; payload: { ok: boolean } }
```

Add to the `IpcPush` union (after `activateInstance` ~line 969):
```ts
  | { kind: 'teamsStateChanged'; payload: import('./teamsState.js').TeamsPushState }
```

Add both kinds to `ELECTRON_ONLY_KINDS` (lines 985-997), e.g. after `'deepLink:ready'`:
```ts
  'teams:open',
  'teams:close',
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shared/teamsState.test.ts`
Expected: PASS (all 3 describe blocks green).

- [ ] **Step 6: Typecheck the shared + consumer projects**

Run: `npm run typecheck`
Expected: no errors (this rebuilds `packages/shared` and typechecks electron/desktop against the new kinds).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/teamsState.ts packages/shared/src/ipcContract.ts tests/shared/teamsState.test.ts
git commit -m "feat(teams): shared state helpers + IPC contract for Teams calling"
```

---

### Task 2: Electron — dedicated Teams window

**Files:**
- Create: `electron/teamsWindow.ts`
- Modify: `electron/ipc.ts` (add handler branches in the `ipcMain.handle('watchtower:invoke', ...)` dispatcher, ~lines 102-198; add import at top)

**Interfaces:**
- Consumes: `deriveTeamsState` and `TeamsPushState` from `@watchtower/shared/teamsState.js` (Task 1); `pushToRenderer(kind, payload)` exported from `./ipc.js` (`electron/ipc.ts:209`).
- Produces: `createOrFocusTeamsWindow(): void`, `closeTeamsWindow(): void`. Emits the `teamsStateChanged` push whenever window/audio state changes.

**No automated test.** Electron APIs (`BrowserWindow`, `session`, `webContents`) cannot run under the node vitest environment; the testable logic already lives in `teamsState.ts` (Task 1). This task's gate is `npm run typecheck` + `npm run build:main` + the manual smoke in Task 4.

- [ ] **Step 1: Create the Teams window module**

Create `electron/teamsWindow.ts`:

```ts
import { BrowserWindow, session, desktopCapturer } from 'electron';
import { deriveTeamsState } from '@watchtower/shared/teamsState.js';
import { pushToRenderer } from './ipc.js';

const TEAMS_URL = 'https://teams.microsoft.com/';

// A current desktop Edge UA so Teams serves the full web app rather than its
// "unsupported browser" fallback. Bump periodically if Teams starts degrading.
const EDGE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';

let teamsWindow: BrowserWindow | null = null;
let callStartedAt: number | null = null;

/** Recompute state from live window/audio and push it to the renderer. */
function emitState(): void {
  const open = teamsWindow != null && !teamsWindow.isDestroyed();
  const audible = open ? teamsWindow!.webContents.isCurrentlyAudible() : false;
  const next = deriveTeamsState({ open, audible, prevCallStartedAt: callStartedAt, now: Date.now() });
  callStartedAt = next.callStartedAt;
  pushToRenderer('teamsStateChanged', next);
}

export function createOrFocusTeamsWindow(): void {
  if (teamsWindow && !teamsWindow.isDestroyed()) {
    if (teamsWindow.isMinimized()) teamsWindow.restore();
    teamsWindow.focus();
    return;
  }

  // Persistent partition → login survives close/reopen and app restart.
  const ses = session.fromPartition('persist:teams');

  // Teams needs mic + camera; grant only media for this session.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  // Screen-share: hand back the primary screen source (no picker in v1).
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen', 'window'] })
      .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
      .catch(() => callback({}));
  });

  teamsWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    title: 'Teams',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    backgroundColor: '#1b1d27',
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  teamsWindow.webContents.setUserAgent(EDGE_UA);
  void teamsWindow.loadURL(TEAMS_URL);

  // isCurrentlyAudible() is the source of truth; these events are just triggers,
  // so their exact payload shape across Electron versions does not matter.
  const wc = teamsWindow.webContents;
  wc.on('audio-state-changed', emitState);
  wc.on('media-started-playing', emitState);
  wc.on('media-paused', emitState);

  teamsWindow.on('closed', () => {
    teamsWindow = null;
    callStartedAt = null;
    emitState();
  });

  emitState();
}

export function closeTeamsWindow(): void {
  if (teamsWindow && !teamsWindow.isDestroyed()) teamsWindow.close();
}
```

> **Spike note (from the spec):** confirm `isCurrentlyAudible()` reliably reports `true` for the whole duration of a real Teams call in this Electron version. If it flickers, add a short debounce before flipping `inCall` off. If the screen-share auto-pick of `sources[0]` is unacceptable, a source-picker is a deferred refinement.

- [ ] **Step 2: Wire the electron-only IPC handlers**

In `electron/ipc.ts`, add the import near the other local imports (top of file):
```ts
import { createOrFocusTeamsWindow, closeTeamsWindow } from './teamsWindow.js';
```

Inside the `ipcMain.handle('watchtower:invoke', ...)` dispatcher, alongside the other electron-only `if (kind === ...)` branches (e.g. after the `openExternalUrl` branch), add:
```ts
    if (kind === 'teams:open') {
      createOrFocusTeamsWindow();
      return { ok: true };
    }
    if (kind === 'teams:close') {
      closeTeamsWindow();
      return { ok: true };
    }
```

> **Circular-import note:** `teamsWindow.ts` imports `pushToRenderer` from `./ipc.js`, and `ipc.ts` imports the window factory from `./teamsWindow.js`. Both are used at call-time (not import-time), so ESM handles the cycle. If a runtime `undefined` appears, move `pushToRenderer` into a tiny standalone module both import instead.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Build the electron main to confirm it compiles for packaging**

Run: `npm run build:main`
Expected: completes with no TypeScript errors; `preload.cjs` regenerated.

- [ ] **Step 5: Commit**

```bash
git add electron/teamsWindow.ts electron/ipc.ts
git commit -m "feat(teams): dedicated Teams BrowserWindow + open/close IPC"
```

---

### Task 3: Renderer — useTeams hook, TeamsPill, and mount

**Files:**
- Create: `apps/desktop/src/state/useTeams.ts`
- Create: `apps/desktop/src/components/teams/TeamsPill.tsx`
- Modify: `apps/desktop/src/App.tsx` (the content-column `Box` at ~lines 479-483)

**Interfaces:**
- Consumes: `TeamsPushState`, `formatCallDuration` from `@watchtower/shared/teamsState.js` (Task 1); the `teamsStateChanged` push and `teams:open` request (Task 1); `invoke` from `./ipc`; glass helpers `glassFill`, `accentWash`, `accentActiveText` from `../../theme/glass`.
- Produces: `useTeams(): TeamsPushState & { openTeams(): void }`; the `<TeamsPill/>` component.

**No automated test** (node vitest env has no DOM; the hook and pill are thin glue over the Task-1 logic). Gate: `npm run typecheck` + the Task 4 manual smoke.

- [ ] **Step 1: Create the hook**

Create `apps/desktop/src/state/useTeams.ts`:

```ts
import { useEffect, useState } from 'react';
import type { TeamsPushState } from '@watchtower/shared/teamsState.js';
import { invoke } from './ipc';

export type TeamsHook = TeamsPushState & { openTeams(): void };

const INITIAL: TeamsPushState = { open: false, inCall: false, callStartedAt: null };

export function useTeams(): TeamsHook {
  const [state, setState] = useState<TeamsPushState>(INITIAL);

  useEffect(() => {
    // The push is fired by electron-main on every window/audio transition.
    return window.watchtower.on('teamsStateChanged', (payload) => {
      setState(payload);
    });
  }, []);

  const openTeams = (): void => {
    void invoke('teams:open', {});
  };

  return { ...state, openTeams };
}
```

- [ ] **Step 2: Create the pill component**

Create `apps/desktop/src/components/teams/TeamsPill.tsx`:

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import VideocamIcon from '@mui/icons-material/Videocam';
import CallIcon from '@mui/icons-material/Call';
import { formatCallDuration } from '@watchtower/shared/teamsState.js';
import { glassFill, accentWash, accentActiveText } from '../../theme/glass';
import { useTeams } from '../../state/useTeams';

/**
 * Standalone Teams control in the top-right corner of the app chrome. Three
 * states: closed (dim "Teams"), open ("Teams · open"), on a call
 * ("On a call · MM:SS" with a live timer). Click opens or focuses the window.
 */
export function TeamsPill(): JSX.Element {
  const theme = useTheme();
  const { open, inCall, callStartedAt, openTeams } = useTeams();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!inCall) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inCall]);

  const Icon = inCall ? CallIcon : VideocamIcon;
  const label = inCall ? 'On a call' : 'Teams';
  const status =
    inCall && callStartedAt != null
      ? formatCallDuration(now - callStartedAt)
      : open
        ? 'open'
        : '';

  return (
    <Box
      role="button"
      aria-label={inCall ? 'Return to Teams call' : 'Open Teams'}
      onClick={openTeams}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        height: 32,
        px: 1.5,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        WebkitAppRegion: 'no-drag',
        ...glassFill(theme, { elevation: 1 }),
        borderRadius: '11px',
        ...(inCall
          ? { backgroundColor: accentWash(theme), color: accentActiveText(theme) }
          : { color: 'text.secondary' }),
        opacity: open || inCall ? 1 : 0.7,
        transition: 'opacity .15s, background-color .15s',
      }}
    >
      <Box
        sx={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: inCall ? 'secondary.main' : 'text.disabled',
        }}
      />
      <Icon sx={{ fontSize: 16 }} />
      <Box component="span" sx={{ fontSize: 12.5, fontWeight: 600 }}>
        {label}
      </Box>
      {status && (
        <Box
          component="span"
          sx={{ fontSize: 11.5, color: 'secondary.main', fontVariantNumeric: 'tabular-nums' }}
        >
          {status}
        </Box>
      )}
    </Box>
  );
}
```

> If `@mui/icons-material` is not a dependency of `apps/desktop` (check its `package.json`), replace the two icon imports with inline `<Box component="svg" ...>` paths from the prototype (`docs/prototypes/teams-integration.html`, the `ICON.video` / `ICON.phone` entries). Do not add a new dependency without flagging it.

- [ ] **Step 3: Mount the pill top-right in App.tsx**

In `apps/desktop/src/App.tsx`, import the component near the other component imports:
```tsx
import { TeamsPill } from './components/teams/TeamsPill';
```

Find the content-column container (~line 479):
```tsx
<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
```
Add `position: 'relative'` to its `sx`, and insert the pill as the FIRST child of that Box so it overlays the top-right corner on every module (including Dashboard, where the TabStrip is hidden):
```tsx
<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
  <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
    <TeamsPill />
  </Box>
  {/* ...existing TabStrip and module content unchanged... */}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/state/useTeams.ts apps/desktop/src/components/teams/TeamsPill.tsx apps/desktop/src/App.tsx
git commit -m "feat(teams): corner pill + useTeams hook, mounted top-right"
```

---

### Task 4: Verification — full suite, typecheck, and manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, count ≥ prior baseline + the new `teamsState` cases. No pre-existing tests broken.

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: no errors across shared/electron/desktop/ipad/iphone.

- [ ] **Step 3: Manual smoke (unavoidable — real Teams + real windows)**

Launch the dev app: `npm run dev`. Then verify:
- The corner pill shows dim **"Teams"** (closed) on Dashboard and on other modules.
- Click it → a Teams window opens and loads `teams.microsoft.com`; pill flips to **"Teams · open"**.
- Sign in once; close the Teams window (its red light) → pill returns to dim **"Teams"**. Re-open → **no re-login** (persistent partition works).
- Join a meeting/call → pill becomes **"On a call · MM:SS"** with a ticking timer; switching Watchtower to another module (Instances/Billing/Dashboard) does not interrupt the call.
- Click the pill while on a call → the Teams window is focused/raised.
- In-call: microphone and camera work (permission handler); screen-share works (display-media handler).
- Leave the call → pill returns to **"Teams · open"**; timer stops.

> If run from a git worktree, the manual step needs `npm install` + `npm run electron:rebuild` first (better-sqlite3 ABI), and launch with `WATCHTOWER_WS_HOST=127.0.0.1 WATCHTOWER_WS_PORT=7455` to coexist with any published build. Tests + typecheck run fine in a worktree without a rebuild.

- [ ] **Step 4: Final commit (if any manual-smoke fixes were needed)**

```bash
git add -A
git commit -m "fix(teams): manual-smoke corrections"
```
