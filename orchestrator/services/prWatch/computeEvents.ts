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
    const prevLastCommentTs: string | null = prev.lastCommentTs;
    const newComments = pr.comments
      .filter((c) => {
        if (c.author === me) return false;
        if (prevLastCommentTs === null) return true;
        return c.ts > prevLastCommentTs;
      })
      .sort((a, b) => a.ts.localeCompare(b.ts));
    if (newComments.length > 0) {
      const latestComment = newComments[newComments.length - 1];
      if (latestComment) {
        events.push({ type: 'commented', author: latestComment.author });
      }
    }

    const prevLastReviewTs: string | null = prev.lastReviewTs;
    const newReviews = pr.reviews
      .filter((r) => {
        if (r.author === me) return false;
        if (prevLastReviewTs === null) return true;
        return r.ts > prevLastReviewTs;
      })
      .sort((a, b) => a.ts.localeCompare(b.ts));
    for (const r of newReviews) {
      if (r.state === 'approved') events.push({ type: 'approved', author: r.author });
      else if (r.state === 'changes_requested') events.push({ type: 'changes_requested', author: r.author });
      else events.push({ type: 'reviewed', author: r.author });
    }
  }

  return { events, next };
}
