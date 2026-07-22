import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ReviewsService } from '../../orchestrator/services/reviews.js';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

let db: SqliteLike;
beforeEach(() => {
  db = new DatabaseSync(':memory:') as unknown as SqliteLike;
  runMigrations(db);
});

const ghPr = (number: number): PullRequestPayload => ({
  host: 'github', repoKey: 'gh:o/r', repoLabel: 'r', number, title: `PR ${number}`,
  author: 'jan', sourceBranch: 's', targetBranch: 'main', url: 'u', updatedAt: '2026-07-22T00:00:00Z', reviewable: true,
});

const azdoPrRow = (number: number): PullRequestPayload => ({
  host: 'azdo', repoKey: 'azdo:h/r', repoLabel: 'r2', number, title: `Azdo PR ${number}`,
  author: 'jan', sourceBranch: 's', targetBranch: 'main', url: 'u', updatedAt: '2026-07-22T00:00:00Z', reviewable: true,
});

/** One github repo + one azdo repo, resolved via projects + gitRemote fakes. */
const baseDeps = () => ({
  db,
  projects: () => [
    { id: 1, name: 'GhProject', folder_path: '/tmp/gh' },
    { id: 2, name: 'AzdoProject', folder_path: '/tmp/azdo' },
  ],
  gitRemote: async (cwd: string) => (cwd === '/tmp/azdo'
    ? 'https://devops.example.com/org/proj/_git/r'
    : 'git@github.com:o/r.git'),
  resolveAzdoUser: async () => ({ id: 'me-guid', displayName: 'Jan' }),
});

describe('ReviewsService.backgroundRefresh', () => {
  it('detects a merged PR: notifies, drops it from the list, and signals onListChanged', async () => {
    const listGithub = vi.fn(async () => [ghPr(1), ghPr(2)]);
    const listAzdo = vi.fn(async () => []);
    const githubPrState = vi.fn(async () => ({ merged: true }));
    const svc = new ReviewsService({ ...baseDeps(), listGithub, listAzdo, githubPrState });

    await svc.refresh(undefined);
    expect(svc.list().pullRequests).toHaveLength(2);

    // PR #2 disappears from the open set this cycle.
    listGithub.mockImplementation(async () => [ghPr(1)]);

    const notifyMerged = vi.fn();
    const onListChanged = vi.fn();
    await svc.backgroundRefresh(undefined, { notifyMerged, onListChanged });

    expect(githubPrState).toHaveBeenCalledWith('o/r', 2);
    expect(notifyMerged).toHaveBeenCalledTimes(1);
    expect(notifyMerged).toHaveBeenCalledWith(expect.objectContaining({ number: 2, repoKey: 'gh:o/r' }));
    expect(onListChanged).toHaveBeenCalledTimes(1);
    const nums = svc.list().pullRequests.map((p) => p.number);
    expect(nums).toContain(1);
    expect(nums).not.toContain(2);
  });

  it('a PR that disappeared but was closed (not merged) is removed but not notified', async () => {
    const listGithub = vi.fn(async () => [ghPr(1), ghPr(2)]);
    const listAzdo = vi.fn(async () => []);
    const githubPrState = vi.fn(async () => ({ merged: false }));
    const svc = new ReviewsService({ ...baseDeps(), listGithub, listAzdo, githubPrState });

    await svc.refresh(undefined);
    listGithub.mockImplementation(async () => [ghPr(1)]);

    const notifyMerged = vi.fn();
    const onListChanged = vi.fn();
    await svc.backgroundRefresh(undefined, { notifyMerged, onListChanged });

    expect(notifyMerged).not.toHaveBeenCalled();
    expect(onListChanged).toHaveBeenCalledTimes(1);
    const nums = svc.list().pullRequests.map((p) => p.number);
    expect(nums).toContain(1);
    expect(nums).not.toContain(2);
  });

  it('retains PRs of a repo that transiently failed this cycle, without notifying', async () => {
    const listAzdo = vi.fn(async () => [azdoPrRow(9)]);
    let cycle = 0;
    const listGithub = vi.fn(async () => {
      cycle += 1;
      if (cycle === 1) return [ghPr(1), ghPr(2)];
      throw new Error('gh: rate limited');
    });
    const githubPrState = vi.fn(async () => ({ merged: true }));
    const svc = new ReviewsService({
      ...baseDeps(),
      listGithub, listAzdo, githubPrState,
      // azdo host must have a PAT so it succeeds this cycle.
    });

    await svc.refresh({ 'devops.example.com': 'pat-value' });
    expect(svc.list().pullRequests).toHaveLength(3); // 2 github + 1 azdo

    const notifyMerged = vi.fn();
    const onListChanged = vi.fn();
    await svc.backgroundRefresh({ 'devops.example.com': 'pat-value' }, { notifyMerged, onListChanged });

    expect(githubPrState).not.toHaveBeenCalled();
    expect(notifyMerged).not.toHaveBeenCalled();
    const nums = svc.list().pullRequests.map((p) => p.number).sort();
    // github's PRs (1, 2) retained despite this cycle's failure; azdo's PR (9) still open.
    expect(nums).toEqual([1, 2, 9]);
    expect(onListChanged).toHaveBeenCalledTimes(1);
  });
});
