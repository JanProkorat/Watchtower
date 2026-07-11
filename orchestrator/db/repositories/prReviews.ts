import type { SqliteLike } from '../migrations.js';

export interface PrReviewRow {
  id: number;
  host: string;
  repo_key: string;
  pr_number: number;
  head_sha: string;
  status: 'running' | 'done' | 'error';
  summary: string | null;
  findings_json: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Repository for the review agent's pr_reviews table (migration v20). */
export class PrReviewsRepo {
  constructor(private db: SqliteLike) {}

  /** Insert a new running review row. Returns its id. */
  start(host: string, repoKey: string, prNumber: number, headSha: string): number {
    const createdAt = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO pr_reviews (host, repo_key, pr_number, head_sha, status, created_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(host, repoKey, prNumber, headSha, createdAt) as { lastInsertRowid: number | bigint };
    return Number(info.lastInsertRowid);
  }

  /** Mark a review done with its summary + findings JSON. */
  finish(id: number, summary: string, findingsJson: string): void {
    const finishedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE pr_reviews SET status = 'done', summary = ?, findings_json = ?, finished_at = ? WHERE id = ?`,
      )
      .run(summary, findingsJson, finishedAt, id);
  }

  /** Mark a review errored with the error message. */
  fail(id: number, error: string): void {
    const finishedAt = new Date().toISOString();
    this.db
      .prepare(`UPDATE pr_reviews SET status = 'error', error = ?, finished_at = ? WHERE id = ?`)
      .run(error, finishedAt, id);
  }

  get(id: number): PrReviewRow | undefined {
    return this.db.prepare(`SELECT * FROM pr_reviews WHERE id = ?`).get(id) as
      | PrReviewRow
      | undefined;
  }

  /** Most recent review (by id) for a given host/repo/PR, or undefined if none exist. */
  latestFor(host: string, repoKey: string, prNumber: number): PrReviewRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM pr_reviews WHERE host = ? AND repo_key = ? AND pr_number = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(host, repoKey, prNumber) as PrReviewRow | undefined;
  }

  /** All reviews, optionally filtered to a single repo, newest first. */
  list(repoKey?: string): PrReviewRow[] {
    if (repoKey !== undefined) {
      return this.db
        .prepare(`SELECT * FROM pr_reviews WHERE repo_key = ? ORDER BY id DESC`)
        .all(repoKey) as PrReviewRow[];
    }
    return this.db.prepare(`SELECT * FROM pr_reviews ORDER BY id DESC`).all() as PrReviewRow[];
  }
}
