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
