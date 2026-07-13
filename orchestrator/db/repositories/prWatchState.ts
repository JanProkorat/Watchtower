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

/** Composite-key string for (host, repoKey, prNumber) dedup/lookup in Sets. */
const keyOf = (host: PrHost, repoKey: string, prNumber: number): string =>
  `${host}::${repoKey}::${prNumber}`;

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
    const live = new Set(keep.map((k) => keyOf(k.host, k.repoKey, k.prNumber)));
    const del = this.db.prepare(`DELETE FROM pr_watch_state WHERE host = ? AND repo_key = ? AND pr_number = ?`);
    let deleted = 0;
    for (const r of this.all()) {
      if (!live.has(keyOf(r.host, r.repoKey, r.prNumber))) {
        del.run(r.host, r.repoKey, r.prNumber);
        deleted++;
      }
    }
    return deleted;
  }
}
