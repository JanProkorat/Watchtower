# Project time auto-logging (app-native)

**Date:** 2026-07-03
**Status:** Design — approved approach, pending spec review
**Scope:** Watchtower orchestrator + TimeTracker UI

## Problem

Time spent working in Claude Code instances is auto-logged today **only** for
the "green code" and "fitness platform" projects, because each of those repos
has a hand-installed private hook flow (`.claude/hooks/autolog-time.sh` +
`.claude/private/log-time.sh`) that reads Watchtower's `hook_events` table,
computes active minutes, and writes worklog rows **directly into SQLite**,
bypassing the app. A fresh project has none of those scripts, so it never gets
auto-logged.

The Watchtower app already ingests every hook event from every managed instance
into `hook_events`, and already knows each instance's `cwd` (matchable against a
project's `folder_path`). The only missing piece is the code that turns "session
activity in a known project folder" into a worklog. The schema even reserves a
`source = 'watchtower-auto'` value for exactly this.

**Goal:** promote the per-repo bash hack into a first-class app feature so that
any project can auto-track time across all its instances, with no per-repo setup.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Task attribution | Tagged task if the instance is tagged (`instance.task_id`), else a per-project catch-all task | Precise when you bother to tag; never loses time when you don't |
| Activation scope | Per-project opt-in toggle, **off by default** | Deliberate cutover for green code / fitness; no surprise worklogs |
| Trigger | `SessionEnd` (and `Stop`) for instances in an enabled project | Reuses the proven private-flow trigger point |
| Aggregation grain | One worklog per **(task, work_date)** | Clean, bill-ready daily rows; matches how a human logs |
| Idempotency | Recompute + upsert keyed on `(source, external_id)` | Leverages the existing partial unique index; no watermark table |
| Idle cap | 10 min per gap (hardcoded constant) | Matches the private flow; YAGNI on a setting |

## Architecture

A single new orchestrator service — `orchestrator/services/autoLogger.ts` —
owns the whole feature. It is invoked from the existing hook-event consumption
path (`orchestrator/index.ts`, where events are already mapped to state-machine
transitions) when a `SessionEnd`/`Stop` event arrives.

```
Claude hook → watchtower-hook.mjs → hookListener → hook_events (append)
                                                        │
                                       onHookEvent (index.ts) ──► autoLogger.onSessionBoundary(instanceId, event)
                                                                          │
   ┌──────────────────────────────────────────────────────────────────┬─┘
   │ 1. resolve project by instance.cwd → project.folder_path          │
   │ 2. bail unless project.auto_track = 1                             │
   │ 3. resolve task: instance.task_id ?? catchAllTask(project)        │
   │ 4. compute active minutes per work_date (capped-gap, pure fn)      │
   │ 5. upsert worklog per (task, work_date), source='watchtower-auto' │
   └───────────────────────────────────────────────────────────────────┘
```

### Units

- **`activeMinutes(pings: number[], idleCapMs)` — pure function.** Given sorted
  hook-event timestamps for one task's instances, sums inter-event gaps, capping
  each gap at `idleCapMs` (10 min). Returns minutes grouped by local `work_date`
  so a session crossing midnight splits correctly. Unit-testable in isolation, no
  DB. Callers partition events **by resolved task first** (a project can have some
  instances tagged to task A and others on the catch-all the same day), then feed
  each task's event stream in separately.
- **`resolveProjectByCwd(cwd)`** — expands `~`, exact-matches a live instance's
  `cwd` against `projects.folder_path`. Reuses the existing `liveByCwd` /
  `findByCwd` logic (`orchestrator/index.ts:921`).
- **`catchAllTask(projectId)`** — find-or-creates epic `Auto-tracked` → task
  `General` under the project; returns its `task_id`. Idempotent.
- **`autoLogger.onSessionBoundary(instanceId, event)`** — the orchestrator hook.
  Orchestrates the five steps above; does nothing (fast return) for projects
  with `auto_track = 0` or instances that match no project.

### Data model

Add one column to `projects`:

```sql
ALTER TABLE projects ADD COLUMN auto_track INTEGER NOT NULL DEFAULT 0;
```

Constant default `0` — deliberately **not** a non-constant default, to avoid the
node:sqlite / better-sqlite3 `ADD COLUMN` divergence on non-empty tables (see the
`sqlite-add-column-engine-divergence` incident). New migration version bump in
`orchestrator/db/migrations.ts`.

Worklog rows written by this feature:

- `source = 'watchtower-auto'`
- `external_id = auto:<task_id>:<work_date>` — stable, so re-fires and every
  `/clear`'d session on the same day collapse into one row via the existing
  partial unique index `idx_worklogs_external(source, external_id)`.
- `minutes` = recomputed capped-gap total for that (task, work_date).
- `reported_minutes` = derived by the **shared billing-rounding formula** (same
  one the repo layer already applies), not computed ad hoc.
- `work_date` = the local date of that segment.
- `description` = auto-generated, e.g. `Auto-tracked — <N> session(s)`.

### Upsert semantics

On each `SessionEnd`/`Stop`, resolve the affected task, gather the hook events of
**all the project's instances that resolve to that same task** for the day,
recompute total active minutes per `(task, work_date)`, then:

- If a worklog with that `(source, external_id)` exists → **update** its
  `minutes`/`reported_minutes` to the recomputed total (`source`/`external_id`
  are immutable on update, which is fine — we never change them).
- Else → **insert**.

This makes the operation idempotent and correct regardless of how many sessions
or re-fires occur. Soft-deleted rows are excluded by the index's `deleted_at`
clause, so a worklog the user manually deletes is not silently resurrected on the
next event — the recompute will re-insert only if it was not tombstoned.

### IPC

No new IPC *kind* needed for the write path — the orchestrator writes worklogs
internally through the existing worklogs repo. The toggle rides on the existing
project-update surface:

- Extend the `projects:update` payload with an `autoTrack: boolean` field
  (`shared/ipcContract.ts`, mirror in `shared/messagePort.ts`), handled by the
  existing project-update handler in `orchestrator/index.ts`.

### UI

- **ProjectDrawer** (`apps/desktop/src/components/timetracker/ProjectDrawer.tsx`):
  add an "Auto-track time" switch, wired through the `useProjects` hook. Off by
  default. Help text noting it logs to the tagged task, else a catch-all.
- **Worklog visibility:** auto-logged rows carry `source='watchtower-auto'`;
  surface a small source indicator in the worklog list so the user can tell
  auto rows from manual ones and edit/reassign/delete them. (Auto rows are
  ordinary worklogs — fully editable; moving one to a real task is a normal
  `task_id` update through the existing UI.)

## Edge cases

- **Retagging mid-session:** task is resolved at each `SessionEnd`. If an
  instance's tag changes, subsequent boundaries log to the new task; already-logged
  minutes stay where they were. Acceptable — no attempt to retroactively move.
- **Cross-midnight sessions:** handled by per-`work_date` grouping in
  `activeMinutes`.
- **Nested Claude processes:** `index.ts` already drops hook events whose cwd
  doesn't match the managed instance (`hookCwdMatches`), so the timestamp stream
  fed to `activeMinutes` is already clean. No extra work; noted so it isn't
  re-solved.
- **User deletes an auto worklog:** tombstoned rows are excluded from the unique
  index; the recompute will re-insert (the day is still active). If the user
  wants a day permanently excluded, they reassign/zero it — documented, not
  specially handled.

## Coexistence with the private scripts (must-address)

The private flow writes `source='claude'`; this feature writes
`source='watchtower-auto'`. The two **do not dedupe against each other**, so
enabling app auto-track on a repo that still runs the scripts double-bills.

- The opt-in toggle makes the cutover explicit: enabling a project means
  retiring that repo's `.claude/hooks/autolog-time.sh` (and its
  `.claude/private/` clock flow).
- Watchtower's **own** dev-time flow (Claude's private clock logging) can stay
  as-is — simply do not enable the toggle for the "Watchtower" project.
- This is a documentation + operational note, not code: the feature does not
  attempt to detect or disable repo-level scripts.

## Testing

- **`activeMinutes` unit tests:** empty stream, single ping, sub-cap gaps summed,
  over-cap gaps clamped, cross-midnight split, out-of-order timestamps.
- **`catchAllTask` idempotency:** two calls → one epic + one task.
- **Auto-log integration:** synthetic `hook_events` for an enabled project →
  one worklog per (task, day); re-fire → still one row, minutes unchanged;
  tagged instance → logs to the tag; untagged → logs to catch-all.
- **Migration test:** `auto_track` column present, defaults 0, existing rows
  unaffected (run under both node:sqlite and the prod engine expectation).
- Keep the suite green (219+; add tests for new code per project convention).

## Out of scope

- Configurable idle cap (hardcode 10 min).
- Auto-detecting / auto-disabling repo-level private scripts.
- Retroactive worklog migration from `source='claude'` rows.
- Per-session (Approach 2) or bash-installed-hook (Approach 3) variants.
