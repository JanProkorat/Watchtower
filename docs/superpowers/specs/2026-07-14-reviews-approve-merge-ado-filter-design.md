# Reviews module — in-app Approve + Merge, and ADO reviewer/author filter

**Date:** 2026-07-14
**Status:** Approved design, pending implementation plan
**Module:** Reviews (`apps/desktop/src/components/reviews`, `orchestrator/services/reviews.ts` + `prProviders/`, `packages/shared/src/ipcContract.ts`)

## Problem

Two issues in the Reviews module:

1. **No in-app approve, and merge is over-gated.** The PR drawer's Merge button only
   appears when the PR is authored by me (`watchItem.myRole === 'author'`) and reads its
   `approved`/`mergeable` state from the background watch-inbox item — which is `null` until
   the poller has seen the PR and can be up to 5 minutes stale. There is no way to approve a
   PR from the app at all. The user wants to:
   - Approve any PR from Watchtower, including PRs created by other people.
   - Merge any PR that is approved (by me **or** anyone else) and mergeable, regardless of who
     created it — so an approved PR can be merged without the author's involvement.

2. **ADO browse list shows every PR.** `listAzdoPrs` queries
   `searchCriteria.status=active` with no creator/reviewer filter, so the Reviews list shows
   every active PR in the repo. The user wants only PRs where they are the creator **or** an
   added reviewer. (The background watcher already filters this way; the browse list never
   got the same treatment.)

## Decisions (confirmed with user)

- **Merge gate:** enabled when the PR is **approved by anyone** AND mergeable. Drop the
  "must be author" and implicit "approved by me" constraints. No always-on / let-host-reject
  mode.
- **Self-approve:** **hide** the Approve button on PRs I created (GitHub's API rejects
  self-approval; ADO allows it but it is pointless). Approve shows only on others' PRs.
- **Filter scope:** apply the reviewer/author filter to **Azure DevOps only**. GitHub's
  browse list (`gh pr list --repo … --state open`) is unchanged.
- **Drawer action-state source:** **Approach A** — fetch fresh review-state on drawer open
  via a new IPC, rather than relying on the background watch-inbox item. This removes the
  dependency on poll timing and works for PRs not in the inbox.

## Architecture

### New IPC: `prs:reviewState`

Request: `{ host: PrHost; repoKey: string; number: number }`
Response: `{ amIAuthor: boolean; approved: boolean; mergeable: boolean; mergeBlockedReason: string | null }`

- Round-trips renderer → electron-main → orchestrator like the other `prs:*` kinds. Electron
  injects the decrypted `devopsPats` on the request (existing `ipc.ts` pattern for `prs:*`).
- Orchestrator handler resolves the repo config from `repoKey` (existing
  `ReviewsService` repo resolution), then:
  - **GitHub:** `gh pr view {number} --repo {nwo} --json author,reviewDecision,mergeable,mergeStateStatus`.
    `amIAuthor = author.login === myLogin` (via existing `resolveGithubLogin`). `approved =
    reviewDecision === 'APPROVED'`. `mergeable`/`mergeBlockedReason` derived from
    `mergeable`/`mergeStateStatus`.
  - **ADO:** fetch PR detail (reviewers + `mergeStatus`) with the PAT. Reuse the vote logic
    already in `parseAzdoPr` (`vote >= 10` ⇒ approved, any `vote < 0` ⇒ not approved).
    `amIAuthor = createdBy.id === myId` (via `resolveAzdoUser`). `mergeable`/reason derived
    from `mergeStatus`.

Both host paths take injectable `Exec` / `HttpGet` seams so they are unit-testable, matching
the existing provider style.

### New IPC: `prs:approve`

Request: `{ host: PrHost; repoKey: string; number: number }`
Response: `{ ok: true }` (errors thrown → surfaced as toast in the renderer).

- **GitHub:** `gh pr review {number} --repo {nwo} --approve`.
- **ADO:** `PUT {apiBase}/_apis/git/repositories/{repo}/pullRequests/{number}/reviewers/{myId}?api-version=7.1`
  with body `{ vote: 10 }`. This adds the caller as a reviewer if not already present and
  records an approving vote. `myId` from `resolveAzdoUser(apiBase, pat)`. New
  `approveAzdoPr(...)` mirrors the `HttpPatch`-style default in `merge.ts` (a `PUT` variant).

### ADO browse-list filter (`listAzdoPrs`)

Replace the single unfiltered query with the two-query merge pattern already proven in
`prWatch/queries.ts` `azdoWatched`:

```
GET {apiBase}/_apis/git/repositories/{repo}/pullrequests?searchCriteria.creatorId={myId}&searchCriteria.status=active&$top=100&api-version=7.1
GET {apiBase}/_apis/git/repositories/{repo}/pullrequests?searchCriteria.reviewerId={myId}&searchCriteria.status=active&$top=100&api-version=7.1
```

Merge results by `pullRequestId` (dedupe). `myId` from `resolveAzdoUser(apiBase, pat)`,
resolved once per DevOps host and cached on `ReviewsService` for the refresh cycle (avoid
re-hitting `connectionData` per repo). `listAzdoPrs` gains a `userId` parameter; its caller
in `ReviewsService.refresh` supplies the cached id.

### Renderer: `PrInspectorDrawer`

- On open (in the existing `useEffect` that loads diff/comments/review), also fetch
  `reviewState` for the PR and hold it in local state; show a small spinner on the action
  area while it loads.
- **Approve** button: rendered when `reviewState && !reviewState.amIAuthor`. On click calls
  `approvePr(host, repoKey, number)`; on success re-fetches `reviewState` so Merge updates
  immediately. Errors → `showError`.
- **Merge** button (`MergeButton`, unchanged internally): rendered always (drop the
  `watchItem.myRole === 'author'` guard), fed from `reviewState`
  (`approved`/`mergeable`/`mergeBlockedReason`). `enabled = approved && mergeable` stays.
- The `watchItem` prop dependency for merge is removed; the drawer no longer needs it for
  action state. (Leave `watchItem` wiring only if still used for other display; otherwise
  drop the prop.)

### State hook: `useReviews`

- Add `approvePr(host, repoKey, number)` → `prs:approve`.
- Add `fetchReviewState(host, repoKey, number)` → `prs:reviewState`.
- Follow the existing `mergePr` pattern (thin invoke wrappers; no PAT handling in renderer).

## Data flow

```
Drawer open
  → prs:reviewState  → orchestrator → gh/ADO detail → { amIAuthor, approved, mergeable, reason }
  → render Approve (if !amIAuthor) + Merge (enabled if approved && mergeable)

Approve click
  → prs:approve → gh pr review --approve  /  ADO PUT reviewers/{myId} {vote:10}
  → on success: re-fetch prs:reviewState → Merge lights up

Merge click  → existing prs:merge flow (unchanged)

Reviews refresh (ADO)
  → resolveAzdoUser (cached per host) → listAzdoPrs(creatorId) + listAzdoPrs(reviewerId) → dedupe
```

## Error handling

- `prs:reviewState` failure: drawer shows the action area in a neutral/disabled state with
  the error surfaced (inline or toast); diff/comments still render (independent loads, as
  today).
- `prs:approve` failure (incl. GitHub self-approval edge cases that slip through): `showError`
  toast with the host error text.
- ADO filter: if `resolveAzdoUser` fails for a host, that host's repos are skipped with a
  logged/surfaced error rather than falling back to the unfiltered list (do not silently show
  everyone's PRs again).

## Testing

- `listAzdoPrs` builds the two filtered URLs and dedupes overlapping PRs (unit, injected
  `HttpGet`).
- `approveAzdoPr` issues the correct `PUT …/reviewers/{myId}` URL and `{vote:10}` body (unit,
  injected PUT seam).
- GitHub approve builds `gh pr review {n} --repo {nwo} --approve` (unit, injected `Exec`).
- `reviewState` parse for both hosts: approved/not-approved, mergeable/blocked, amIAuthor
  true/false (unit, injected `HttpGet`/`Exec`).
- Keep the suite green (219+; add tests for new code per project rule).

## Out of scope

- No change to GitHub's browse list filtering.
- No "reject/vote-down" action, no approve-with-comment, no re-request-review.
- No schema/migration changes (all state is fetched live or already in `pr_watch_state`).
- No consolidation of the duplicated `defaultGet` auth helper (noted by exploration but a
  separate cleanup).
