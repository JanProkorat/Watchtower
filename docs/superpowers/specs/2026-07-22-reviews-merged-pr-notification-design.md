# Reviews: notify + auto-remove on PR merge — design

**Date:** 2026-07-22
**Status:** Approved design, pending implementation plan

## Problem

In the Reviews module, when a watched PR is **merged** (by anyone), the user must
press **Refresh** for it to leave the list. They want, instead: a **notification**
on merge, and the PR to **auto-disappear** from the list within a poll cycle — no
manual refresh.

Scope decisions (confirmed):
- **Notify on merge only.** Closed/abandoned PRs still auto-drop from the list
  (it is open-PRs-only) but produce **no** notification.
- **macOS native notification**, reusing the existing PR-notification path (#181).

## Current state (from codebase exploration)

- **Reviews list** = `ReviewsService` (`orchestrator/services/reviews.ts`) → IPC
  `prs:list` / `prs:refresh` → `useReviews` (`apps/desktop/src/state/useReviews.ts`).
  The list is **open-PRs-only** (GitHub `gh pr list --state open`; Azure DevOps
  `searchCriteria.status=active`). It refreshes **only** on a manual action or
  after a local `prs:merge`/`prs:close`. **No push/poll updates the list** — an
  externally-merged PR lingers until Refresh.
- **PR-watch poller** (`orchestrator/services/prWatch/PrWatcher.ts`, ticked in
  `orchestrator/index.ts` at 60s focused / 300s unfocused) fires macOS
  notifications for review activity via a `notify` push, but **only queries open
  PRs** — a merge just makes a PR silently vanish (`repo.prune`). It has **no
  merge detection** and **no `merged` event**.
- **Notifications**: `notify` push (`packages/shared/src/ipcContract.ts`,
  mirrored in `messagePort.ts`) → `electron/notifications.ts fireMacNotification`
  (target `pr` → native banner + deep-link to reviews) + `NotificationsRepo.log`.
  `notify.payload.event` is typed `WatchEvent['type']` (`prWatch/types.ts`).
- `PullRequestPayload` (`ipcContract.ts`) has **no** `state`/`merged` field.
  Merge state is **not** captured anywhere (only merge-*ability*).

## Approach

A **live background refresh of the Reviews list**, piggybacked on the existing
PR-watch tick (no new timer; ~≤60s latency focused). Instant delivery would need
webhooks — out of scope.

### Orchestrator (`ReviewsService.backgroundRefresh`)

Each tick, after `watcher.cycle()`:

1. Snapshot the prior open set — the current `ReviewsService.cache` (keyed by
   `host + repoKey + number`).
2. Re-run the existing open-only fetch → the new open set.
3. **Diff**: keys in the prior set but absent from the new set = **disappeared**.
4. For each disappeared PR, one **targeted state query** to classify:
   - GitHub: `gh pr view <number> --repo <nwo> --json state,mergedAt` → merged iff
     `state === 'MERGED'`.
   - Azure DevOps: GET the PR by id → merged iff `status === 'completed'`
     (`abandoned` = closed-without-merge).
5. For **merged** PRs: emit the `notify` push (`target: 'pr'`, `event: 'merged'`,
   body `"<title>" was merged`) **and** `NotificationsRepo.log(pr:<host>:<repoKey>#<n>,
   'pr-merged', body, now)` — identical wiring to the existing PR events, so the
   macOS banner + history + click-to-focus all work unchanged.
6. Replace `cache` with the new open set and emit a `prsChanged` push.

Guards:
- **No double-notify**: once removed from `cache`, a merged PR cannot reappear in
  the open set, so it is classified/notified at most once. If the targeted query
  fails (network), skip notifying that PR this cycle and leave it in `cache` so it
  is retried next cycle (avoids a lost or duplicated notification).
- Classification only fires for PRs that were genuinely in our open list last
  cycle (not first-seen), so a cold start doesn't notify.

### Renderer (`useReviews`)

Subscribe to `prsChanged`; on receipt, re-run `load('prs:list')` — which returns
the orchestrator's already-refreshed `cache` (no extra network). The merged PR
drops off live. This is the missing live-update wire (mirrors how `usePrWatch`
already reacts to `prWatchEvent`).

## Data model / contract additions

- `WatchEvent` (`prWatch/types.ts`): add `{ type: 'merged' }`. This flows into the
  `notify` push's `event` type automatically.
- `notificationBody` (`orchestrator/index.ts`): add `case 'merged'` →
  `` `"${pr.title}" was merged` `` (or `${repoLabel} #${n} merged`).
- New push `prsChanged` in `IpcPush` (`ipcContract.ts`) **and** the orchestrator
  push mirror (`messagePort.ts`). Payload: `Record<string, never>` (renderer just
  refetches `prs:list`).
- Provider state lookups: `fetchGithubPrState(repoKey, number)` and
  `fetchAzdoPrState(...)` returning `{ merged: boolean }` (or a small
  `PrClosedState`), living beside the existing provider modules
  (`orchestrator/services/prProviders/`).

## Components (single responsibility)

- **`orchestrator/services/reviews/detectMerged.ts`** (new, pure): given the prior
  open set, the new open set, and a `(pr) => Promise<{merged:boolean}>` classifier,
  returns `{ removedKeys, mergedPrs }`. The diff is a pure function; the classifier
  is injected so it's unit-testable without network.
- **`ReviewsService`**: gains `backgroundRefresh(deps)` orchestrating the above and
  emitting `notify` + `prsChanged`.
- **Provider state lookups**: one small fetch per provider.
- **`useReviews`**: one added push subscription.

## Testing

- **Pure diff** (`detectMerged`): prior/new sets → correct disappeared keys; with a
  stubbed classifier marking some merged → correct `mergedPrs` subset; first-seen
  PRs never flagged; a classifier that throws for one PR leaves it out of
  `mergedPrs` and keeps it retryable (does not crash the batch).
- **`notificationBody('merged')`** → expected string.
- **Contract**: `prsChanged` present in `IpcPush` + messagePort; `notify.event`
  accepts `'merged'`.
- Provider state lookups + the tick wiring have no unit tests (network/Electron
  glue); verified by typecheck + manual smoke.
- Keep the suite green; new logic adds tests.

## Risks

- **Latency** = poll interval (≤60s focused / ≤300s unfocused). Accepted.
- **Targeted-query cost**: one extra provider call per *disappeared* PR per cycle
  — normally zero. Bounded by list churn.
- **Watch set vs list set**: detection is driven off the Reviews **list's** own
  open set, so it covers every list PR (broader than the watch inbox). No gap.
- **Provider auth**: the targeted query reuses the same auth/PAT the list fetch
  uses; if that fails, classification is skipped and retried (no false notify).

## Out of scope

- Webhook/real-time delivery; notifying on close/abandon; changing the watch inbox
  (`usePrWatch`) behavior; a persisted PR `state` column.
