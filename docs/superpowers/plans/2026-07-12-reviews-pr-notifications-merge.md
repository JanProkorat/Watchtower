# PR Notifications & Merge Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the user about PR activity (review requests on others' PRs; comments/reviews/approvals/changes-requested on their own PRs) and add a squash-merge button for their own approved, mergeable PRs — across both GitHub and Azure DevOps.

**Architecture:** A new orchestrator background service (`PrWatcher`) polls both providers on an adaptive timer, normalizes each PR into a provider-agnostic `WatchedPr`, diffs it against a persisted `pr_watch_state` row via a pure `computeEvents()` function, and emits one notification per new event through the existing `notify` push pipeline (extended to carry a PR target). A new `prs:merge` IPC performs the squash merge. The Reviews UI gains an unread badge and a merge button.

**Tech Stack:** TypeScript, Electron (main + renderer React/MUI v5), Node `utilityProcess` orchestrator, better-sqlite3 / node:sqlite, vitest. GitHub via `gh` CLI; Azure DevOps via `fetch` + safeStorage PAT.

## Global Constraints

- **UI text is English.** No i18n. Czech only for date/number/currency formatting. (Existing review findings are Czech for azdo — do not change that; new UI strings are English.)
- **Renderer path is `apps/desktop/src/`** (not `client/src/`).
- **Every new IPC kind is declared in BOTH** `packages/shared/src/ipcContract.ts` (request + response + push unions) **and** `packages/shared/src/messagePort.ts` (`OrchRequest` with an extra `id: string` field + `OrchResponse` + `OrchPush`). A kind missing from either place fails silently.
- **Testing convention:** inject dependencies (a last-arg `exec`/`get`/`post` async fn, or constructor deps) and override with plain async fns / `vi.fn()`. Do NOT `vi.mock()` node builtins.
- **Repo tests** build an in-memory DB via `new DatabaseSync(':memory:')` + `runMigrations(db)` (see `tests/orchestrator/reviewsService.test.ts`).
- **`npm test` must stay green at 219+ tests.** Typecheck via `npx tsc -p orchestrator/tsconfig.json --noEmit` and `npm run typecheck:ci` (covers all workspaces; CI gate).
- **`ReviewsService` is a true singleton** (`reviewsSvc()` in `orchestrator/index.ts:209`) because it caches PRs in-memory. The watcher must reuse that singleton, not construct its own.
- **Backup convention** applies to any `~/.claude/` file writes — not relevant here (no config-file writes in this feature).
- **DevOps "account-wide" scope:** GitHub is truly account-wide via `gh search prs`. Azure DevOps has a host-scoped PAT and no global cross-org PR search, so DevOps watching covers the set of `(host, org)` pairs derivable from configured DevOps project remotes. Documented limitation.
- Commit after every task with a `feat(reviews):` / `test(reviews):` message. Branch: `feat/reviews-pr-notifications` (already created).

---

## File Structure

**Create:**
- `orchestrator/db/repositories/prWatchState.ts` — `PrWatchStateRepo` over the new `pr_watch_state` table.
- `orchestrator/services/prWatch/computeEvents.ts` — pure dedup/delta engine (the core; provider-agnostic).
- `orchestrator/services/prWatch/identity.ts` — resolve "who am I" per provider.
- `orchestrator/services/prWatch/queries.ts` — account-wide PR + detail queries per provider, normalized to `WatchedPr`.
- `orchestrator/services/prWatch/merge.ts` — squash-merge per provider + approved/mergeable predicate.
- `orchestrator/services/prWatch/PrWatcher.ts` — the service that runs a poll cycle (queries → computeEvents → emit).
- `orchestrator/services/prWatch/types.ts` — shared `WatchedPr`, `WatchEvent`, `PrWatchStateRow` types.
- `apps/desktop/src/state/usePrWatch.ts` — renderer hook (inbox + unread count + prWatchEvent subscription).
- Test files mirroring each under `tests/orchestrator/` and `tests/client/`.

**Modify:**
- `packages/shared/src/ipcContract.ts` — extend `notify` push; add `prWatch:list`, `prWatch:markSeen`, `prs:merge` request/response; add `prWatchEvent` push.
- `packages/shared/src/messagePort.ts` — mirror all of the above.
- `orchestrator/db/migrations.ts` — append migration v21.
- `orchestrator/index.ts` — handlers for the 3 new kinds; watcher boot wiring; extended `notify` emitter.
- `electron/notifications.ts` — `FireOptions` + `fireMacNotification` carry a PR variant.
- `electron/ipc.ts` — `notify` receiver handles PR variant; add `prs:merge` to PAT-injection allowlist; deep-link routing.
- `apps/desktop/src/components/reviews/ModuleReviews.tsx` — unread badge / inbox affordance; open drawer on deep-link.
- `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx` (+ a small `MergeButton.tsx`) — merge button + confirm dialog.

---

## Phase 1 — Data & provider primitives

### Task 1: `pr_watch_state` table + repo (migration v21)

**Files:**
- Modify: `orchestrator/db/migrations.ts` (append v21 before the closing `];` of the migrations array, ~line 403)
- Create: `orchestrator/db/repositories/prWatchState.ts`
- Create: `orchestrator/services/prWatch/types.ts`
- Test: `tests/orchestrator/prWatchState.test.ts`

**Interfaces:**
- Produces: `PrWatchStateRow` (in `types.ts`), `PrWatchStateRepo` with `get(host, repoKey, prNumber): PrWatchStateRow | null`, `upsert(row: PrWatchStateRow): void`, `all(): PrWatchStateRow[]`, `prune(keep: {host,repoKey,prNumber}[]): number`.

- [ ] **Step 1: Write `types.ts` (shared shapes used across the phase)**

```ts
// orchestrator/services/prWatch/types.ts
import type { PrHost } from '@watchtower/shared/ipcContract.js';

export type MyRole = 'author' | 'reviewer';

/**
 * Persisted per-PR state. Two roles:
 *  - dedup high-water marks (reviewRequestedSeen / lastCommentTs / lastReviewTs);
 *  - current-state snapshot the merge button reads (title / approved / mergeable /
 *    mergeBlockedReason), refreshed every cycle.
 */
export interface PrWatchStateRow {
  host: PrHost;
  repoKey: string;
  repoLabel: string;
  prNumber: number;
  title: string;
  myRole: MyRole;
  reviewRequestedSeen: boolean;
  lastCommentTs: string | null; // ISO; newest comment already notified
  lastReviewTs: string | null;  // ISO; newest review already notified
  approved: boolean;
  mergeable: boolean;
  mergeBlockedReason: string | null;
  updatedAt: string;            // ISO
}

/** Provider-agnostic snapshot of a PR the user cares about, built each poll. */
export interface WatchedPr {
  host: PrHost;
  repoKey: string;    // stable id: gh 'owner/name' or azdo 'org/repo'
  repoLabel: string;
  prNumber: number;
  title: string;
  url: string;
  myRole: MyRole;
  reviewRequestedOfMe: boolean;
  comments: { author: string; ts: string }[];
  reviews: { author: string; state: 'approved' | 'changes_requested' | 'commented'; ts: string }[];
  /** Approval + mergeability, used by the merge button (author PRs only). */
  approved: boolean;
  mergeable: boolean;
  mergeBlockedReason: string | null;
}

export type WatchEvent =
  | { type: 'review_requested' }
  | { type: 'commented'; author: string }
  | { type: 'reviewed'; author: string }
  | { type: 'approved'; author: string }
  | { type: 'changes_requested'; author: string };
```

- [ ] **Step 2: Write the failing repo test**

```ts
// tests/orchestrator/prWatchState.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { PrWatchStateRepo } from '../../orchestrator/db/repositories/prWatchState.js';
import type { PrWatchStateRow } from '../../orchestrator/services/prWatch/types.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const db = new DatabaseSync(':memory:') as unknown as SqliteLike;
  runMigrations(db);
  return db;
}

const row = (over: Partial<PrWatchStateRow> = {}): PrWatchStateRow => ({
  host: 'github', repoKey: 'acme/widgets', repoLabel: 'widgets', prNumber: 42, title: 'Add thing',
  myRole: 'author', reviewRequestedSeen: false, lastCommentTs: null, lastReviewTs: null,
  approved: false, mergeable: false, mergeBlockedReason: null,
  updatedAt: '2026-07-12T00:00:00.000Z', ...over,
});

describe('PrWatchStateRepo', () => {
  let repo: PrWatchStateRepo;
  beforeEach(() => { repo = new PrWatchStateRepo(freshDb()); });

  it('get() returns null for an unseen PR', () => {
    expect(repo.get('github', 'acme/widgets', 42)).toBeNull();
  });

  it('upsert() then get() round-trips including booleans', () => {
    repo.upsert(row({ reviewRequestedSeen: true, lastCommentTs: '2026-07-12T01:00:00.000Z' }));
    const got = repo.get('github', 'acme/widgets', 42);
    expect(got).toEqual(row({ reviewRequestedSeen: true, lastCommentTs: '2026-07-12T01:00:00.000Z' }));
  });

  it('upsert() overwrites the same key', () => {
    repo.upsert(row({ lastReviewTs: null }));
    repo.upsert(row({ lastReviewTs: '2026-07-12T02:00:00.000Z' }));
    expect(repo.get('github', 'acme/widgets', 42)?.lastReviewTs).toBe('2026-07-12T02:00:00.000Z');
  });

  it('prune() deletes rows not in the keep list', () => {
    repo.upsert(row({ prNumber: 1 }));
    repo.upsert(row({ prNumber: 2 }));
    const deleted = repo.prune([{ host: 'github', repoKey: 'acme/widgets', prNumber: 1 }]);
    expect(deleted).toBe(1);
    expect(repo.get('github', 'acme/widgets', 2)).toBeNull();
    expect(repo.get('github', 'acme/widgets', 1)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the test — expect FAIL** (`PrWatchStateRepo` / migration missing)

Run: `npm test -- prWatchState`
Expected: FAIL (module not found / no such table `pr_watch_state`).

- [ ] **Step 4: Append migration v21**

Insert immediately before the closing `];` of the `migrations` array in `orchestrator/db/migrations.ts`:

```ts
  {
    version: 21,
    up: (db) => {
      // PR notifications: pr_watch_state holds per-PR high-water marks so the
      // PrWatcher only notifies on genuinely-new activity. Keyed by
      // (host, repo_key, pr_number). Booleans stored as 0/1.
      db.exec(`CREATE TABLE IF NOT EXISTS pr_watch_state (
        host                  TEXT    NOT NULL,
        repo_key              TEXT    NOT NULL,
        repo_label            TEXT    NOT NULL DEFAULT '',
        pr_number             INTEGER NOT NULL,
        title                 TEXT    NOT NULL DEFAULT '',
        my_role               TEXT    NOT NULL,
        review_requested_seen INTEGER NOT NULL DEFAULT 0,
        last_comment_ts       TEXT,
        last_review_ts        TEXT,
        approved              INTEGER NOT NULL DEFAULT 0,
        mergeable             INTEGER NOT NULL DEFAULT 0,
        merge_blocked_reason  TEXT,
        updated_at            TEXT    NOT NULL,
        PRIMARY KEY (host, repo_key, pr_number)
      )`);
    },
  },
```

- [ ] **Step 5: Write `PrWatchStateRepo`**

```ts
// orchestrator/db/repositories/prWatchState.ts
import type { SqliteLike } from '../migrations.js';
import type { PrHost } from '@watchtower/shared/ipcContract.js';
import type { PrWatchStateRow, MyRole } from '../../services/prWatch/types.js';

interface Raw {
  host: string; repo_key: string; repo_label: string; pr_number: number; title: string;
  my_role: string; review_requested_seen: number; last_comment_ts: string | null;
  last_review_ts: string | null; approved: number; mergeable: number;
  merge_blocked_reason: string | null; updated_at: string;
}

const toRow = (r: Raw): PrWatchStateRow => ({
  host: r.host as PrHost, repoKey: r.repo_key, repoLabel: r.repo_label, prNumber: r.pr_number,
  title: r.title, myRole: r.my_role as MyRole, reviewRequestedSeen: r.review_requested_seen === 1,
  lastCommentTs: r.last_comment_ts, lastReviewTs: r.last_review_ts,
  approved: r.approved === 1, mergeable: r.mergeable === 1, mergeBlockedReason: r.merge_blocked_reason,
  updatedAt: r.updated_at,
});

/** Repository for pr_watch_state (migration v21). */
export class PrWatchStateRepo {
  constructor(private db: SqliteLike) {}

  get(host: PrHost, repoKey: string, prNumber: number): PrWatchStateRow | null {
    const r = this.db
      .prepare(`SELECT * FROM pr_watch_state WHERE host = ? AND repo_key = ? AND pr_number = ?`)
      .get(host, repoKey, prNumber) as Raw | undefined;
    return r ? toRow(r) : null;
  }

  upsert(row: PrWatchStateRow): void {
    this.db
      .prepare(
        `INSERT INTO pr_watch_state
           (host, repo_key, repo_label, pr_number, title, my_role, review_requested_seen,
            last_comment_ts, last_review_ts, approved, mergeable, merge_blocked_reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(host, repo_key, pr_number) DO UPDATE SET
           repo_label = excluded.repo_label,
           title = excluded.title,
           my_role = excluded.my_role,
           review_requested_seen = excluded.review_requested_seen,
           last_comment_ts = excluded.last_comment_ts,
           last_review_ts = excluded.last_review_ts,
           approved = excluded.approved,
           mergeable = excluded.mergeable,
           merge_blocked_reason = excluded.merge_blocked_reason,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.host, row.repoKey, row.repoLabel, row.prNumber, row.title, row.myRole,
        row.reviewRequestedSeen ? 1 : 0, row.lastCommentTs, row.lastReviewTs,
        row.approved ? 1 : 0, row.mergeable ? 1 : 0, row.mergeBlockedReason, row.updatedAt,
      );
  }

  all(): PrWatchStateRow[] {
    return (this.db.prepare(`SELECT * FROM pr_watch_state`).all() as Raw[]).map(toRow);
  }

  /** Delete rows whose (host,repoKey,prNumber) is not in `keep`. Returns count deleted. */
  prune(keep: { host: PrHost; repoKey: string; prNumber: number }[]): number {
    const live = new Set(keep.map((k) => `${k.host} ${k.repoKey} ${k.prNumber}`));
    let deleted = 0;
    for (const r of this.all()) {
      if (!live.has(`${r.host} ${r.repoKey} ${r.prNumber}`)) {
        this.db.prepare(`DELETE FROM pr_watch_state WHERE host = ? AND repo_key = ? AND pr_number = ?`)
          .run(r.host, r.repoKey, r.prNumber);
        deleted++;
      }
    }
    return deleted;
  }
}
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `npm test -- prWatchState`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add orchestrator/db/migrations.ts orchestrator/db/repositories/prWatchState.ts orchestrator/services/prWatch/types.ts tests/orchestrator/prWatchState.test.ts
git commit -m "feat(reviews): pr_watch_state table + repo (migration v21)"
```

---

### Task 2: The `computeEvents` dedup engine (pure)

This is the heart of the feature. Pure function, no I/O — exhaustively unit-tested.

**Files:**
- Create: `orchestrator/services/prWatch/computeEvents.ts`
- Test: `tests/orchestrator/computeEvents.test.ts`

**Interfaces:**
- Consumes: `PrWatchStateRow`, `WatchedPr`, `WatchEvent` (Task 1 `types.ts`).
- Produces: `computeEvents(prev: PrWatchStateRow | null, pr: WatchedPr, me: string, now: string): { events: WatchEvent[]; next: PrWatchStateRow }`.

Rules:
- Activity authored by `me` never produces an event.
- First sighting (`prev === null`): seed `next` from the PR, emit **no** events.
- `review_requested`: role is reviewer, `pr.reviewRequestedOfMe`, and `!prev.reviewRequestedSeen`.
- `commented`: role is author; at most **one** event per cycle (latest new non-me comment) when any comment has `ts > prev.lastCommentTs`.
- reviews with `ts > prev.lastReviewTs` (author role, non-me): one event **per new review**, mapped `approved`→`approved`, `changes_requested`→`changes_requested`, `commented`→`reviewed`.
- `next` advances both high-water marks to the max seen and OR-s in `reviewRequestedSeen`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/computeEvents.test.ts
import { describe, it, expect } from 'vitest';
import { computeEvents } from '../../orchestrator/services/prWatch/computeEvents.js';
import type { WatchedPr, PrWatchStateRow } from '../../orchestrator/services/prWatch/types.js';

const NOW = '2026-07-12T12:00:00.000Z';
const basePr = (over: Partial<WatchedPr> = {}): WatchedPr => ({
  host: 'github', repoKey: 'acme/widgets', prNumber: 42, repoLabel: 'widgets',
  title: 'Add thing', url: 'https://x', myRole: 'author', reviewRequestedOfMe: false,
  comments: [], reviews: [], approved: false, mergeable: false, mergeBlockedReason: null, ...over,
});
const state = (over: Partial<PrWatchStateRow> = {}): PrWatchStateRow => ({
  host: 'github', repoKey: 'acme/widgets', repoLabel: 'widgets', prNumber: 42, title: 'Add thing',
  myRole: 'author', reviewRequestedSeen: false, lastCommentTs: null, lastReviewTs: null,
  approved: false, mergeable: false, mergeBlockedReason: null, updatedAt: NOW, ...over,
});

describe('computeEvents', () => {
  it('first sighting seeds state and emits nothing', () => {
    const pr = basePr({
      comments: [{ author: 'bob', ts: '2026-07-12T01:00:00.000Z' }],
      reviews: [{ author: 'bob', state: 'approved', ts: '2026-07-12T02:00:00.000Z' }],
    });
    const { events, next } = computeEvents(null, pr, 'me', NOW);
    expect(events).toEqual([]);
    expect(next.lastCommentTs).toBe('2026-07-12T01:00:00.000Z');
    expect(next.lastReviewTs).toBe('2026-07-12T02:00:00.000Z');
  });

  it('emits review_requested once for a reviewer PR', () => {
    const pr = basePr({ myRole: 'reviewer', reviewRequestedOfMe: true });
    const { events, next } = computeEvents(state({ myRole: 'reviewer' }), pr, 'me', NOW);
    expect(events).toEqual([{ type: 'review_requested' }]);
    expect(next.reviewRequestedSeen).toBe(true);
    // second poll: no repeat
    expect(computeEvents(next, pr, 'me', NOW).events).toEqual([]);
  });

  it('emits one commented event for new comments, ignoring my own', () => {
    const pr = basePr({
      comments: [
        { author: 'me', ts: '2026-07-12T03:00:00.000Z' },
        { author: 'bob', ts: '2026-07-12T04:00:00.000Z' },
      ],
    });
    const prev = state({ lastCommentTs: '2026-07-12T02:00:00.000Z' });
    const { events, next } = computeEvents(prev, pr, 'me', NOW);
    expect(events).toEqual([{ type: 'commented', author: 'bob' }]);
    expect(next.lastCommentTs).toBe('2026-07-12T04:00:00.000Z');
  });

  it('maps new review states to approved / changes_requested / reviewed', () => {
    const pr = basePr({
      reviews: [
        { author: 'ann', state: 'approved', ts: '2026-07-12T05:00:00.000Z' },
        { author: 'jim', state: 'changes_requested', ts: '2026-07-12T06:00:00.000Z' },
        { author: 'sue', state: 'commented', ts: '2026-07-12T07:00:00.000Z' },
      ],
    });
    const prev = state({ lastReviewTs: '2026-07-12T04:00:00.000Z' });
    const { events } = computeEvents(prev, pr, 'me', NOW);
    expect(events).toEqual([
      { type: 'approved', author: 'ann' },
      { type: 'changes_requested', author: 'jim' },
      { type: 'reviewed', author: 'sue' },
    ]);
  });

  it('emits nothing when nothing changed', () => {
    const pr = basePr({ comments: [{ author: 'bob', ts: '2026-07-12T04:00:00.000Z' }] });
    const prev = state({ lastCommentTs: '2026-07-12T04:00:00.000Z' });
    expect(computeEvents(prev, pr, 'me', NOW).events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`computeEvents` not defined)

Run: `npm test -- computeEvents`
Expected: FAIL.

- [ ] **Step 3: Implement `computeEvents`**

```ts
// orchestrator/services/prWatch/computeEvents.ts
import type { WatchedPr, WatchEvent, PrWatchStateRow } from './types.js';

const maxTs = (items: { ts: string }[], seed: string | null): string | null =>
  items.reduce<string | null>((acc, i) => (acc === null || i.ts > acc ? i.ts : acc), seed);

export function computeEvents(
  prev: PrWatchStateRow | null,
  pr: WatchedPr,
  me: string,
  now: string,
): { events: WatchEvent[]; next: PrWatchStateRow } {
  const seededComment = maxTs(pr.comments, null);
  const seededReview = maxTs(pr.reviews, null);

  const next: PrWatchStateRow = {
    host: pr.host, repoKey: pr.repoKey, repoLabel: pr.repoLabel, prNumber: pr.prNumber,
    title: pr.title, myRole: pr.myRole,
    reviewRequestedSeen: (prev?.reviewRequestedSeen ?? false) || pr.reviewRequestedOfMe,
    lastCommentTs: maxTs(pr.comments, prev?.lastCommentTs ?? null) ?? prev?.lastCommentTs ?? null,
    lastReviewTs: maxTs(pr.reviews, prev?.lastReviewTs ?? null) ?? prev?.lastReviewTs ?? null,
    approved: pr.approved, mergeable: pr.mergeable, mergeBlockedReason: pr.mergeBlockedReason,
    updatedAt: now,
  };

  // First sighting: seed silently so enabling the feature doesn't dump a backlog.
  if (prev === null) {
    return { events: [], next: { ...next, lastCommentTs: seededComment, lastReviewTs: seededReview } };
  }

  const events: WatchEvent[] = [];

  if (pr.myRole === 'reviewer' && pr.reviewRequestedOfMe && !prev.reviewRequestedSeen) {
    events.push({ type: 'review_requested' });
  }

  if (pr.myRole === 'author') {
    const newComments = pr.comments
      .filter((c) => c.author !== me && (prev.lastCommentTs === null || c.ts > prev.lastCommentTs))
      .sort((a, b) => a.ts.localeCompare(b.ts));
    if (newComments.length > 0) {
      events.push({ type: 'commented', author: newComments[newComments.length - 1].author });
    }

    const newReviews = pr.reviews
      .filter((r) => r.author !== me && (prev.lastReviewTs === null || r.ts > prev.lastReviewTs))
      .sort((a, b) => a.ts.localeCompare(b.ts));
    for (const r of newReviews) {
      if (r.state === 'approved') events.push({ type: 'approved', author: r.author });
      else if (r.state === 'changes_requested') events.push({ type: 'changes_requested', author: r.author });
      else events.push({ type: 'reviewed', author: r.author });
    }
  }

  return { events, next };
}
```

- [ ] **Step 4: Run — expect PASS** (5 tests)

Run: `npm test -- computeEvents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/prWatch/computeEvents.ts tests/orchestrator/computeEvents.test.ts
git commit -m "feat(reviews): pure computeEvents dedup engine for PR watcher"
```

---

### Task 3: Identity resolution

**Files:**
- Create: `orchestrator/services/prWatch/identity.ts`
- Test: `tests/orchestrator/prWatchIdentity.test.ts`

**Interfaces:**
- Consumes: `Exec` (from `orchestrator/services/prProviders/types.ts`), `HttpGet` (same).
- Produces:
  - `resolveGithubLogin(exec?: Exec): Promise<string>` — returns `login`.
  - `resolveAzdoUser(apiBase: string, pat: string, get?: HttpGet): Promise<{ id: string; displayName: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/prWatchIdentity.test.ts
import { describe, it, expect } from 'vitest';
import { resolveGithubLogin, resolveAzdoUser } from '../../orchestrator/services/prWatch/identity.js';

describe('identity', () => {
  it('resolveGithubLogin parses gh api user JSON', async () => {
    const exec = async () => JSON.stringify({ login: 'jan', id: 5 });
    expect(await resolveGithubLogin(exec)).toBe('jan');
  });

  it('resolveAzdoUser parses connectionData', async () => {
    const get = async () => ({ authenticatedUser: { id: 'guid-1', providerDisplayName: 'Jan P' } });
    expect(await resolveAzdoUser('https://devops.example/org', 'pat', get)).toEqual({ id: 'guid-1', displayName: 'Jan P' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- prWatchIdentity`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// orchestrator/services/prWatch/identity.ts
import type { Exec, HttpGet } from '../prProviders/types.js';
import { defaultExec } from '../prProviders/exec.js';

const defaultGet: HttpGet = async (url, pat) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} for ${url}`);
  return res.json();
};

export async function resolveGithubLogin(exec: Exec = defaultExec): Promise<string> {
  const out = await exec('gh', ['api', 'user', '--jq', '.login']);
  const login = out.trim();
  if (login) return login;
  // Fallback: full JSON payload.
  const full = JSON.parse(await exec('gh', ['api', 'user'])) as { login?: string };
  if (!full.login) throw new Error('Could not resolve GitHub login');
  return full.login;
}

export async function resolveAzdoUser(
  apiBase: string,
  pat: string,
  get: HttpGet = defaultGet,
): Promise<{ id: string; displayName: string }> {
  // apiBase is org-level (e.g. https://host/org). connectionData sits at that scope.
  const url = `${apiBase}/_apis/connectionData?api-version=7.1`;
  const data = (await get(url, pat)) as { authenticatedUser?: { id?: string; providerDisplayName?: string } };
  const u = data.authenticatedUser;
  if (!u?.id) throw new Error('Could not resolve Azure DevOps user');
  return { id: u.id, displayName: u.providerDisplayName ?? '' };
}
```

Note: `resolveGithubLogin`'s test injects an `exec` that ignores args and returns the login directly, satisfying the `--jq` path.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- prWatchIdentity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/prWatch/identity.ts tests/orchestrator/prWatchIdentity.test.ts
git commit -m "feat(reviews): resolve GitHub/Azure DevOps identity for PR watcher"
```

---

### Task 4: Account-wide PR queries → `WatchedPr[]`

Builds normalized `WatchedPr` snapshots per provider. Two GitHub queries (authored + review-requested) then a detail fetch per PR; DevOps queries per `(host, org)` then thread + vote parsing.

**Files:**
- Create: `orchestrator/services/prWatch/queries.ts`
- Test: `tests/orchestrator/prWatchQueries.test.ts`

**Interfaces:**
- Consumes: `Exec`, `HttpGet`, `WatchedPr`, identity results.
- Produces:
  - `githubWatched(login: string, exec?: Exec): Promise<WatchedPr[]>`
  - `azdoWatched(host: string, orgs: string[], user: { id: string }, pat: string, get?: HttpGet): Promise<WatchedPr[]>`
  - Internal parsers exported for testing: `parseGithubDetail(raw, login, role)`, `parseAzdoPr(raw, threads, userId, org, host)`.

- [ ] **Step 1: Write the failing test** (parser-level — no network)

```ts
// tests/orchestrator/prWatchQueries.test.ts
import { describe, it, expect } from 'vitest';
import { parseGithubDetail, parseAzdoPr } from '../../orchestrator/services/prWatch/queries.js';

describe('parseGithubDetail', () => {
  it('normalizes reviews, comments, and approval/mergeability', () => {
    const raw = {
      number: 42, title: 'Add thing', url: 'https://gh/pr/42',
      reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
      reviews: [{ author: { login: 'ann' }, state: 'APPROVED', submittedAt: '2026-07-12T02:00:00Z' }],
      comments: [{ author: { login: 'bob' }, createdAt: '2026-07-12T01:00:00Z' }],
    };
    const pr = parseGithubDetail(raw, 'acme/widgets', 'widgets', 'me', 'author');
    expect(pr.approved).toBe(true);
    expect(pr.mergeable).toBe(true);
    expect(pr.reviews).toEqual([{ author: 'ann', state: 'approved', ts: '2026-07-12T02:00:00Z' }]);
    expect(pr.comments).toEqual([{ author: 'bob', ts: '2026-07-12T01:00:00Z' }]);
  });

  it('reports mergeBlockedReason when not clean', () => {
    const raw = { number: 1, title: 't', url: 'u', reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviews: [], comments: [] };
    const pr = parseGithubDetail(raw, 'r', 'r', 'me', 'author');
    expect(pr.approved).toBe(false);
    expect(pr.mergeable).toBe(false);
    expect(pr.mergeBlockedReason).toMatch(/conflict/i);
  });
});

describe('parseAzdoPr', () => {
  it('maps votes to approval and threads to comments', () => {
    const raw = {
      pullRequestId: 7, title: 'AzDO PR', createdBy: { id: 'me' },
      reviewers: [{ id: 'ann', vote: 10 }],
      repository: { name: 'repo' },
      mergeStatus: 'succeeded',
    };
    const threads = [{ comments: [{ author: { uniqueName: 'ann' }, publishedDate: '2026-07-12T03:00:00Z' }] }];
    const pr = parseAzdoPr(raw, threads, 'me', 'org', 'https://host/org');
    expect(pr.repoKey).toBe('org/repo');
    expect(pr.approved).toBe(true);
    expect(pr.mergeable).toBe(true);
    expect(pr.comments).toEqual([{ author: 'ann', ts: '2026-07-12T03:00:00Z' }]);
    expect(pr.reviews).toEqual([{ author: 'ann', state: 'approved', ts: '2026-07-12T03:00:00Z' }]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- prWatchQueries`
Expected: FAIL.

- [ ] **Step 3: Implement `queries.ts`**

```ts
// orchestrator/services/prWatch/queries.ts
import type { Exec, HttpGet } from '../prProviders/types.js';
import { defaultExec } from '../prProviders/exec.js';
import type { WatchedPr, MyRole } from './types.js';

const API = 'api-version=7.1';
const GH_DETAIL = 'number,title,url,reviewDecision,mergeable,mergeStateStatus,reviews,comments';
const GH_SEARCH = 'number,repository';

const defaultGet: HttpGet = async (url, pat) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} for ${url}`);
  return res.json();
};

// ── GitHub ───────────────────────────────────────────────────────────────

interface GhReview { author?: { login?: string }; state?: string; submittedAt?: string }
interface GhComment { author?: { login?: string }; createdAt?: string }
interface GhDetail {
  number: number; title: string; url: string;
  reviewDecision?: string; mergeable?: string; mergeStateStatus?: string;
  reviews?: GhReview[]; comments?: GhComment[];
}

const GH_REVIEW_STATE: Record<string, 'approved' | 'changes_requested' | 'commented'> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', COMMENTED: 'commented',
};

export function parseGithubDetail(
  raw: GhDetail, repoKey: string, repoLabel: string, me: string, role: MyRole,
): WatchedPr {
  const approved = raw.reviewDecision === 'APPROVED';
  const clean = raw.mergeStateStatus === 'CLEAN' && raw.mergeable === 'MERGEABLE';
  const mergeBlockedReason = clean ? null
    : raw.mergeable === 'CONFLICTING' ? 'Merge conflicts'
    : raw.mergeStateStatus === 'BLOCKED' ? 'Required checks/approvals not satisfied'
    : `Not mergeable (${raw.mergeStateStatus ?? 'unknown'})`;
  return {
    host: 'github', repoKey, repoLabel, prNumber: raw.number, title: raw.title, url: raw.url,
    myRole: role,
    reviewRequestedOfMe: role === 'reviewer',
    comments: (raw.comments ?? [])
      .filter((c) => c.author?.login && c.createdAt)
      .map((c) => ({ author: c.author!.login!, ts: c.createdAt! })),
    reviews: (raw.reviews ?? [])
      .filter((r) => r.author?.login && r.submittedAt && GH_REVIEW_STATE[r.state ?? ''])
      .map((r) => ({ author: r.author!.login!, state: GH_REVIEW_STATE[r.state!], ts: r.submittedAt! })),
    approved,
    mergeable: clean,
    mergeBlockedReason,
  };
}

async function ghSearch(filter: string, exec: Exec): Promise<{ number: number; nwo: string }[]> {
  const out = await exec('gh', ['search', 'prs', filter, '--state', 'open', '--limit', '100', '--json', GH_SEARCH]).catch(() => '[]');
  const rows = JSON.parse(out) as { number: number; repository?: { nameWithOwner?: string } }[];
  return rows.filter((r) => r.repository?.nameWithOwner).map((r) => ({ number: r.number, nwo: r.repository!.nameWithOwner! }));
}

export async function githubWatched(login: string, exec: Exec = defaultExec): Promise<WatchedPr[]> {
  const authored = await ghSearch('--author=@me', exec);
  const requested = await ghSearch('--review-requested=@me', exec);
  const seen = new Set<string>();
  const out: WatchedPr[] = [];
  for (const { list, role } of [
    { list: authored, role: 'author' as MyRole },
    { list: requested, role: 'reviewer' as MyRole },
  ]) {
    for (const { number, nwo } of list) {
      const key = `${nwo}#${number}`;
      if (seen.has(key)) continue; // authored takes precedence
      seen.add(key);
      const detailJson = await exec('gh', ['pr', 'view', String(number), '--repo', nwo, '--json', GH_DETAIL]).catch(() => null);
      if (!detailJson) continue;
      out.push(parseGithubDetail(JSON.parse(detailJson) as GhDetail, nwo, nwo.split('/')[1] ?? nwo, login, role));
    }
  }
  return out;
}

// ── Azure DevOps ─────────────────────────────────────────────────────────

interface AzdoReviewer { id: string; vote?: number }
interface AzdoPrRaw {
  pullRequestId: number; title: string; createdBy?: { id?: string };
  reviewers?: AzdoReviewer[]; repository?: { name?: string }; mergeStatus?: string;
}
interface AzdoThread { comments?: { author?: { uniqueName?: string }; publishedDate?: string }[] }

export function parseAzdoPr(
  raw: AzdoPrRaw, threads: AzdoThread[], userId: string, org: string, apiBase: string,
): WatchedPr {
  const role: MyRole = raw.createdBy?.id === userId ? 'author' : 'reviewer';
  const repo = raw.repository?.name ?? 'repo';
  const approved = (raw.reviewers ?? []).some((r) => (r.vote ?? 0) >= 10)
    && !(raw.reviewers ?? []).some((r) => (r.vote ?? 0) < 0);
  const mergeable = raw.mergeStatus === 'succeeded';
  const comments = threads.flatMap((t) =>
    (t.comments ?? [])
      .filter((c) => c.author?.uniqueName && c.publishedDate)
      .map((c) => ({ author: c.author!.uniqueName!, ts: c.publishedDate! })),
  );
  // DevOps has no distinct "review submit" event; treat a non-author comment as a review signal,
  // and approving votes as the approval signal (timestamped with the latest thread activity).
  const latestTs = comments.reduce<string | null>((a, c) => (a === null || c.ts > a ? c.ts : a), null);
  const reviews = (raw.reviewers ?? [])
    .filter((r) => r.id !== userId && (r.vote ?? 0) !== 0 && latestTs)
    .map((r) => ({
      author: r.id,
      state: (r.vote ?? 0) >= 10 ? 'approved' as const
        : (r.vote ?? 0) < 0 ? 'changes_requested' as const : 'commented' as const,
      ts: latestTs!,
    }));
  return {
    host: 'azdo', repoKey: `${org}/${repo}`, repoLabel: repo, prNumber: raw.pullRequestId,
    title: raw.title, url: `${apiBase}/_git/${repo}/pullrequest/${raw.pullRequestId}`,
    myRole: role,
    reviewRequestedOfMe: role === 'reviewer',
    comments, reviews, approved,
    mergeable, mergeBlockedReason: mergeable ? null : `Merge status: ${raw.mergeStatus ?? 'unknown'}`,
  };
}

export async function azdoWatched(
  apiBase: string, org: string, user: { id: string }, pat: string, get: HttpGet = defaultGet,
): Promise<WatchedPr[]> {
  const base = `${apiBase}/_apis/git/pullrequests`;
  const q = `searchCriteria.status=active&$top=100&${API}`;
  const mine = (await get(`${base}?searchCriteria.creatorId=${user.id}&${q}`, pat).catch(() => ({ value: [] }))) as { value: AzdoPrRaw[] };
  const toReview = (await get(`${base}?searchCriteria.reviewerId=${user.id}&${q}`, pat).catch(() => ({ value: [] }))) as { value: AzdoPrRaw[] };
  const byId = new Map<number, AzdoPrRaw>();
  for (const p of [...mine.value, ...toReview.value]) byId.set(p.pullRequestId, p);
  const out: WatchedPr[] = [];
  for (const raw of byId.values()) {
    const repo = raw.repository?.name ?? '';
    const threadsUrl = `${apiBase}/_apis/git/repositories/${repo}/pullRequests/${raw.pullRequestId}/threads?${API}`;
    const threads = (await get(threadsUrl, pat).catch(() => ({ value: [] }))) as { value: AzdoThread[] };
    out.push(parseAzdoPr(raw, threads.value, user.id, org, apiBase));
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS** (4 tests)

Run: `npm test -- prWatchQueries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/prWatch/queries.ts tests/orchestrator/prWatchQueries.test.ts
git commit -m "feat(reviews): account-wide PR queries normalized to WatchedPr"
```

---

## Phase 2 — Watcher service + boot wiring

### Task 5: `PrWatcher` service (one poll cycle)

Ties queries + `computeEvents` + state repo together and returns the emitted events for the cycle. All I/O injected so the cycle is unit-testable end-to-end without network.

**Files:**
- Create: `orchestrator/services/prWatch/PrWatcher.ts`
- Test: `tests/orchestrator/prWatcher.test.ts`

**Interfaces:**
- Consumes: `PrWatchStateRepo`, `githubWatched`/`azdoWatched` (injectable), `resolveGithubLogin`/`resolveAzdoUser` (injectable), `WatchEvent`.
- Produces:
  - `interface PrWatcherDeps { repo: PrWatchStateRepo; fetchWatched: () => Promise<WatchedPr[]>; now: () => string; onEvent: (pr: WatchedPr, ev: WatchEvent) => void; }`
  - `class PrWatcher { constructor(deps: PrWatcherDeps); async cycle(): Promise<void>; }`

Rationale: identity + provider selection + PAT reading are composed into the single injected `fetchWatched` at construction time in `index.ts` (Task 7). The watcher itself only orchestrates fetch → diff → persist → emit → prune. `now` is injected (the repo/engine need timestamps; `Date.now()`/`new Date()` stay out of the pure engine's caller only where injected). 

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/prWatcher.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { PrWatchStateRepo } from '../../orchestrator/db/repositories/prWatchState.js';
import { PrWatcher } from '../../orchestrator/services/prWatch/PrWatcher.js';
import type { WatchedPr, WatchEvent } from '../../orchestrator/services/prWatch/types.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const pr = (over: Partial<WatchedPr> = {}): WatchedPr => ({
  host: 'github', repoKey: 'acme/widgets', prNumber: 42, repoLabel: 'widgets',
  title: 't', url: 'u', myRole: 'author', reviewRequestedOfMe: false,
  comments: [], reviews: [], approved: false, mergeable: false, mergeBlockedReason: null, ...over,
});

describe('PrWatcher.cycle', () => {
  let repo: PrWatchStateRepo;
  beforeEach(() => {
    const db = new DatabaseSync(':memory:') as unknown as SqliteLike;
    runMigrations(db);
    repo = new PrWatchStateRepo(db);
  });

  it('first cycle seeds silently, second cycle emits the delta', async () => {
    const events: { pr: WatchedPr; ev: WatchEvent }[] = [];
    let data: WatchedPr[] = [pr({ comments: [{ author: 'bob', ts: '2026-07-12T01:00:00.000Z' }] })];
    const watcher = new PrWatcher({
      repo,
      me: () => Promise.resolve({ github: 'me', azdo: new Map() }),
      fetchWatched: () => Promise.resolve(data),
      now: () => '2026-07-12T12:00:00.000Z',
      onEvent: (p, ev) => events.push({ pr: p, ev }),
    });

    await watcher.cycle();
    expect(events).toEqual([]); // seeded

    data = [pr({ comments: [
      { author: 'bob', ts: '2026-07-12T01:00:00.000Z' },
      { author: 'ann', ts: '2026-07-12T05:00:00.000Z' },
    ] })];
    await watcher.cycle();
    expect(events.map((e) => e.ev)).toEqual([{ type: 'commented', author: 'ann' }]);
  });

  it('prunes state rows for PRs no longer returned', async () => {
    const watcher = new PrWatcher({
      repo, me: () => Promise.resolve({ github: 'me', azdo: new Map() }),
      fetchWatched: () => Promise.resolve([pr({ prNumber: 1 })]),
      now: () => '2026-07-12T12:00:00.000Z', onEvent: () => {},
    });
    await watcher.cycle();
    repo.upsert({ host: 'github', repoKey: 'acme/widgets', repoLabel: 'widgets', prNumber: 99,
      title: 'stale', myRole: 'author', reviewRequestedSeen: false, lastCommentTs: null,
      lastReviewTs: null, approved: false, mergeable: false, mergeBlockedReason: null, updatedAt: 'x' });
    await watcher.cycle();
    expect(repo.get('github', 'acme/widgets', 99)).toBeNull();
    expect(repo.get('github', 'acme/widgets', 1)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- prWatcher`
Expected: FAIL.

- [ ] **Step 3: Implement `PrWatcher`**

```ts
// orchestrator/services/prWatch/PrWatcher.ts
import type { PrWatchStateRepo } from '../../db/repositories/prWatchState.js';
import { computeEvents } from './computeEvents.js';
import type { WatchedPr, WatchEvent } from './types.js';

export interface PrWatcherIdentity { github: string | null; azdo: Map<string, { id: string }> }

export interface PrWatcherDeps {
  repo: PrWatchStateRepo;
  me: () => Promise<PrWatcherIdentity>;
  fetchWatched: () => Promise<WatchedPr[]>;
  now: () => string;
  onEvent: (pr: WatchedPr, ev: WatchEvent) => void;
}

export class PrWatcher {
  constructor(private deps: PrWatcherDeps) {}

  async cycle(): Promise<void> {
    const id = await this.deps.me();
    const prs = await this.deps.fetchWatched();
    const now = this.deps.now();
    // `me` for author-side comparisons: github login covers gh PRs; for azdo we
    // compare on reviewer id inside the query parser already, so any azdo PR
    // reaching here has non-me activity — pass the github login as the scalar
    // `me`, azdo authors are already filtered by id in parseAzdoPr.
    const meScalar = id.github ?? ' ';

    for (const pr of prs) {
      const prev = this.deps.repo.get(pr.host, pr.repoKey, pr.prNumber);
      const { events, next } = computeEvents(prev, pr, meScalar, now);
      this.deps.repo.upsert(next);
      for (const ev of events) this.deps.onEvent(pr, ev);
    }

    this.deps.repo.prune(prs.map((p) => ({ host: p.host, repoKey: p.repoKey, prNumber: p.prNumber })));
  }
}
```

- [ ] **Step 4: Run — expect PASS** (2 tests)

Run: `npm test -- prWatcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/prWatch/PrWatcher.ts tests/orchestrator/prWatcher.test.ts
git commit -m "feat(reviews): PrWatcher poll cycle (fetch → diff → persist → emit → prune)"
```

---

### Task 6: Extend the `notify` push to carry a PR target

Shared-types change touching both contract files, the electron receiver, and `fireMacNotification`. No new behavior yet beyond type widening + native notification for the PR variant; consumed by Task 7's emitter.

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (notify push, ~848)
- Modify: `packages/shared/src/messagePort.ts` (OrchPush notify, ~611)
- Modify: `electron/notifications.ts` (FireOptions + fireMacNotification)
- Modify: `electron/ipc.ts` (notify receiver, ~16)
- Test: `tests/client/notifyPushType.test.ts` (compile-time shape guard via a typed fixture)

**Interfaces:**
- Produces: the `notify` push payload becomes a discriminated union:
  ```ts
  | { target?: 'instance'; instanceId: string; cwd: string; kind: 'waiting-permission' | 'idle-notify' }
  | { target: 'pr'; host: PrHost; repoKey: string; prNumber: number; title: string; repoLabel: string; event: string; body: string }
  ```
  (`target` optional-defaulting-to-instance keeps the existing instance emitter call sites unchanged.)

- [ ] **Step 1: Edit `ipcContract.ts` notify push**

Replace the `notify` push entry (currently lines ~848-851) with:

```ts
  | {
      kind: 'notify';
      payload:
        | { target?: 'instance'; instanceId: string; cwd: string; kind: 'waiting-permission' | 'idle-notify' }
        | {
            target: 'pr';
            host: PrHost;
            repoKey: string;
            prNumber: number;
            title: string;
            repoLabel: string;
            event: string; // WatchEvent['type']
            body: string;  // ready-to-display notification body
          };
    }
```

- [ ] **Step 2: Mirror in `messagePort.ts` OrchPush**

Replace the `notify` entry (~611-614) with the same union, using `import('./ipcContract.js').PrHost` for the host type:

```ts
  | {
      kind: 'notify';
      payload:
        | { target?: 'instance'; instanceId: string; cwd: string; kind: 'waiting-permission' | 'idle-notify' }
        | {
            target: 'pr';
            host: import('./ipcContract.js').PrHost;
            repoKey: string;
            prNumber: number;
            title: string;
            repoLabel: string;
            event: string;
            body: string;
          };
    }
```

- [ ] **Step 3: Extend `FireOptions` + `fireMacNotification` (`electron/notifications.ts`)**

Replace `FireOptions` and add PR handling. New shape:

```ts
export type FireOptions =
  | {
      target?: 'instance';
      instanceId: string;
      cwd: string;
      kind: 'waiting-permission' | 'idle-notify';
      onClick(instanceId: string): void;
    }
  | {
      target: 'pr';
      host: string;
      repoKey: string;
      prNumber: number;
      title: string;
      repoLabel: string;
      event: string;
      body: string;
      onClick(pr: { host: string; repoKey: string; prNumber: number }): void;
    };
```

In `fireMacNotification`, branch on `opts.target === 'pr'`: build a `Notification({ title: \`${opts.repoLabel} #${opts.prNumber}\`, body: opts.body })`, and on `'click'` call `opts.onClick({ host, repoKey, prNumber })`. Keep the existing instance branch unchanged (the `title`/`body`/`onClick(instanceId)` path). (Follow the existing `new Notification(...)` + `.on('click', ...)` construction already in the file.)

- [ ] **Step 4: Handle the PR variant in `electron/ipc.ts` notify receiver**

At the receiver (~16-19), branch on `msg.payload.target`:

```ts
  getOrchestrator().onPush((msg) => {
    if (msg.kind === 'notify') {
      const p = msg.payload;
      if (p.target === 'pr') {
        fireMacNotification({
          target: 'pr', host: p.host, repoKey: p.repoKey, prNumber: p.prNumber,
          title: p.title, repoLabel: p.repoLabel, event: p.event, body: p.body,
          onClick: (pr) => {
            focusMainWindow(); // existing window-restore helper used by the instance branch
            getMainWindow()?.webContents.send('deep-link', { module: 'reviews', ...pr });
          },
        });
        return;
      }
      // ...existing instance branch unchanged...
```

(Use whatever the file already calls to restore/focus the window in the instance branch — reuse it verbatim. The renderer subscribes to `deep-link` in Task 9.)

- [ ] **Step 5: Add a type-shape guard test**

```ts
// tests/client/notifyPushType.test.ts
import { describe, it, expect } from 'vitest';
import type { IpcPush } from '@watchtower/shared/ipcContract.js';

describe('notify push PR variant', () => {
  it('accepts a PR-target payload', () => {
    const msg: Extract<IpcPush, { kind: 'notify' }> = {
      kind: 'notify',
      payload: { target: 'pr', host: 'github', repoKey: 'acme/widgets', prNumber: 42,
        title: 't', repoLabel: 'widgets', event: 'approved', body: 'ann approved your PR' },
    };
    expect(msg.payload.target).toBe('pr');
  });
});
```

- [ ] **Step 6: Run typecheck + test**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm run typecheck:ci && npm test -- notifyPushType`
Expected: typecheck clean (existing known drift aside), test PASS. Fix any call site the compiler flags where `notify` payloads are constructed/consumed (the instance emitter in `index.ts` and the `NotificationsRepo.log` block — Task 7 updates these).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts electron/notifications.ts electron/ipc.ts tests/client/notifyPushType.test.ts
git commit -m "feat(reviews): extend notify push + macOS notification to carry a PR target"
```

---

### Task 7: Wire `PrWatcher` into orchestrator boot

Composes identity + PAT reading + provider queries into `fetchWatched`, builds notification bodies, emits the extended `notify` push, logs to `notifications`, emits `prWatchEvent`, and runs an adaptive poll loop.

**Files:**
- Modify: `orchestrator/index.ts` (accessor + boot wiring + emitter)
- Test: covered by `tests/orchestrator/prWatcher.test.ts` (cycle) — no new orchestrator-boot test (boot is integration-only; keep the unit boundary at `PrWatcher.cycle`).

**Interfaces:**
- Consumes: `reviewsSvc()` (for `resolveRepos()` → DevOps orgs), `getSetting` PAT map path (PATs arrive via the electron injection for user-triggered calls, but the watcher runs autonomously — read PATs directly through the existing settings decrypt path exposed to the orchestrator).
- Produces: `startPrWatch()` started at boot near `startTokenUsagePolling()`.

> **DevOps PAT note:** the orchestrator persists the encrypted PAT map under `reviews.devops.pats`, but decryption lives in electron main (`electron/devopsPat.ts` via `safeStorage`). The watcher runs in the orchestrator, which cannot `safeStorage.decryptString`. Resolve this by having electron main push the decrypted PAT map to the orchestrator once at startup (and on change) via a new lightweight internal call, OR gate DevOps watching on the PATs the renderer already forwards. **Chosen:** add a `prWatch:setPats` push from electron main → orchestrator (main already holds `getPats()`), cached in an orchestrator module variable the watcher reads. This mirrors how `devopsPats` is injected for `prs:refresh`. (If this proves heavy, fall back to GitHub-only watching until a PAT map is present — log the skip.)

- [ ] **Step 1: Add the PAT bridge push** (`prWatch:setPats`)

Add to `ipcContract.ts` + `messagePort.ts` a push (or reuse the request path): main → orch `{ kind: 'prWatch:setPats'; payload: { pats: Record<string,string> } }`. In `electron/ipc.ts` startup (after orchestrator ready), call `orch.invoke('prWatch:setPats', { pats: await getPats() })` and re-send on PAT change (in the `devops:setPat` handler). In `orchestrator/index.ts` add a module var `let watchPats: Record<string,string> = {};` and a handler case `case 'prWatch:setPats': watchPats = req.payload.pats; return { ok: true };`.

- [ ] **Step 2: Add `startPrWatch()` to `index.ts`**

```ts
// near startTokenUsagePolling()
import { PrWatcher } from './services/prWatch/PrWatcher.js';
import { githubWatched, azdoWatched } from './services/prWatch/queries.js';
import { resolveGithubLogin, resolveAzdoUser } from './services/prWatch/identity.js';
import { PrWatchStateRepo } from './db/repositories/prWatchState.js';
import { parseAzureRemote } from './services/prProviders/azureDevops.js';
import type { WatchedPr, WatchEvent } from './services/prWatch/types.js';

const PR_WATCH_FOCUSED_MS = 60_000;
const PR_WATCH_UNFOCUSED_MS = 300_000;

function notificationBody(pr: WatchedPr, ev: WatchEvent): string {
  switch (ev.type) {
    case 'review_requested': return `Review requested on “${pr.title}”`;
    case 'commented': return `${ev.author} commented on “${pr.title}”`;
    case 'reviewed': return `${ev.author} reviewed “${pr.title}”`;
    case 'approved': return `${ev.author} approved “${pr.title}”`;
    case 'changes_requested': return `${ev.author} requested changes on “${pr.title}”`;
  }
}

let prWatchTimer: ReturnType<typeof setTimeout> | null = null;

function startPrWatch(): void {
  const repo = new PrWatchStateRepo(handle!.db);

  const fetchWatched = async (): Promise<WatchedPr[]> => {
    const out: WatchedPr[] = [];
    // GitHub (truly account-wide)
    try {
      const login = await resolveGithubLogin();
      out.push(...(await githubWatched(login)));
    } catch (err) { console.error('[prWatch] github', err); }
    // Azure DevOps: one (host, org) per configured devops remote, if a PAT exists.
    try {
      const { azdo } = await reviewsSvc().resolveRepos();
      const orgs = new Map<string, { apiBase: string; devopsHost: string; org: string }>();
      for (const r of azdo) {
        const parsed = parseAzureRemote(`${r.apiBase}/_git/${r.repo}`);
        if (!parsed) continue;
        const org = new URL(parsed.apiBase).pathname.split('/').filter(Boolean)[0] ?? '';
        orgs.set(parsed.apiBase, { apiBase: parsed.apiBase, devopsHost: parsed.devopsHost, org });
      }
      for (const { apiBase, devopsHost, org } of orgs.values()) {
        const pat = watchPats[devopsHost];
        if (!pat) continue;
        const user = await resolveAzdoUser(apiBase, pat);
        out.push(...(await azdoWatched(apiBase, org, user, pat)));
      }
    } catch (err) { console.error('[prWatch] azdo', err); }
    return out;
  };

  const watcher = new PrWatcher({
    repo,
    me: async () => ({ github: null, azdo: new Map() }), // github login already applied in queries; scalar unused for azdo
    fetchWatched,
    now: () => new Date().toISOString(),
    onEvent: (pr, ev) => {
      const body = notificationBody(pr, ev);
      emitPush({
        kind: 'notify',
        payload: { target: 'pr', host: pr.host, repoKey: pr.repoKey, prNumber: pr.prNumber,
          title: pr.title, repoLabel: pr.repoLabel, event: ev.type, body },
      });
      try {
        new NotificationsRepo(handle!.db).log(`pr:${pr.host}:${pr.repoKey}#${pr.prNumber}`, `pr-${ev.type}`, body, Date.now());
      } catch { /* best-effort */ }
      emitPush({ kind: 'prWatchEvent', payload: { host: pr.host, repoKey: pr.repoKey, prNumber: pr.prNumber } });
    },
  });

  const tick = async (): Promise<void> => {
    try { await watcher.cycle(); } catch (err) { console.error('[prWatch] cycle', err); }
    const focused = isAnyWindowFocused(); // reuse the notifier's focus signal if available, else default true
    prWatchTimer = setTimeout(() => void tick(), focused ? PR_WATCH_FOCUSED_MS : PR_WATCH_UNFOCUSED_MS);
    prWatchTimer.unref?.();
  };
  void tick();
}
```

> Adjust `isAnyWindowFocused()` to whatever focus signal the `Notifier` already tracks (the scout found focus tracking inside `notifier.ts`); if not readily exposed, poll at `PR_WATCH_FOCUSED_MS` unconditionally and note the follow-up. The `me`/`azdo` scalar is unused because `githubWatched` already applies the login and `parseAzdoPr` filters the author by id — keep `meScalar` as the github login by passing it through if you prefer stricter dedup; the plan's `PrWatcher` reads `id.github`, so pass the resolved login there instead of `null` for correctness. **Correction to apply:** thread the resolved github login into `me()` so `computeEvents` filters self-comments on GitHub:

```ts
    me: async () => ({ github: await resolveGithubLogin().catch(() => null), azdo: new Map() }),
```

- [ ] **Step 3: Call `startPrWatch()` at boot**

Immediately after `startTokenUsagePolling();` (~line 1517):

```ts
    startPrWatch();
```

- [ ] **Step 4: Typecheck + full test suite**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm test`
Expected: typecheck clean, suite green (≥ 219 + the new tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/index.ts packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts electron/ipc.ts
git commit -m "feat(reviews): wire PrWatcher into boot with adaptive poll + PAT bridge"
```

---

## Phase 3 — Inbox IPC + renderer indicator

### Task 8: `prWatch:list` / `prWatch:markSeen` IPC + `prWatchEvent` push

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (request + response + push)
- Modify: `packages/shared/src/messagePort.ts` (mirror)
- Modify: `orchestrator/index.ts` (handlers + read from `notifications` + `pr_watch_state`)
- Test: `tests/orchestrator/prWatchInbox.test.ts`

**Interfaces:**
- Produces:
  - Request `{ kind: 'prWatch:list'; payload: Record<string, never> }` → Response `{ kind: 'prWatch:list'; payload: { items: PrWatchInboxItem[]; unread: number } }`
  - Request `{ kind: 'prWatch:markSeen'; payload: { host: PrHost; repoKey: string; prNumber: number } }` → `{ kind: 'prWatch:markSeen'; payload: { ok: true } }`
  - Push `{ kind: 'prWatchEvent'; payload: { host: PrHost; repoKey: string; prNumber: number } }`
  - New interface in `ipcContract.ts`:
    ```ts
    export interface PrWatchInboxItem {
      host: PrHost; repoKey: string; repoLabel: string; prNumber: number;
      title: string; myRole: 'author' | 'reviewer';
      approved: boolean; mergeable: boolean; mergeBlockedReason: string | null;
      latestEvent: string; latestAt: string; unread: boolean;
    }
    ```

Inbox source: `pr_watch_state` is the row-per-PR backbone (title/label/role/approved/mergeable). The `notifications` table rows whose `instance_id` starts with `pr:` (logged in Task 7) supply the latest event + unread flag. `markSeen` sets `dismissed_at` on the matching notification rows (reuse `NotificationsRepo`) — "unread" = the PR has an undismissed `pr:*` notification. A watched PR with no notification yet (seeded silently) still appears, with `unread: false` and `latestEvent: ''` — this is what the merge button reads for approved/mergeable.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/prWatchInbox.test.ts
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { buildInbox, markPrSeen } from '../../orchestrator/services/prWatch/inbox.js';
import { NotificationsRepo } from '../../orchestrator/db/repositories/notifications.js';
import { PrWatchStateRepo } from '../../orchestrator/db/repositories/prWatchState.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function db(): SqliteLike {
  const d = new DatabaseSync(':memory:') as unknown as SqliteLike;
  runMigrations(d);
  return d;
}

const seedRow = (d: SqliteLike, over = {}) =>
  new PrWatchStateRepo(d).upsert({
    host: 'github', repoKey: 'acme/w', repoLabel: 'w', prNumber: 42, title: 'Add thing',
    myRole: 'author', reviewRequestedSeen: false, lastCommentTs: null, lastReviewTs: null,
    approved: true, mergeable: true, mergeBlockedReason: null, updatedAt: '2026-07-12T00:00:00.000Z', ...over,
  });

describe('pr watch inbox', () => {
  it('lists a watched PR and marks it unread when it has an undismissed notification', () => {
    const d = db();
    seedRow(d);
    new NotificationsRepo(d).log('pr:github:acme/w#42', 'pr-approved', 'ann approved', Date.now());
    const { items, unread } = buildInbox(d);
    expect(unread).toBe(1);
    expect(items[0]).toMatchObject({ host: 'github', prNumber: 42, unread: true, latestEvent: 'pr-approved', approved: true, mergeable: true });
  });

  it('a silently-seeded PR appears but is not unread', () => {
    const d = db();
    seedRow(d);
    const { items, unread } = buildInbox(d);
    expect(unread).toBe(0);
    expect(items[0]).toMatchObject({ prNumber: 42, unread: false, latestEvent: '' });
  });

  it('markPrSeen dismisses and drops unread', () => {
    const d = db();
    seedRow(d);
    new NotificationsRepo(d).log('pr:github:acme/w#42', 'pr-approved', 'ann approved', Date.now());
    markPrSeen(d, 'github', 'acme/w', 42);
    expect(buildInbox(d).unread).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- prWatchInbox`
Expected: FAIL.

- [ ] **Step 3: Implement `orchestrator/services/prWatch/inbox.ts`**

```ts
// orchestrator/services/prWatch/inbox.ts
import type { SqliteLike } from '../../db/migrations.js';
import type { PrHost, PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';
import { PrWatchStateRepo } from '../../db/repositories/prWatchState.js';

interface NotifRow { instance_id: string; kind: string; fired_at: number; dismissed_at: number | null }

/** Newest undismissed-aware notification info per PR key `pr:host:repoKey#n`. */
function notifByPr(db: SqliteLike): Map<string, { latestEvent: string; latestAt: string; unread: boolean }> {
  const rows = db
    .prepare(`SELECT instance_id, kind, fired_at, dismissed_at FROM notifications WHERE instance_id LIKE 'pr:%' ORDER BY fired_at DESC`)
    .all() as NotifRow[];
  const out = new Map<string, { latestEvent: string; latestAt: string; unread: boolean }>();
  for (const r of rows) {
    const cur = out.get(r.instance_id);
    if (!cur) {
      out.set(r.instance_id, { latestEvent: r.kind, latestAt: new Date(r.fired_at).toISOString(), unread: r.dismissed_at == null });
    } else if (r.dismissed_at == null) {
      cur.unread = true;
    }
  }
  return out;
}

export function buildInbox(db: SqliteLike): { items: PrWatchInboxItem[]; unread: number } {
  const notif = notifByPr(db);
  const items: PrWatchInboxItem[] = new PrWatchStateRepo(db).all().map((s) => {
    const key = `pr:${s.host}:${s.repoKey}#${s.prNumber}`;
    const n = notif.get(key);
    return {
      host: s.host, repoKey: s.repoKey, repoLabel: s.repoLabel, prNumber: s.prNumber,
      title: s.title, myRole: s.myRole,
      approved: s.approved, mergeable: s.mergeable, mergeBlockedReason: s.mergeBlockedReason,
      latestEvent: n?.latestEvent ?? '', latestAt: n?.latestAt ?? s.updatedAt, unread: n?.unread ?? false,
    };
  }).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  return { items, unread: items.filter((i) => i.unread).length };
}

export function markPrSeen(db: SqliteLike, host: PrHost, repoKey: string, prNumber: number): void {
  db.prepare(`UPDATE notifications SET dismissed_at = ? WHERE instance_id = ? AND dismissed_at IS NULL`)
    .run(Date.now(), `pr:${host}:${repoKey}#${prNumber}`);
}
```

- [ ] **Step 4: Add the IPC kinds + handlers**

`ipcContract.ts` request union:
```ts
  | { kind: 'prWatch:list'; payload: Record<string, never> }
  | { kind: 'prWatch:markSeen'; payload: { host: PrHost; repoKey: string; prNumber: number } }
```
response union:
```ts
  | { kind: 'prWatch:list'; payload: { items: PrWatchInboxItem[]; unread: number } }
  | { kind: 'prWatch:markSeen'; payload: { ok: true } }
```
push union: `| { kind: 'prWatchEvent'; payload: { host: PrHost; repoKey: string; prNumber: number } }`.
Add the `PrWatchInboxItem` interface. Mirror all three in `messagePort.ts` (`OrchRequest` with `id: string`, `OrchResponse`, `OrchPush`, using `import('./ipcContract.js').PrHost`/`PrWatchInboxItem`).

`orchestrator/index.ts` handler cases:
```ts
    case 'prWatch:list':
      return buildInbox(handle!.db);
    case 'prWatch:markSeen': {
      const p = req.payload;
      markPrSeen(handle!.db, p.host, p.repoKey, p.prNumber);
      return { ok: true };
    }
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm test -- prWatchInbox && npx tsc -p orchestrator/tsconfig.json --noEmit && npm run typecheck:ci`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/index.ts orchestrator/services/prWatch/inbox.ts tests/orchestrator/prWatchInbox.test.ts
git commit -m "feat(reviews): PR-watch inbox IPC (list/markSeen) + prWatchEvent push"
```

---

### Task 9: Renderer inbox hook + unread badge + deep-link

**Files:**
- Create: `apps/desktop/src/state/usePrWatch.ts`
- Modify: `apps/desktop/src/components/reviews/ModuleReviews.tsx` (badge + open drawer on deep-link)
- Modify: electron preload (if needed) to forward the `deep-link` webContents message onto `window.watchtower.on('deep-link', …)` — verify the preload's event bridge; if `deep-link` isn't already bridged, add it alongside the existing push bridge.
- Test: `tests/client/usePrWatch.test.ts` (mirror `tests/client/useReviews.test.ts` harness)

**Interfaces:**
- Consumes: `prWatch:list`, `prWatch:markSeen`, `prWatchEvent`, `deep-link`.
- Produces: `usePrWatch()` → `{ items, unread, refresh, markSeen }`.

- [ ] **Step 1: Write the failing test** (following `tests/client/useReviews.test.ts` mock of `window.watchtower`)

```ts
// tests/client/usePrWatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePrWatch } from '../../apps/desktop/src/state/usePrWatch.js';

beforeEach(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) =>
      kind === 'prWatch:list'
        ? { items: [{ host: 'github', repoKey: 'acme/w', repoLabel: 'w', prNumber: 42, title: 'Add thing', myRole: 'author', approved: true, mergeable: true, mergeBlockedReason: null, latestEvent: 'pr-approved', latestAt: 'x', unread: true }], unread: 1 }
        : { ok: true }),
    on: vi.fn(() => () => {}),
  };
});

describe('usePrWatch', () => {
  it('loads the inbox and exposes unread count', async () => {
    const { result } = renderHook(() => usePrWatch());
    await waitFor(() => expect(result.current.unread).toBe(1));
    expect(result.current.items[0].prNumber).toBe(42);
  });

  it('markSeen invokes the IPC and refreshes', async () => {
    const { result } = renderHook(() => usePrWatch());
    await waitFor(() => expect(result.current.unread).toBe(1));
    await act(async () => { await result.current.markSeen('github', 'acme/w', 42); });
    expect((window as any).watchtower.invoke).toHaveBeenCalledWith('prWatch:markSeen', { host: 'github', repoKey: 'acme/w', prNumber: 42 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- usePrWatch`
Expected: FAIL.

- [ ] **Step 3: Implement `usePrWatch.ts`**

```ts
// apps/desktop/src/state/usePrWatch.ts
import { useCallback, useEffect, useState } from 'react';
import type { PrWatchInboxItem, PrHost } from '@watchtower/shared/ipcContract.js';

export function usePrWatch(): {
  items: PrWatchInboxItem[]; unread: number;
  refresh: () => Promise<void>;
  markSeen: (host: PrHost, repoKey: string, prNumber: number) => Promise<void>;
} {
  const [items, setItems] = useState<PrWatchInboxItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const res = await window.watchtower.invoke('prWatch:list', {});
    setItems(res.items);
    setUnread(res.unread);
  }, []);

  const markSeen = useCallback(async (host: PrHost, repoKey: string, prNumber: number) => {
    await window.watchtower.invoke('prWatch:markSeen', { host, repoKey, prNumber });
    await refresh();
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const off = window.watchtower.on('prWatchEvent', () => { void refresh(); });
    return () => { off(); };
  }, [refresh]);

  return { items, unread, refresh, markSeen };
}
```

- [ ] **Step 4: Wire the badge + deep-link in `ModuleReviews.tsx`**

- Call `const { unread, items, markSeen } = usePrWatch();` in `ModuleReviews`.
- Render an MUI `Badge badgeContent={unread} color="error"` on the module header (or expose `unread` upward so the Reviews **tab** shows it — if the tab strip lives in a parent, add a `reviews:unread` value via an App-level callback per the cross-module rule; simplest first pass: badge inside the module header).
- Subscribe to deep-link: `useEffect(() => window.watchtower.on('deep-link', (d) => { if (d.module === 'reviews') { /* find PR in pullRequests by host/repoKey/number, setOpen(pr); void markSeen(...) */ } }), [pullRequests]);`.
- On opening a PR drawer for a watched PR, call `markSeen(host, repoKey, number)`.

- [ ] **Step 5: Run test + typecheck**

Run: `npm test -- usePrWatch && npm run typecheck:ci`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/state/usePrWatch.ts apps/desktop/src/components/reviews/ModuleReviews.tsx tests/client/usePrWatch.test.ts
git commit -m "feat(reviews): renderer PR-watch inbox hook, unread badge, deep-link open"
```

---

## Phase 4 — Merge button

### Task 10: Merge provider functions + IPC

**Files:**
- Create: `orchestrator/services/prWatch/merge.ts`
- Modify: `packages/shared/src/ipcContract.ts` + `messagePort.ts` (`prs:merge`)
- Modify: `orchestrator/index.ts` (handler)
- Modify: `electron/ipc.ts` (add `prs:merge` to the PAT-injection allowlist ~124)
- Test: `tests/orchestrator/prMerge.test.ts`

**Interfaces:**
- Produces:
  - `mergeGithubPr(nwo: string, prNumber: number, deleteBranch: boolean, exec?: Exec): Promise<void>`
  - `mergeAzdoPr(apiBase: string, repo: string, prNumber: number, lastMergeSourceCommitId: string, deleteBranch: boolean, pat: string, patch?: HttpPatch): Promise<void>` where `type HttpPatch = (url: string, pat: string, body: unknown) => Promise<void>`
  - Request `{ kind: 'prs:merge'; payload: { host: PrHost; repoKey: string; prNumber: number; deleteBranch: boolean; devopsPats?: Record<string,string> } }` → Response `{ kind: 'prs:merge'; payload: { ok: true } }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/prMerge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mergeGithubPr, mergeAzdoPr } from '../../orchestrator/services/prWatch/merge.js';

describe('merge', () => {
  it('mergeGithubPr squashes with delete-branch', async () => {
    const exec = vi.fn(async () => '');
    await mergeGithubPr('acme/widgets', 42, true, exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'merge', '42', '--repo', 'acme/widgets', '--squash', '--delete-branch']);
  });

  it('mergeGithubPr omits --delete-branch when false', async () => {
    const exec = vi.fn(async () => '');
    await mergeGithubPr('acme/widgets', 42, false, exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'merge', '42', '--repo', 'acme/widgets', '--squash']);
  });

  it('mergeAzdoPr PATCHes completed with squash', async () => {
    const patch = vi.fn(async () => {});
    await mergeAzdoPr('https://host/org', 'repo', 7, 'sha123', true, 'pat', patch);
    const [url, , body] = patch.mock.calls[0];
    expect(url).toContain('/pullRequests/7');
    expect(body).toMatchObject({
      status: 'completed',
      lastMergeSourceCommit: { commitId: 'sha123' },
      completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: true },
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- prMerge`
Expected: FAIL.

- [ ] **Step 3: Implement `merge.ts`**

```ts
// orchestrator/services/prWatch/merge.ts
import type { Exec } from '../prProviders/types.js';
import { defaultExec } from '../prProviders/exec.js';

const API = 'api-version=7.1';

export async function mergeGithubPr(
  nwo: string, prNumber: number, deleteBranch: boolean, exec: Exec = defaultExec,
): Promise<void> {
  const args = ['pr', 'merge', String(prNumber), '--repo', nwo, '--squash'];
  if (deleteBranch) args.push('--delete-branch');
  await exec('gh', args);
}

export type HttpPatch = (url: string, pat: string, body: unknown) => Promise<void>;

const defaultPatch: HttpPatch = async (url, pat, body) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} completing PR: ${await res.text().catch(() => '')}`);
};

export async function mergeAzdoPr(
  apiBase: string, repo: string, prNumber: number, lastMergeSourceCommitId: string,
  deleteBranch: boolean, pat: string, patch: HttpPatch = defaultPatch,
): Promise<void> {
  const url = `${apiBase}/_apis/git/repositories/${repo}/pullRequests/${prNumber}?${API}`;
  await patch(url, pat, {
    status: 'completed',
    lastMergeSourceCommit: { commitId: lastMergeSourceCommitId },
    completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: deleteBranch },
  });
}
```

- [ ] **Step 4: Run — expect PASS** (3 tests)

Run: `npm test -- prMerge`
Expected: PASS.

- [ ] **Step 5: Add `prs:merge` IPC + handler + injection**

Add request/response to both shared files (mirror pattern). In `electron/ipc.ts` extend the allowlist condition at ~124 to include `kind === 'prs:merge'`. In `orchestrator/index.ts`:

```ts
    case 'prs:merge': {
      const p = req.payload;
      if (p.host === 'github') {
        const target = await reviewsSvc().resolveRepoAndPr(p.host, p.repoKey, p.prNumber);
        // repoKey for github is the nwo (owner/name); resolveRepoAndPr gives clone path — nwo from repoKey.
        await mergeGithubPr(p.repoKey.replace(/^gh:/, ''), p.prNumber, p.deleteBranch);
      } else {
        const pats = (p as { devopsPats?: Record<string, string> }).devopsPats ?? {};
        // resolve apiBase/repo + lastMergeSourceCommit via the azdo PR detail
        const info = await reviewsSvc().resolveRepoAndPr(p.host, p.repoKey, p.prNumber);
        if (!info) throw new Error('Cannot resolve DevOps PR for merge');
        // apiBase/repo/host derived from info; PAT looked up by devopsHost.
        // (Implement resolveRepoAndPr to also surface apiBase/repo/devopsHost/lastMergeSourceCommitId for azdo,
        //  or add a dedicated reviewsSvc().azdoMergeTarget(repoKey, prNumber) helper — see note.)
        await mergeAzdoPr(info.apiBase, info.repo, p.prNumber, info.lastMergeSourceCommitId, p.deleteBranch, pats[info.devopsHost]);
      }
      return { ok: true };
    }
```

> **Note:** `resolveRepoAndPr`'s current return (`ResolvedReviewTarget`) exposes clone/branch/head fields for the review agent but not `apiBase`/`repo`/`devopsHost`/`lastMergeSourceCommitId`. Add a small `azdoMergeTarget(repoKey, prNumber)` method to `ReviewsService` that returns those from its `cache` + a fresh azdo PR GET, rather than overloading `resolveRepoAndPr`. For GitHub, `gh pr merge` needs only the nwo (already in `repoKey`). Keep this helper covered by a `reviewsService.test.ts` addition (mock the azdo GET) if time permits; otherwise it's exercised by the manual smoke in Task 12.

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm run typecheck:ci && npm test`
Expected: clean + green.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/services/prWatch/merge.ts packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts orchestrator/index.ts electron/ipc.ts tests/orchestrator/prMerge.test.ts
git commit -m "feat(reviews): squash-merge provider functions + prs:merge IPC"
```

---

### Task 11: Merge button UI + confirm dialog

**Files:**
- Create: `apps/desktop/src/components/reviews/MergeButton.tsx`
- Modify: `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx` (render `MergeButton`)
- Modify: `apps/desktop/src/state/useReviews.ts` (add `mergePr` + expose approval/mergeability from the watched inbox or a fresh detail)
- Test: `tests/client/mergeButton.test.tsx`

**Interfaces:**
- Consumes: `usePrWatch` inbox items keyed by `(host, repoKey, prNumber)`. `approved`/`mergeable`/`mergeBlockedReason`/`myRole` already flow from `pr_watch_state` → `PrWatchInboxItem` (widened in Tasks 1/8), so the renderer has them with no extra round-trip. If the open PR has no inbox item (never polled yet), fall back to the button disabled with tooltip "Not yet approved".
- Produces: `mergePr(host, repoKey, prNumber, deleteBranch): Promise<void>` on `useReviews`.

- [ ] **Step 1: Write the failing component test**

```tsx
// tests/client/mergeButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MergeButton } from '../../apps/desktop/src/components/reviews/MergeButton.js';

describe('MergeButton', () => {
  it('is disabled with a reason when not mergeable', () => {
    render(<MergeButton approved mergeable={false} mergeBlockedReason="Merge conflicts" onMerge={vi.fn()} />);
    expect(screen.getByRole('button', { name: /merge/i })).toBeDisabled();
  });

  it('opens confirm and calls onMerge with deleteBranch', async () => {
    const onMerge = vi.fn(async () => {});
    render(<MergeButton approved mergeable mergeBlockedReason={null} onMerge={onMerge} />);
    fireEvent.click(screen.getByRole('button', { name: /merge/i }));
    fireEvent.click(await screen.findByRole('button', { name: /squash & merge/i }));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith(true));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- mergeButton`
Expected: FAIL.

- [ ] **Step 3: Implement `MergeButton.tsx`**

```tsx
// apps/desktop/src/components/reviews/MergeButton.tsx
import { useState } from 'react';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox, Tooltip } from '@mui/material';

export function MergeButton(props: {
  approved: boolean;
  mergeable: boolean;
  mergeBlockedReason: string | null;
  onMerge: (deleteBranch: boolean) => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  const enabled = props.approved && props.mergeable;
  const reason = !props.approved ? 'Not yet approved' : props.mergeBlockedReason ?? '';

  const btn = (
    <span>
      <Button variant="contained" color="success" disabled={!enabled} onClick={() => setOpen(true)}>
        Merge
      </Button>
    </span>
  );

  return (
    <>
      {enabled ? btn : <Tooltip title={reason}>{btn}</Tooltip>}
      <Dialog open={open} onClose={() => !busy && setOpen(false)}>
        <DialogTitle>Squash & merge this PR?</DialogTitle>
        <DialogContent>
          <FormControlLabel
            control={<Checkbox checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />}
            label="Delete source branch after merge"
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" disabled={busy}
            onClick={async () => { setBusy(true); try { await props.onMerge(deleteBranch); setOpen(false); } finally { setBusy(false); } }}>
            Squash & merge
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- mergeButton`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into `PrInspectorDrawer` + `useReviews.mergePr`**

- Add `mergePr` to `useReviews.ts`:
  ```ts
  const mergePr = useCallback(async (host: PrHost, repoKey: string, prNumber: number, deleteBranch: boolean) => {
    await window.watchtower.invoke('prs:merge', { host, repoKey, prNumber, deleteBranch });
    await refresh();
  }, [refresh]);
  ```
  and return it.
- In `PrInspectorDrawer`, look up the open PR's `approved/mergeable/mergeBlockedReason` from the `usePrWatch` inbox item (passed in as props from `ModuleReviews`), render `<MergeButton ... onMerge={(del) => mergePr(pr.host, pr.repoKey, pr.number, del).catch(showError)} />` in the drawer header next to the existing tabs, gated on the PR being the user's own (`myRole === 'author'` — surface `myRole` on the inbox item too, or only show the button when an inbox item exists with role author). Surface merge errors via the drawer's existing `showError` / error `Alert`.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm run typecheck:ci && npm test`
Expected: clean + green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/reviews/MergeButton.tsx apps/desktop/src/components/reviews/PrInspectorDrawer.tsx apps/desktop/src/state/useReviews.ts tests/client/mergeButton.test.tsx
git commit -m "feat(reviews): merge button with squash confirm + delete-branch"
```

---

## Phase 5 — Verification

### Task 12: End-to-end verification & smoke

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx tsc -p client/tsconfig.json --noEmit && npm run typecheck:ci`
Expected: no NEW errors (pre-existing drift documented in CLAUDE.md is acceptable; the CI `typecheck:ci` gate must pass).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green, count ≥ 219 + the ~11 new test files added here.

- [ ] **Step 3: Migration sanity across engines**

Run: `npm test -- migrations` (and any node:sqlite migration test)
Expected: v21 applies cleanly. (CREATE TABLE only — no ADD COLUMN engine-divergence risk; see the SQLite engine-divergence note in CLAUDE.md.)

- [ ] **Step 4: Manual dev smoke** (`npm run dev`)

Verify, in order:
1. App boots, orchestrator does not crash (watch the console for `[prWatch]` errors).
2. Open the Reviews module — existing PR list still works.
3. With a real GitHub PR you authored, have someone (or a second account) comment/approve → within ~60s a macOS notification fires; clicking it focuses the window and opens that PR's drawer; the Reviews unread badge increments and clears on open.
4. A review-requested PR on a repo you have NOT configured as a project appears as a `review_requested` notification (account-wide GitHub).
5. Approve one of your own PRs → the **Merge** button enables; a conflicted/red-checks PR shows it disabled with the tooltip reason.
6. Click Merge → confirm dialog → squash-merge succeeds; PR leaves the list; watch-state row pruned next cycle.
7. Repeat 3/5 against an Azure DevOps PR (requires a configured DevOps project + PAT).

- [ ] **Step 5: Final commit / PR**

```bash
git add -A && git commit -m "test(reviews): verify PR notifications + merge end-to-end"
```
Then open a PR from `feat/reviews-pr-notifications` → `main`.

---

## Self-Review notes (author)

- **Spec §3 events** → Tasks 2/4/5 (all five event types in `computeEvents` + `notificationBody`). ✓
- **Spec §4 dedup / first-sighting-silent** → Task 2 (`prev === null` seeds, no events) + Task 5 (persist). ✓
- **Spec §5 notifications (macOS + in-app badge + notifications table + deep-link)** → Tasks 6, 7, 8, 9. ✓
- **Spec §6 merge (approved+mergeable gate, squash, delete-branch, tooltip, error surface)** → Tasks 10, 11. ✓
- **Spec §7 IPC (prWatch:list, prWatch:markSeen, prs:merge, prWatchEvent)** → Tasks 8, 10. ✓
- **Spec §Testing (dedup, identity, approved/mergeable predicate, migration, mocked network)** → Tasks 1–5, 10, 11 unit tests; Task 12 suite. ✓
- **Account-wide (GitHub true; DevOps org-scoped)** → Task 4 + Task 7 fetchWatched, documented in Global Constraints. ✓
- **Open risks flagged inline (not placeholders), each with a chosen resolution to apply at that task — do not defer:** (a) the orchestrator can't `safeStorage.decrypt`, so DevOps PATs reach the watcher via a `prWatch:setPats` bridge push from electron main → Task 7 Step 1; (b) `resolveRepoAndPr` lacks the azdo merge fields (`apiBase`/`repo`/`devopsHost`/`lastMergeSourceCommitId`), so add a dedicated `ReviewsService.azdoMergeTarget()` helper rather than overloading it → Task 10 Step 5 note. (c) RESOLVED IN-PLAN: `pr_watch_state` and `PrWatchInboxItem` carry `title`/`repoLabel`/`approved`/`mergeable`/`mergeBlockedReason`/`myRole` from Task 1 onward, so the merge button reads them with no extra fetch.
