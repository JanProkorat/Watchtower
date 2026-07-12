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

  it('stale snapshot does not regress high-water mark for comments and reviews', () => {
    // Simulate a paginated provider response with only an old comment.
    // Previous state has a later timestamp from a prior poll.
    const pr = basePr({
      comments: [{ author: 'bob', ts: '2026-07-12T04:00:00.000Z' }],
      reviews: [{ author: 'bob', state: 'approved', ts: '2026-07-12T05:00:00.000Z' }],
    });
    const prev = state({
      lastCommentTs: '2026-07-12T09:00:00.000Z',
      lastReviewTs: '2026-07-12T10:00:00.000Z',
    });
    const { events, next } = computeEvents(prev, pr, 'me', NOW);
    // Old comments/reviews are below the mark, so no events
    expect(events).toEqual([]);
    // High-water marks must not regress
    expect(next.lastCommentTs).toBe('2026-07-12T09:00:00.000Z');
    expect(next.lastReviewTs).toBe('2026-07-12T10:00:00.000Z');
  });

  it('reviewer role suppresses author-side events', () => {
    // Reviewer has already seen the review request, but there are new comments and reviews.
    const pr = basePr({
      myRole: 'reviewer',
      reviewRequestedOfMe: true,
      comments: [
        { author: 'bob', ts: '2026-07-12T08:00:00.000Z' },
        { author: 'alice', ts: '2026-07-12T09:00:00.000Z' },
      ],
      reviews: [
        { author: 'bob', state: 'approved', ts: '2026-07-12T09:30:00.000Z' },
        { author: 'alice', state: 'changes_requested', ts: '2026-07-12T09:45:00.000Z' },
      ],
    });
    const prev = state({
      myRole: 'reviewer',
      reviewRequestedSeen: true,
      lastCommentTs: '2026-07-12T07:00:00.000Z',
      lastReviewTs: '2026-07-12T08:00:00.000Z',
    });
    const { events } = computeEvents(prev, pr, 'me', NOW);
    // No events: review_requested is suppressed (already seen),
    // and author-side events (commented/approved/changes_requested/reviewed) are gated by myRole === 'author'
    expect(events).toEqual([]);
  });
});
