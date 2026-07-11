import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { PrReviewsRepo } from '../../orchestrator/db/repositories/prReviews.js';
import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import type { GithubRepoConfig, AzdoRepoConfig } from '../../orchestrator/services/prProviders/types.js';

// Shared mock hooks, declared via vi.hoisted so they're available inside the
// vi.mock factories below (which are hoisted above these imports by vitest).
const mocks = vi.hoisted(() => ({
  resolveRepos: vi.fn<() => Promise<{ github: GithubRepoConfig[]; azdo: AzdoRepoConfig[] }>>(),
  postGithubComment: vi.fn(),
  postAzdoComment: vi.fn(),
}));

// Replace the real ReviewsService entirely — resolveRepos() would otherwise
// shell out to real `git remote get-url origin`. No network/git in this test.
vi.mock('../../orchestrator/services/reviews.js', () => ({
  ReviewsService: class {
    resolveRepos = mocks.resolveRepos;
  },
}));

// Keep formatFindingBody real (harmless, pure string formatting); replace only
// the two posters so no real `gh` CLI / Azure DevOps HTTP call ever fires.
vi.mock('../../orchestrator/services/prProviders/postComment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../orchestrator/services/prProviders/postComment.js')>();
  return {
    ...actual,
    postGithubComment: mocks.postGithubComment,
    postAzdoComment: mocks.postAzdoComment,
  };
});

const { handleRequest, __setHandleForTests } = await import('../../orchestrator/index.js');
type BootstrapHandle = import('../../orchestrator/bootstrap.js').BootstrapHandle;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

const GITHUB_REPO: GithubRepoConfig = {
  host: 'github',
  repoKey: 'gh:acme/widgets',
  repoLabel: 'widgets',
  nwo: 'acme/widgets',
  localClonePath: '/tmp/widgets',
};

const AZDO_REPO: AzdoRepoConfig = {
  host: 'azdo',
  repoKey: 'azdo:dev.azure.com/acme/widgets',
  repoLabel: 'widgets',
  devopsHost: 'dev.azure.com',
  apiBase: 'https://dev.azure.com/acme/_apis',
  repo: 'widgets',
  localClonePath: '/tmp/widgets',
};

function finding(overrides: Partial<PrFindingPayload> = {}): PrFindingPayload {
  return { file: 'src/a.ts', line: 1, severity: 'warn', category: 'bug', summary: 'x', ...overrides };
}

describe('prReview:postComments handler', () => {
  let db: SqliteLike;
  let reviews: PrReviewsRepo;

  beforeEach(() => {
    db = freshDb();
    reviews = new PrReviewsRepo(db);
    __setHandleForTests({ db } as unknown as BootstrapHandle);
    mocks.resolveRepos.mockReset().mockResolvedValue({ github: [GITHUB_REPO], azdo: [] });
    mocks.postGithubComment.mockReset().mockResolvedValue(undefined);
    mocks.postAzdoComment.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    __setHandleForTests(null);
  });

  function seedReview(host: 'github' | 'azdo', repoKey: string, findings: PrFindingPayload[]): number {
    const id = reviews.start(host, repoKey, 42, 'deadbeef');
    reviews.finish(id, 'summary', JSON.stringify(findings));
    return id;
  }

  it('skips an already-posted finding and does not call the poster again', async () => {
    const id = seedReview('github', GITHUB_REPO.repoKey, [finding({ posted: true }), finding()]);

    const res = (await handleRequest({
      id: 't1',
      kind: 'prReview:postComments',
      payload: { reviewId: id, findingIndexes: [0] },
    })) as { posted: number; skipped: number; errors: string[] };

    expect(res).toEqual({ posted: 0, skipped: 1, errors: [] });
    expect(mocks.postGithubComment).not.toHaveBeenCalled();
  });

  it('skips an out-of-range finding index', async () => {
    const id = seedReview('github', GITHUB_REPO.repoKey, [finding()]);

    const res = (await handleRequest({
      id: 't2',
      kind: 'prReview:postComments',
      payload: { reviewId: id, findingIndexes: [5] },
    })) as { posted: number; skipped: number; errors: string[] };

    expect(res).toEqual({ posted: 0, skipped: 1, errors: [] });
    expect(mocks.postGithubComment).not.toHaveBeenCalled();
  });

  it('de-dupes a repeated index so it posts at most once', async () => {
    const id = seedReview('github', GITHUB_REPO.repoKey, [finding()]);

    const res = (await handleRequest({
      id: 't3',
      kind: 'prReview:postComments',
      payload: { reviewId: id, findingIndexes: [0, 0] },
    })) as { posted: number; skipped: number; errors: string[] };

    expect(res.posted).toBe(1);
    expect(res.skipped).toBe(0);
    expect(mocks.postGithubComment).toHaveBeenCalledTimes(1);

    const row = reviews.get(id)!;
    const storedFindings = JSON.parse(row.findings_json!) as PrFindingPayload[];
    expect(storedFindings[0].posted).toBe(true);
  });

  it('github success path posts once and marks the finding posted', async () => {
    const id = seedReview('github', GITHUB_REPO.repoKey, [finding()]);

    const res = (await handleRequest({
      id: 't4',
      kind: 'prReview:postComments',
      payload: { reviewId: id, findingIndexes: [0] },
    })) as { posted: number; skipped: number; errors: string[] };

    expect(res).toEqual({ posted: 1, skipped: 0, errors: [] });
    expect(mocks.postGithubComment).toHaveBeenCalledWith(
      GITHUB_REPO.nwo,
      42,
      'deadbeef',
      expect.objectContaining({ file: 'src/a.ts', line: 1 }),
    );
  });

  it('azdo without a matching PAT records an error and never posts', async () => {
    mocks.resolveRepos.mockResolvedValue({ github: [], azdo: [AZDO_REPO] });
    const id = seedReview('azdo', AZDO_REPO.repoKey, [finding()]);

    const res = (await handleRequest({
      id: 't5',
      kind: 'prReview:postComments',
      payload: { reviewId: id, findingIndexes: [0] },
    })) as { posted: number; skipped: number; errors: string[] };

    expect(res.posted).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(mocks.postAzdoComment).not.toHaveBeenCalled();
  });
});
