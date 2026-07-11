# iPad/iPhone Jira board + worklog upload — execution plan

Base: `feat/ipad-jira-board` (off origin/main `df757cc`). Supersedes the earlier
scoping doc, which was written against pre-refactor paths. Task-1 (Jira estimate
as the grid's expected time) is already committed on this branch.

## Architecture reality (post-refactor)

- Billing UI is a **shared module** `packages/module-timetracker`, consumed by
  **both** `apps/ipad` and `apps/iphone`. Data hook: `packages/data-supabase`
  (`useBilling`). Board-mirror columns (`jira_status`, `jira_estimate_secs`,
  `jira_synced_at`) sync Mac→Supabase and are readable by both apps.
- **The WS bridge to the Mac orchestrator is iPad-only.** `useConnection()` /
  `bridge.invoke` live in `apps/ipad`. `apps/iphone` has **no bridge at all**
  (Supabase-only). `module-timetracker` is deliberately bridge-agnostic.
- Nav is **duplicated per app** — no shared Rail. iPad: `Rail.tsx` `BILLING_TABS`.
  iPhone: its own `RECORDS_TABS` / `TITLES` / inlined section-switch in `App.tsx`.
- Jira RPCs (`jira:syncPreview`, `jira:sync`, `board:authPing`, `board:get`,
  `board:sync`, `board:remove`) are in the shared contract and **not**
  electron-only → callable over the iPad bridge. Only `board:signIn` (SSO) is
  Mac-desktop-only.

## Consequence for scope

| Capability | iPad | iPhone | Why |
|---|---|---|---|
| Read-only board (from Supabase) | ✅ | ✅ | `useBilling` works on both |
| Trigger board re-sync (`board:sync`) | ✅ | ❌ | needs the WS bridge |
| Upload worklogs to Jira (`jira:sync`) | ✅ | ❌ | needs the WS bridge |

The shared `BoardView` renders the read-only board everywhere; WS-dependent
actions are injected by the host app (iPad passes real callbacks + conn status;
iPhone passes none → those buttons are hidden).

## Phases (each ends in a commit; TDD where there's logic)

### Phase 0 — `jira_status` in the data layer
- `packages/shared/src/billing/types.ts`: add `jiraStatus: string | null` to `TaskRow`.
- `packages/data-supabase/src/billingCache.ts`: add `jira_status` to `RawTaskRow`
  + map it in `mapTaskRow`.
- `packages/data-supabase/src/useBilling.ts`: add `jira_status` to the tasks select.
- Test: extend `tests/ipad/billingCache.test.ts` (`mapTaskRow` maps `jira_status`).

### Phase 1 — shared board builder (pure, testable)
- New `packages/shared/src/billing/board/board.ts`: `STATUS_TO_COLUMN`,
  `HIDDEN_STATUSES` (ported from `orchestrator/services/jiraBoard.ts`), and
  `buildBoard(tasks, worklogs, opts?) → { columns: { key, title, cards[] }[] }`.
  Card = `{ taskNumber, taskTitle, projectColor, projectName, epicName?,
  jiraStatus, column, estimateMinutes, loggedMinutes }`. `loggedMinutes` summed
  from worklogs by `taskNumber`; only tasks with a non-null `jiraStatus` appear;
  hidden statuses (`Waiting`, `Done`) dropped; columns rendered `todo/doing/to_accept`.
- Tests: `tests/shared/billing/board/board.test.ts` — column mapping, hidden-status
  drop, logged-minutes sum, estimate passthrough.

### Phase 2 — read-only `BoardView` (both apps)
- New `packages/module-timetracker/src/billing/BoardView.tsx` — 3-column layout
  (mirror desktop `BoardTab`), cards show key/title/epic/`logged / estimate`.
  Uses `useBilling()` + `buildBoard`. Inline styles + `C` tokens; glass panels
  like `TaskGridView`. Optional props: `onSync?`, `syncing?`, `connOnline?`,
  `onUpload?` (all undefined ⇒ read-only, buttons hidden).
- Wire the `'board'` section: `billing/types.ts` union + `BillingArea.tsx` switch
  + `index.ts` export.
- Nav: iPad `Rail.tsx` `BILLING_TABS` (+ glyph); iPhone `App.tsx` `RECORDS_TABS`
  + `TITLES` + inlined switch.
- Verify: builds + typecheck both apps; view renders from synced data.

### Phase 3 — iPad sync trigger
- In `apps/ipad/src/App.tsx`, use `useConnection()` to pass `onSync` (calls
  `bridge.invoke('board:sync', { projectId })` then refetches billing) +
  `connOnline` (`status === 'connected'`) into `BillingArea`→`BoardView`.
  Thread the two optional props through `BillingArea`.
- Project scoping: board syncs the project(s) that already have Jira tasks
  (derive `projectId` set from tasks with `jiraStatus`); a selector if >1.
- Auth/reachability UX: `board:authPing` → "sign in on the Mac" when cookie
  absent; reuse the InstancesModule offline banner + `WakeButton` when the WS is
  down. iPhone unaffected (no props → no button).

### Phase 4 — iPad worklog upload
- Port `JiraSyncDialog` as an iPad inline-style sheet: `bridge.invoke(
  'jira:syncPreview', {from,to,projectId?,onlyUnposted})` → preview → confirm
  `jira:sync`. Show summary + per-entry status. Reflect `jira_uploaded` after
  refetch. Gate on `connOnline`.

## Open scope decisions (need your call)
1. **iPhone**: read-only board only (no sync/upload), as above — acceptable?
   Alternative: hide the Board tab on iPhone entirely for v1.
2. **All four phases now, or ship Phase 0–2 (read-only board, both apps) first**
   and treat sync + upload (Phase 3–4) as a follow-up PR?
3. **Board project scoping** on iPad: auto (all projects with Jira tasks) vs a
   selector. Recommend auto for v1.
