# Reviews: notify + auto-remove on PR merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a PR in the Reviews list is merged (by anyone), fire a native macOS notification and remove it from the list live — within one PR-watch poll cycle, no manual Refresh.

**Architecture:** Piggyback on the existing PR-watch tick (60s focused / 300s unfocused). Each tick, `ReviewsService.backgroundRefresh` re-fetches the open-PR set, diffs it against the prior `cache`, and for PRs that disappeared *from a successfully-fetched repo* runs one targeted provider state query to classify merged vs closed. Merged → `notify` push (macOS banner, reusing the #181 path) + `NotificationsRepo.log`. The cache is replaced and a new `prsChanged` push tells `useReviews` to re-read the list.

**Tech Stack:** TypeScript; orchestrator (`orchestrator/services/reviews.ts`, `prProviders/`, `prWatch/`), shared contract (`packages/shared/src/{ipcContract,messagePort}.ts`), renderer (`apps/desktop/src/state/useReviews.ts`); Vitest (node env; tests in `tests/**`).

Design spec: `docs/superpowers/specs/2026-07-22-reviews-merged-pr-notification-design.md`.

## Global Constraints

- Renderer `apps/desktop/src/`; shared imported as `@watchtower/shared/<mod>.js`. Renderer IPC via `invoke` from `./ipc`; pushes via `window.watchtower.on(kind, handler)` (returns unsubscribe).
- Tests live in `tests/<area>/*.test.ts(x)`; vitest `environment: 'node'`, `@watchtower/shared` aliased to source. Orchestrator pure functions are unit-testable (see `tests/orchestrator/notificationBody.test.ts`). `ReviewsService` is fully DI (constructor deps) — test `backgroundRefresh` with fakes, no network.
- A PR's identity key is `` `${host}:${repoKey}:${number}` ``. The list is open-PRs-only already (GitHub `--state open`, ADO `status=active`).
- `notify` push payload (`ipcContract.ts` + mirror in `messagePort.ts`) has `event: WatchEvent['type']`, `target: 'pr'`, `{host, repoKey, prNumber, title, repoLabel, body}`. PR notifications log as `NotificationsRepo.log('pr:${host}:${repoKey}#${number}', 'pr-${event}', body, now)`.
- When adding an IPC push handled by the orchestrator, mirror it into `messagePort.ts` too (the orchestrator's push union is separate).
- UI text English; no i18n. Don't bypass hooks/signing. `git checkout -- package-lock.json` if a step churns it. Keep the suite green.
- Verify: `npm test`, `npm run typecheck`, `npm run build:main`. Run the suite with `WATCHTOWER_WS_HOST=127.0.0.1` if a running Watchtower app holds `:7445` (a pre-existing bootstrap-test env collision, not caused by this work).

---

## File Structure

**Create:**
- `orchestrator/services/reviews/detectMerged.ts` — pure diff (`prKey`, `detectListChange`).
- `tests/reviews/detectMerged.test.ts`.

**Modify:**
- `packages/shared/src/ipcContract.ts` — add `prsChanged` to `IpcPush`.
- `packages/shared/src/messagePort.ts` — mirror `prsChanged` in the orchestrator push union.
- `orchestrator/services/prWatch/types.ts` — add `{ type: 'merged' }` to `WatchEvent`.
- `orchestrator/index.ts` — `notificationBody` `case 'merged'`; wire `backgroundRefresh` into the PR-watch tick.
- `orchestrator/services/prProviders/github.ts` — `fetchGithubPrState`.
- `orchestrator/services/prProviders/azureDevops.ts` — `fetchAzdoPrState`.
- `orchestrator/services/reviews.ts` — extract `fetchOpenSet`; add `classifyMerged` + `backgroundRefresh`; new deps.
- `apps/desktop/src/state/useReviews.ts` — subscribe to `prsChanged`.
- `tests/orchestrator/notificationBody.test.ts` — add the `merged` case.

---

### Task 1: Contract + `merged` event + pure diff

**Files:**
- Modify: `packages/shared/src/ipcContract.ts`, `packages/shared/src/messagePort.ts`, `orchestrator/services/prWatch/types.ts`, `orchestrator/index.ts` (notificationBody only), `tests/orchestrator/notificationBody.test.ts`
- Create: `orchestrator/services/reviews/detectMerged.ts`, `tests/reviews/detectMerged.test.ts`

**Interfaces produced:**
- `prKey(pr: { host: string; repoKey: string; number: number }): string` → `` `${host}:${repoKey}:${number}` ``.
- `detectListChange(prev: PullRequestPayload[], open: PullRequestPayload[], succeededRepoKeys: ReadonlySet<string>): { nextCache: PullRequestPayload[]; candidates: PullRequestPayload[] }` — `nextCache` = the new open set plus retained prev PRs whose repo did NOT succeed this cycle (transient-failure protection); `candidates` = prev PRs whose repo DID succeed but are no longer open (merge/close candidates).
- `WatchEvent` gains `{ type: 'merged' }`; `IpcPush`/orch-push gain `prsChanged` (payload `Record<string, never>`).

- [ ] **Step 1: Write the failing test** — `tests/reviews/detectMerged.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prKey, detectListChange } from '../../orchestrator/services/reviews/detectMerged.js';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';

const pr = (repoKey: string, number: number): PullRequestPayload => ({
  host: repoKey.startsWith('gh') ? 'github' : 'azdo',
  repoKey, repoLabel: repoKey, number, title: `PR ${number}`, author: 'x',
  sourceBranch: 's', targetBranch: 't', url: 'u', updatedAt: '2026-07-22T00:00:00Z', reviewable: true,
});

describe('prKey', () => {
  it('joins host:repoKey:number', () => {
    expect(prKey(pr('gh:o/r', 7))).toBe('github:gh:o/r:7');
  });
});

describe('detectListChange', () => {
  it('flags a PR that disappeared from a succeeded repo as a candidate and drops it from nextCache', () => {
    const a = pr('gh:o/r', 1), b = pr('gh:o/r', 2);
    const res = detectListChange([a, b], [a], new Set(['gh:o/r']));
    expect(res.candidates.map((p) => p.number)).toEqual([2]);
    expect(res.nextCache.map((p) => p.number)).toEqual([1]);
  });

  it('retains PRs of a repo that FAILED this cycle and does not flag them', () => {
    const a = pr('gh:o/r', 1), b = pr('azdo:h/r', 9);
    // only the github repo succeeded; the azdo repo errored (not in succeeded set, none returned)
    const res = detectListChange([a, b], [a], new Set(['gh:o/r']));
    expect(res.candidates).toEqual([]); // b's repo didn't succeed → not a candidate
    expect(res.nextCache.map((p) => p.number).sort()).toEqual([1, 9]); // b retained
  });

  it('does not flag newly-appeared PRs (present in open, absent in prev)', () => {
    const a = pr('gh:o/r', 1);
    const res = detectListChange([], [a], new Set(['gh:o/r']));
    expect(res.candidates).toEqual([]);
    expect(res.nextCache.map((p) => p.number)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** — `npx vitest run tests/reviews/detectMerged.test.ts` (module missing).

- [ ] **Step 3: Create `orchestrator/services/reviews/detectMerged.ts`:**

```ts
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';

/** Stable identity for a PR across cycles. */
export function prKey(pr: { host: string; repoKey: string; number: number }): string {
  return `${pr.host}:${pr.repoKey}:${pr.number}`;
}

/**
 * Diff the prior open set against the freshly-fetched one.
 *  - `candidates`: PRs that were open last cycle, whose repo fetched OK this
 *    cycle, and are no longer open — i.e. merged or closed (to be classified).
 *  - `nextCache`: the new open set, plus prev PRs whose repo did NOT fetch this
 *    cycle (retain them — a transient repo failure must not clear the list or
 *    look like a merge).
 */
export function detectListChange(
  prev: PullRequestPayload[],
  open: PullRequestPayload[],
  succeededRepoKeys: ReadonlySet<string>,
): { nextCache: PullRequestPayload[]; candidates: PullRequestPayload[] } {
  const openKeys = new Set(open.map(prKey));
  const candidates = prev.filter(
    (p) => succeededRepoKeys.has(p.repoKey) && !openKeys.has(prKey(p)),
  );
  const retained = prev.filter(
    (p) => !succeededRepoKeys.has(p.repoKey) && !openKeys.has(prKey(p)),
  );
  return { nextCache: [...open, ...retained], candidates };
}
```

- [ ] **Step 4: Add the `merged` event + `prsChanged` push + notificationBody case.**
  - `orchestrator/services/prWatch/types.ts`: append to the `WatchEvent` union:
    ```ts
      | { type: 'merged' }
    ```
  - `packages/shared/src/ipcContract.ts`: add to `IpcPush`:
    ```ts
      | { kind: 'prsChanged'; payload: Record<string, never> }
    ```
  - `packages/shared/src/messagePort.ts`: add the identical `prsChanged` member to the orchestrator→main push union (find the union that already lists `prWatchEvent`/`prReviewDone` and mirror the style).
  - `orchestrator/index.ts` `notificationBody` switch: add
    ```ts
        case 'merged': return `"${pr.title}" was merged`;
    ```

- [ ] **Step 5: Add the notificationBody merged assertion** to `tests/orchestrator/notificationBody.test.ts` (mirror an existing case; a `WatchedPr` stub with `title` + `{ type: 'merged' }` → `'"<title>" was merged'`).

- [ ] **Step 6: Run — expect PASS** — `npx vitest run tests/reviews/detectMerged.test.ts tests/orchestrator/notificationBody.test.ts`.

- [ ] **Step 7:** `npm run typecheck` — clean (the new union members compile; `notify.event` now includes `'merged'`).

- [ ] **Step 8: Commit** — `git add` the six paths → `feat(reviews): merged-PR diff, 'merged' event, prsChanged push`.

---

### Task 2: Provider merge-state lookups

**Files:** Modify `orchestrator/services/prProviders/github.ts`, `orchestrator/services/prProviders/azureDevops.ts`.

**Interfaces produced:**
- `fetchGithubPrState(nwo: string, prNumber: number, exec?: Exec): Promise<{ merged: boolean }>` — `gh pr view <n> --repo <nwo> --json state` → `merged = (state === 'MERGED')`.
- `fetchAzdoPrState(repo: AzdoRepoConfig, prNumber: number, pat: string): Promise<{ merged: boolean }>` — GET the PR by id → `merged = (status === 'completed')`.

- [ ] **Step 1: GitHub** — add to `github.ts` (mirror `listGithubPrs`'s exec + JSON shape):

```ts
export async function fetchGithubPrState(nwo: string, prNumber: number, exec: Exec = defaultExec): Promise<{ merged: boolean }> {
  const out = await exec('gh', ['pr', 'view', String(prNumber), '--repo', nwo, '--json', 'state']);
  const { state } = JSON.parse(out) as { state?: string };
  return { merged: state === 'MERGED' };
}
```

- [ ] **Step 2: Azure DevOps** — add to `azureDevops.ts`. Read the file first for the existing REST GET helper + auth header pattern (the `fetchAzdoPrDetail`/`listAzdoPrs` functions show how a PR is fetched and how `pat`/`apiBase`/`repo` are used). Add:

```ts
export async function fetchAzdoPrState(repo: AzdoRepoConfig, prNumber: number, pat: string): Promise<{ merged: boolean }> {
  // GET {apiBase}/git/repositories/{repo}/pullrequests/{prNumber}?api-version=... → { status }
  // status: 'completed' (merged) | 'abandoned' (closed) | 'active'
  const raw = await <the file's existing GET helper>(repo, `/pullrequests/${prNumber}`, pat); // adapt to real signature
  const { status } = raw as { status?: string };
  return { merged: status === 'completed' };
}
```
Adapt the GET call to whatever helper/fetch idiom the file already uses (match `fetchAzdoPrDetail` exactly — same base URL construction, `api-version`, and `Authorization: Basic base64(':'+pat)` header). Do not introduce a new HTTP client.

- [ ] **Step 3:** `npm run typecheck` — clean. (No unit test — network glue; the classify path is exercised via `backgroundRefresh`'s injected fakes in Task 3.)

- [ ] **Step 4: Commit** — `git add orchestrator/services/prProviders/github.ts orchestrator/services/prProviders/azureDevops.ts` → `feat(reviews): provider PR merge-state lookups`.

---

### Task 3: `ReviewsService.backgroundRefresh` + tick wiring

**Files:** Modify `orchestrator/services/reviews.ts`, `orchestrator/index.ts`. Create `tests/reviews/backgroundRefresh.test.ts`.

**Interfaces:**
- Consumes: `detectListChange`/`prKey` (Task 1), `fetchGithubPrState`/`fetchAzdoPrState` (Task 2), `NotificationsRepo`.
- Produces: `ReviewsService.backgroundRefresh(devopsPats, hooks)` where `hooks = { notifyMerged(pr: PullRequestPayload): void; onListChanged(): void }`.

- [ ] **Step 1: Refactor `refresh` to reuse a `fetchOpenSet` that reports per-repo success.** In `reviews.ts`, extract the fetch loop into:

```ts
private async fetchOpenSet(devopsPats: Record<string, string> | undefined): Promise<{
  results: PullRequestPayload[]; errors: string[]; succeededRepoKeys: Set<string>;
}> {
  const results: PullRequestPayload[] = [];
  const errors: string[] = [];
  const succeededRepoKeys = new Set<string>();
  const { github, azdo } = await this.resolveRepos();
  for (const r of github) {
    try { results.push(...(await this.listGithub(r))); succeededRepoKeys.add(r.repoKey); }
    catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  for (const r of azdo) {
    const pat = devopsPats?.[r.devopsHost];
    if (!pat) { errors.push(`${r.repoLabel}: Azure DevOps PAT not set or unreadable — re-enter it in Reviews settings`); continue; }
    try { const user = await this.azdoUser(r.apiBase, pat); results.push(...(await this.listAzdo(r, pat, user.id))); succeededRepoKeys.add(r.repoKey); }
    catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { results, errors, succeededRepoKeys };
}
```
Rewrite `refresh()` to call it: `const { results, errors } = await this.fetchOpenSet(devopsPats);` then the existing `this.cache = results; this.syncedAt = isoNow();` + the total-vs-partial-failure handling (unchanged behavior).

- [ ] **Step 2: Add classify deps + `classifyMerged`.** Add to `ReviewsDeps` and the constructor (same optional-with-default pattern as the other provider fns):
```ts
  githubPrState?: (nwo: string, prNumber: number) => Promise<{ merged: boolean }>;
  azdoPrState?: (repo: AzdoRepoConfig, prNumber: number, pat: string) => Promise<{ merged: boolean }>;
```
defaults `((nwo, n) => fetchGithubPrState(nwo, n))` and `((r, n, pat) => fetchAzdoPrState(r, n, pat))` (import both). Then:
```ts
private async classifyMerged(pr: PullRequestPayload, devopsPats: Record<string, string> | undefined): Promise<boolean> {
  const { github, azdo } = await this.resolveRepos();
  if (pr.host === 'github') {
    const repo = github.find((r) => r.repoKey === pr.repoKey);
    if (!repo) return false;
    return (await this.githubPrStateFn(repo.nwo, pr.number)).merged;
  }
  const repo = azdo.find((r) => r.repoKey === pr.repoKey);
  const pat = repo ? devopsPats?.[repo.devopsHost] : undefined;
  if (!repo || !pat) return false;
  return (await this.azdoPrStateFn(repo, pr.number, pat)).merged;
}
```

- [ ] **Step 3: Add `backgroundRefresh`:**
```ts
async backgroundRefresh(
  devopsPats: Record<string, string> | undefined,
  hooks: { notifyMerged(pr: PullRequestPayload): void; onListChanged(): void },
): Promise<void> {
  const prev = this.cache;
  const { results, errors, succeededRepoKeys } = await this.fetchOpenSet(devopsPats);
  // Total failure (nothing fetched, all errored) → leave the list untouched, notify nothing.
  if (results.length === 0 && errors.length > 0 && succeededRepoKeys.size === 0) return;
  const { nextCache, candidates } = detectListChange(prev, results, succeededRepoKeys);
  for (const pr of candidates) {
    try {
      if (await this.classifyMerged(pr, devopsPats)) hooks.notifyMerged(pr);
    } catch (e) {
      // Classification failed (transient) — the PR is still removed from the list
      // (it left the open set of a succeeded repo); we simply skip the notification.
      console.error('[reviews] classifyMerged failed', prKey(pr), e);
    }
  }
  this.cache = nextCache;
  this.syncedAt = isoNow();
  this.warnings = errors;
  hooks.onListChanged();
}
```
Import `detectListChange, prKey` from `./reviews/detectMerged.js`.

- [ ] **Step 4: Wire into the PR-watch tick** (`orchestrator/index.ts`, inside `startPrWatch`'s `tick`, after `await watcher.cycle()`):
```ts
    try {
      await reviewsSvc().backgroundRefresh(watchPats, {
        notifyMerged: (pr) => {
          const body = `"${pr.title}" was merged`;
          emitPush({ kind: 'notify', payload: {
            target: 'pr', host: pr.host, repoKey: pr.repoKey, prNumber: pr.number,
            title: pr.title, repoLabel: pr.repoLabel, event: 'merged', body,
          } });
          try {
            new NotificationsRepo(handle!.db).log(`pr:${pr.host}:${pr.repoKey}#${pr.number}`, 'pr-merged', body, Date.now());
          } catch (err) { console.error('[reviews] merged notification log failed', err); }
        },
        onListChanged: () => emitPush({ kind: 'prsChanged', payload: {} }),
      });
    } catch (err) {
      console.error('[reviews] backgroundRefresh', err);
    }
```
(Place it before the focused/unfocused `setTimeout` reschedule. `reviewsSvc()`, `emitPush`, `NotificationsRepo`, `watchPats`, `handle` are all already in scope in this file.)

- [ ] **Step 5: Write the failing test** — `tests/reviews/backgroundRefresh.test.ts`. Construct a `ReviewsService` with injected fakes: `projects` returning one github + one azdo repo (so `resolveRepos` yields them — check `resolveRepos` needs `gitRemote` too; inject `gitRemote` to return a github/azdo remote per folder_path, OR inject `listGithub`/`listAzdo` and a `gitRemote` that yields the two repo configs). Simplest: inject `gitRemote` + `projects` so `resolveRepos` produces exactly a `gh:o/r` and an `azdo:h/r` repo, and inject `listGithub`/`listAzdo`/`githubPrState`/`azdoPrState` fakes. Prime `cache` by calling `refresh()` once (fakes return PRs 1 & 2), then have the fakes drop PR 2, with `githubPrState` reporting merged → assert `notifyMerged` called once with PR 2, `onListChanged` called, and `list().pullRequests` no longer contains PR 2. Add a second case: PR dropped but `githubPrState` says not merged → `notifyMerged` NOT called, but PR still removed. Third: fake `listGithub` throws (repo fails) while cache had its PRs → those PRs retained, `notifyMerged` not called.

Model the DI setup on any existing `tests/reviews/*.test.ts` or `tests/**` test that constructs `ReviewsService` with fakes (search for `new ReviewsService(` in tests to copy the exact fake-deps shape). Do NOT hit the network.

- [ ] **Step 6:** `npx vitest run tests/reviews/backgroundRefresh.test.ts` (pass), then `npm run typecheck`, `npm run build:main` — all clean.

- [ ] **Step 7: Commit** — `git add orchestrator/services/reviews.ts orchestrator/index.ts tests/reviews/backgroundRefresh.test.ts` → `feat(reviews): backgroundRefresh detects merges, notifies, pushes prsChanged`.

---

### Task 4: Renderer — live list update on `prsChanged`

**Files:** Modify `apps/desktop/src/state/useReviews.ts`. Create `tests/client/useReviewsPrsChanged.test.ts` (or add to an existing useReviews test if present).

- [ ] **Step 1: Subscribe.** In `useReviews`, add an effect (near the existing `prReviewDone`/`prReviewProgress` subscriptions) — but note `load` is a `useCallback`; subscribe using it as the dep:
```ts
  // A watched PR merged/closed externally → the orchestrator refreshed its cache
  // and pushed prsChanged. Re-read the list so the merged PR drops off live
  // (no manual Refresh). prs:list returns the already-refreshed cache — no network.
  useEffect(() => {
    const off = window.watchtower.on('prsChanged', () => { void load('prs:list'); });
    return () => { off(); };
  }, [load]);
```

- [ ] **Step 2: Test (jsdom).** Add `tests/client/useReviewsPrsChanged.test.ts`. Mirror the jsdom + `window.watchtower` stubbing pattern used by an existing `tests/client/use*.test.ts` (e.g. `usePrWatch.test.ts` — read it for how `window.watchtower.on`/`invoke` are mocked and how a push is simulated). Render `useReviews` via `@testing-library/react`'s `renderHook`, capture the `prsChanged` handler registered on the `window.watchtower.on` mock, fire it, and assert `invoke` was called again with `'prs:list'`. If `renderHook` isn't already used in the suite, follow whatever `usePrWatch.test.ts` does.

- [ ] **Step 3:** `npx vitest run tests/client/useReviewsPrsChanged.test.ts` (pass), `npm run typecheck` clean.

- [ ] **Step 4: Commit** — `git add apps/desktop/src/state/useReviews.ts tests/client/useReviewsPrsChanged.test.ts` → `feat(reviews): useReviews live-refreshes on prsChanged`.

---

### Task 5: Verification

- [ ] **Step 1:** `npm test` (with `WATCHTOWER_WS_HOST=127.0.0.1` if a Watchtower app is running) — full suite green incl. the new detectMerged, backgroundRefresh, notificationBody-merged, and useReviews-prsChanged tests.
- [ ] **Step 2:** `npm run typecheck` — clean across all workspaces.
- [ ] **Step 3:** `npm run build:main` — compiles.
- [ ] **Step 4: Manual smoke** (needs a real merged PR): with a PR in the Reviews list, merge it on GitHub/DevOps; within ~60s (app focused) confirm (a) a macOS notification `"<title>" was merged` fires and lands in notification history, and (b) the PR disappears from the Reviews list without pressing Refresh. Confirm a closed-without-merge PR disappears silently (no notification).
- [ ] **Step 5:** Commit any smoke fixes.
