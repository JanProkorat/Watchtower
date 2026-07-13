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
