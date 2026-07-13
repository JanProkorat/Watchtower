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

  it('isolates a per-PR failure: other PRs still process and prune still runs', async () => {
    let data: WatchedPr[] = [
      pr({ prNumber: 1, comments: [{ author: 'bob', ts: '2026-07-12T01:00:00.000Z' }] }),
      pr({ prNumber: 2, comments: [{ author: 'bob', ts: '2026-07-12T01:00:00.000Z' }] }),
    ];
    const watcher = new PrWatcher({
      repo,
      me: () => Promise.resolve({ github: 'me', azdo: new Map() }),
      fetchWatched: () => Promise.resolve(data),
      now: () => '2026-07-12T12:00:00.000Z',
      onEvent: (p, ev) => {
        if (p.prNumber === 1) throw new Error('boom onEvent for pr 1');
        void ev;
      },
    });

    // First cycle seeds both silently (no onEvent calls, so no throw yet).
    await watcher.cycle();

    // Pre-seed a stale row for a PR that fetchWatched will stop returning,
    // proving prune() still runs even though pr 1 will blow up below.
    repo.upsert({
      host: 'github', repoKey: 'acme/widgets', repoLabel: 'widgets', prNumber: 99,
      title: 'stale', myRole: 'author', reviewRequestedSeen: false, lastCommentTs: null,
      lastReviewTs: null, approved: false, mergeable: false, mergeBlockedReason: null, updatedAt: 'x',
    });

    // Second cycle: both PRs get a new comment from someone else, so both
    // produce a 'commented' event. onEvent throws for pr 1's event only.
    data = [
      pr({ prNumber: 1, comments: [
        { author: 'bob', ts: '2026-07-12T01:00:00.000Z' },
        { author: 'ann', ts: '2026-07-12T05:00:00.000Z' },
      ] }),
      pr({ prNumber: 2, comments: [
        { author: 'bob', ts: '2026-07-12T01:00:00.000Z' },
        { author: 'ann', ts: '2026-07-12T05:00:00.000Z' },
      ] }),
    ];

    await expect(watcher.cycle()).resolves.toBeUndefined();

    // PR 2 was still processed and upserted with the new comment timestamp
    // despite PR 1 throwing during its own processing.
    const pr2State = repo.get('github', 'acme/widgets', 2);
    expect(pr2State).not.toBeNull();
    expect(pr2State?.lastCommentTs).toBe('2026-07-12T05:00:00.000Z');

    // prune() still ran after the loop despite the per-PR failure.
    expect(repo.get('github', 'acme/widgets', 99)).toBeNull();
  });
});
