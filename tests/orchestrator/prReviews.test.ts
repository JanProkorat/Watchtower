import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { PrReviewsRepo } from '../../orchestrator/db/repositories/prReviews.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('PrReviewsRepo', () => {
  let db: SqliteLike;
  let repo: PrReviewsRepo;

  beforeEach(() => {
    db = freshDb();
    repo = new PrReviewsRepo(db);
  });

  it('start() inserts a running row and returns its id', () => {
    const id = repo.start('github.com', 'acme/widgets', 42, 'abc123');
    expect(typeof id).toBe('number');

    const row = repo.get(id);
    expect(row).toBeDefined();
    expect(row!.host).toBe('github.com');
    expect(row!.repo_key).toBe('acme/widgets');
    expect(row!.pr_number).toBe(42);
    expect(row!.head_sha).toBe('abc123');
    expect(row!.status).toBe('running');
    expect(row!.summary).toBeNull();
    expect(row!.findings_json).toBeNull();
    expect(row!.error).toBeNull();
    expect(row!.created_at).toBeTruthy();
    expect(row!.finished_at).toBeNull();
  });

  it('finish() marks the row done with summary/findings and sets finished_at', () => {
    const id = repo.start('github.com', 'acme/widgets', 42, 'abc123');
    repo.finish(id, 'Looks good overall.', JSON.stringify([{ file: 'a.ts', summary: 'nit' }]));

    const row = repo.get(id)!;
    expect(row.status).toBe('done');
    expect(row.summary).toBe('Looks good overall.');
    expect(row.findings_json).toBe(JSON.stringify([{ file: 'a.ts', summary: 'nit' }]));
    expect(row.error).toBeNull();
    expect(row.finished_at).toBeTruthy();
  });

  it('fail() marks the row error with the error message and sets finished_at', () => {
    const id = repo.start('github.com', 'acme/widgets', 42, 'abc123');
    repo.fail(id, 'gh CLI not authenticated');

    const row = repo.get(id)!;
    expect(row.status).toBe('error');
    expect(row.error).toBe('gh CLI not authenticated');
    expect(row.summary).toBeNull();
    expect(row.findings_json).toBeNull();
    expect(row.finished_at).toBeTruthy();
  });

  it('get() returns undefined for an unknown id', () => {
    expect(repo.get(999999)).toBeUndefined();
  });

  it('latestFor() returns the most recent review by id for a given host/repo/PR', () => {
    const id1 = repo.start('github.com', 'acme/widgets', 42, 'sha1');
    repo.finish(id1, 'first pass', '[]');
    const id2 = repo.start('github.com', 'acme/widgets', 42, 'sha2');
    repo.finish(id2, 'second pass', '[]');
    // A different PR shouldn't interfere.
    repo.start('github.com', 'acme/widgets', 43, 'sha3');
    // A different repo with the same PR number shouldn't interfere either.
    repo.start('github.com', 'acme/other', 42, 'sha4');

    const latest = repo.latestFor('github.com', 'acme/widgets', 42);
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(id2);
    expect(latest!.head_sha).toBe('sha2');
  });

  it('latestFor() returns undefined when there is no matching review', () => {
    expect(repo.latestFor('github.com', 'acme/none', 1)).toBeUndefined();
  });

  it('list() returns all reviews ordered by id descending when no repoKey is given', () => {
    const id1 = repo.start('github.com', 'acme/widgets', 42, 'sha1');
    const id2 = repo.start('github.com', 'acme/other', 7, 'sha2');
    const all = repo.list();
    expect(all.map((r) => r.id)).toEqual([id2, id1]);
  });

  it('list(repoKey) filters to a single repo', () => {
    const id1 = repo.start('github.com', 'acme/widgets', 42, 'sha1');
    repo.start('github.com', 'acme/other', 7, 'sha2');
    const filtered = repo.list('acme/widgets');
    expect(filtered.map((r) => r.id)).toEqual([id1]);
  });
});
