# Reviews Module — PR Notifications & Merge Button

**Date:** 2026-07-12
**Status:** Design approved, pending spec review
**Module:** Reviews (desktop-only)

## Goal

Extend the reviews module so the user is proactively notified about pull-request
activity, and can merge their own approved PRs from within Watchtower:

1. **Review requested** — notify when the user is added as a reviewer on a PR.
2. **Activity on my PRs** — notify on new comments, reviews, approvals, and
   changes-requested on PRs the user authored.
3. **Merge action** — a merge button that appears when the user's own PR is
   approved and mergeable, performing a squash-merge (with confirm).

Scope decisions (from brainstorming):

- **Providers:** both GitHub (via `gh` CLI) and Azure DevOps / Škoda (REST + PAT).
- **Watch scope:** account-wide — all repos where the user is a requested
  reviewer or author, not just configured Watchtower project repos.
- **Delivery:** macOS native notification + in-app indicator only. No iOS/APNs
  push in this iteration.
- **Merge method:** squash, with a confirm dialog and a "delete source branch
  after" checkbox (default on).

## Architecture

A new orchestrator background service, **`PrWatcher`**, modeled on the existing
`startTokenUsagePolling()` pattern (`orchestrator/index.ts:161`). It:

1. Polls both providers on an adaptive timer.
2. Diffs fresh results against persisted per-PR "last-seen" state.
3. Emits one notification per genuinely-new event, through the existing `notify`
   push pipeline, and logs each to the `notifications` SQLite table.
4. Drives an in-app unread indicator on the Reviews tab.

No webhooks — a local desktop app has no public endpoint, so polling is the
correct fit.

**Cadence:** adaptive, like `orchestrator/attentionRelay.ts` — poll every ~60s
while the app window is focused, back off to ~5 min when unfocused. One combined
cycle covers GitHub + all DevOps hosts.

The watcher reuses the singleton `ReviewsService` and the provider modules in
`orchestrator/services/prProviders/` so PR-list state stays coherent with the
rest of the module.

## Identity resolution

To decide "is this *my* PR / *my* review request", resolve the current user per
provider, cached at watcher start and re-resolved when a PAT changes:

- **GitHub:** `gh api user` → `login`.
- **DevOps:** `GET {host}/_apis/connectionData` (or the profile API) with the
  stored PAT → `authenticatedUser.id` / `providerDisplayName`, cached per host.

## What gets watched & the event model

Two queries per provider per cycle:

- **Review requested of me**
  - GitHub: `gh search prs --review-requested=@me --state=open --json ...`
  - DevOps: org-wide active PRs filtered to `reviewers[]` containing me.
- **PRs I authored**
  - GitHub: `gh search prs --author=@me --state=open --json ...`
  - DevOps: active PRs with `searchCriteria.creatorId = me`.

Events raised (each de-duplicated against last-seen state):

| Event | Condition |
|---|---|
| `review_requested` | The user appears as a reviewer on a PR not previously seen as requested |
| `commented` | New comment (thread or review comment) on the user's PR since the last-seen comment id/timestamp |
| `reviewed` | A review was submitted on the user's PR (state = commented / changes-requested) |
| `approved` | Someone approved the user's PR |
| `changes_requested` | Someone requested changes on the user's PR |

## Dedup / last-seen state

New SQLite table (migration **v21**) `pr_watch_state`:

```
host              TEXT    -- 'github' | 'azdo'
repo_key          TEXT
pr_number         INTEGER
my_role           TEXT    -- 'author' | 'reviewer'
review_requested_seen INTEGER  -- 0/1
last_comment_ts   TEXT    -- ISO, high-water mark of seen comments
last_review_ts    TEXT    -- ISO, high-water mark of seen reviews
updated_at        TEXT
PRIMARY KEY (host, repo_key, pr_number)
```

Accessed via a new `PrWatchStateRepo` in `orchestrator/db/repositories/`.

The watcher compares fresh provider data against the row, emits only the delta,
then advances the row's high-water marks. **First-ever sighting of a PR seeds
the row without notifying**, so enabling the feature (or a first poll after
restart) does not dump a backlog of alerts. Closed/merged PRs are pruned from
the table once they no longer appear in either query result.

## Notifications

Extend the existing `notify` push so it can carry a **PR target** rather than
only an instance target:

- `packages/shared/src/ipcContract.ts` — widen the `notify` push payload union
  to include `{ target: 'pr', host, repoKey, prNumber, event }` alongside the
  existing instance payload.
- `packages/shared/src/messagePort.ts` — mirror the widened push type.
- `electron/notifications.ts` — `fireMacNotification` gains a PR `kind` and
  routes its `onClick` to focus the window and deep-link the Reviews module.
- `electron/ipc.ts:18` — the `notify` push receiver handles the PR variant.

Clicking the macOS notification focuses the window and opens the target PR's
inspector drawer in the Reviews module. Every event is also logged to the
`notifications` table (reusing `NotificationsRepo.log`) and increments an
**in-app unread badge** on the Reviews tab; opening a PR clears its unread.

## Merge button

Rendered in `PrInspectorDrawer` (and optionally as an affordance on `PrRow`)
**only** when the PR is the user's own, approved, and mergeable:

- **Approved:**
  - GitHub: ≥1 approving review and no outstanding changes-requested.
  - DevOps: reviewer votes indicate approved (vote ≥ 10) with no rejections
    (vote = -10) or waits.
- **Mergeable:** no merge conflicts and required status checks green
  (GitHub `mergeStateStatus`; DevOps PR `mergeStatus` / policy evaluation).

Click → confirm dialog with a "delete source branch after" checkbox
(default on) → squash merge:

- GitHub: `gh pr merge <n> --repo <nwo> --squash [--delete-branch]`
- DevOps: `PATCH .../pullRequests/{n}?api-version=7.1` with
  `status=completed`, `completionOptions.mergeStrategy=squash`,
  `completionOptions.deleteSourceBranch=<checkbox>`.

If the PR is not mergeable, the button is disabled with a tooltip explaining
why. Merge failures surface via the drawer's existing error state. On success,
the PR list refreshes and the watch-state row is pruned.

## IPC additions

Added to `ipcContract.ts` + `messagePort.ts` (request + response unions) and
handled in `orchestrator/index.ts`:

| Kind | Purpose |
|---|---|
| `prWatch:list` | Current inbox — watched PRs and their unread events for the in-app view |
| `prWatch:markSeen` | Clear unread events for one PR |
| `prs:merge` | Perform the squash merge (PAT-injected for DevOps) |

New pushes:

- `prWatchEvent` — a new event arrived; renderer refreshes the inbox + badge.

DevOps-dependent kinds (`prs:merge`, and the watcher's own polling) require the
Azure PAT; `prs:merge` is added to the injection allowlist in
`electron/ipc.ts:124`. The watcher runs inside the orchestrator and reads PATs
via the existing `getSetting('reviews.devops.pats')` decrypt path.

A thin renderer hook (`apps/desktop/src/state/usePrWatch.ts` or an extension of
`useReviews.ts`) subscribes to `prWatchEvent` and exposes the inbox + unread
count to `ModuleReviews`.

## Testing

- **Dedup/delta logic** (the core): given a last-seen row + fresh PR data,
  assert the exact event set emitted and that a second identical poll emits
  nothing (idempotence / no re-notify). Cover the "first sighting seeds silently"
  rule.
- **Identity parsing** for both providers (mocked API responses).
- **Approved-and-mergeable predicate** per provider (approving review vs
  changes-requested; DevOps vote thresholds; conflict / failing-check gating).
- **Migration v21** — table shape and index, node:sqlite + better-sqlite3
  (mind the ADD COLUMN engine divergence; this is a CREATE TABLE so it is safe).
- Provider network calls (`gh`, `fetch`) mocked. Suite stays at 219+.

## Out of scope (this iteration)

- iOS / APNs push for review events.
- Per-repo mute list (account-wide is unfiltered for now).
- Merge-method choice UI (squash only).
- Notifications for PR state the user is neither author nor reviewer of.
- Normalizing findings/comments storage.
