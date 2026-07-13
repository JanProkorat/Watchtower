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
  repoKey: string;    // canonical id (matches resolveRepos): 'gh:owner/name' or 'azdo:host/repo'
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
