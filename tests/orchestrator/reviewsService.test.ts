import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ReviewsService } from '../../orchestrator/services/reviews.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

let db: SqliteLike;
beforeEach(() => {
  db = new DatabaseSync(':memory:') as unknown as SqliteLike;
  runMigrations(db);
});

const deps = () => ({
  db,
  projects: () => [{ id: 1, name: 'Watchtower', folder_path: '/tmp/wt' }],
  gitRemote: async () => 'git@github.com:jan/watchtower.git',
  listGithub: async () => [{ host: 'github', repoKey: 'gh:jan/watchtower', repoLabel: 'Watchtower',
    number: 1, title: 'x', author: 'jan', sourceBranch: 'b', targetBranch: 'main',
    url: 'u', updatedAt: '2026-07-10T00:00:00Z', reviewable: true } as const],
  listAzdo: async () => [],
});

describe('ReviewsService', () => {
  it('list() is empty with null syncedAt before refresh', () => {
    const svc = new ReviewsService(deps());
    expect(svc.list()).toEqual({ pullRequests: [], syncedAt: null, warnings: [] });
  });
  it('refresh() resolves GitHub repos from project remotes and caches', async () => {
    const svc = new ReviewsService(deps());
    const res = await svc.refresh(undefined);
    expect(res.pullRequests).toHaveLength(1);
    expect(res.syncedAt).not.toBeNull();
    expect(svc.list().pullRequests).toHaveLength(1); // cached
  });
  it('refresh() lists a DevOps project when its host has a matching PAT, resolving the azdo user id first', async () => {
    const resolveAzdoUser = vi.fn(async () => ({ id: 'me-guid', displayName: 'Jan' }));
    const listAzdo = vi.fn(async (repo) => [{ host: 'azdo', repoKey: repo.repoKey, repoLabel: repo.repoLabel,
      number: 7, title: 'y', author: 'jan', sourceBranch: 'b', targetBranch: 'main',
      url: 'u', updatedAt: '2026-07-10T00:00:00Z', reviewable: true }]);
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      listGithub: async () => [],
      resolveAzdoUser,
      listAzdo,
    });
    const res = await svc.refresh({ 'devops.skoda.vwgroup.com': 'pat-value' });
    expect(res.pullRequests).toHaveLength(1);
    expect(res.pullRequests[0]!.host).toBe('azdo');
    expect(resolveAzdoUser).toHaveBeenCalledWith('https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop', 'pat-value');
    expect(listAzdo).toHaveBeenCalledWith(expect.objectContaining({ repo: 'technology' }), 'pat-value', 'me-guid');
  });
  it('refresh() surfaces an error (no fallback to an unfiltered list) when azdo identity resolution fails', async () => {
    const resolveAzdoUser = vi.fn(async () => { throw new Error('Could not resolve Azure DevOps user'); });
    const listAzdo = vi.fn(async () => { throw new Error('listAzdo must not be called when identity resolution fails'); });
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      listGithub: async () => [],
      resolveAzdoUser,
      listAzdo,
    });
    await expect(svc.refresh({ 'devops.skoda.vwgroup.com': 'pat-value' })).rejects.toThrow(/Failed to load PRs/);
    expect(listAzdo).not.toHaveBeenCalled();
  });
  it('refresh() returns github PRs AND surfaces an azdo failure as a warning (no longer swallowed)', async () => {
    // Regression: previously an azdo error was silently dropped whenever github
    // results were present (refresh only threw when results were empty), so a
    // broken DevOps repo vanished with no user-visible signal.
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [
        { id: 1, name: 'Watchtower', folder_path: '/tmp/wt' },
        { id: 2, name: 'PPSToolshop', folder_path: '/tmp/pps' },
      ],
      gitRemote: async (cwd) => (cwd === '/tmp/pps'
        ? 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology'
        : 'git@github.com:jan/watchtower.git'),
      resolveAzdoUser: async () => { throw new Error('Could not resolve Azure DevOps user'); },
    });
    const res = await svc.refresh({ 'devops.skoda.vwgroup.com': 'pat-value' });
    expect(res.pullRequests).toHaveLength(1);
    expect(res.pullRequests[0]!.host).toBe('github');
    expect(res.warnings).toEqual(['PPSToolshop: Could not resolve Azure DevOps user']);
  });
  it('refresh() skips DevOps when no PAT for its host and reports only github', async () => {
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [
        { id: 1, name: 'Watchtower', folder_path: '/tmp/wt' },
        { id: 2, name: 'PPSToolshop', folder_path: '/tmp/pps' },
      ],
      gitRemote: async (cwd) => (cwd === '/tmp/pps'
        ? 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology'
        : 'git@github.com:jan/watchtower.git'),
    });
    const res = await svc.refresh(undefined);
    expect(res.pullRequests.every((p) => p.host === 'github')).toBe(true);
    expect(res.warnings).toContain('PPSToolshop: Azure DevOps PAT not set or unreadable — re-enter it in Reviews settings');
  });
  it('azdoMergeTarget() resolves apiBase/repo/devopsHost + a fresh source commit', async () => {
    const azdoPrDetail = vi.fn(async () => ({ lastMergeSourceCommitId: 'sha-fresh' }));
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      azdoPrDetail,
    });
    const target = await svc.azdoMergeTarget('azdo:devops.skoda.vwgroup.com/technology', 7, { 'devops.skoda.vwgroup.com': 'pat-value' });
    expect(target).toEqual({
      apiBase: 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop',
      repo: 'technology',
      devopsHost: 'devops.skoda.vwgroup.com',
      lastMergeSourceCommitId: 'sha-fresh',
    });
    expect(azdoPrDetail).toHaveBeenCalledWith(expect.objectContaining({ repo: 'technology' }), 7, 'pat-value');
  });

  it('azdoMergeTarget() throws a clear error when the PAT for the host is missing', async () => {
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      azdoPrDetail: async () => ({ lastMergeSourceCommitId: 'sha' }),
    });
    await expect(svc.azdoMergeTarget('azdo:devops.skoda.vwgroup.com/technology', 7, {}))
      .rejects.toThrow(/Missing DevOps PAT/);
  });

  it('refresh() throws an aggregated error when every repo fails and nothing was fetched', async () => {
    const svc = new ReviewsService({
      ...deps(),
      listGithub: async () => { throw new Error('gh: command not found'); },
    });
    await expect(svc.refresh(undefined)).rejects.toThrow(/Failed to load PRs/);
  });

  it('reviewState() resolves the GitHub login then delegates to githubReviewState', async () => {
    const resolveGithubLogin = vi.fn(async () => 'jan');
    const githubReviewState = vi.fn(async () => ({ amIAuthor: true, approved: true, mergeable: true, mergeBlockedReason: null }));
    const svc = new ReviewsService({ ...deps(), resolveGithubLogin, githubReviewState });
    const state = await svc.reviewState('github', 'gh:jan/watchtower', 1, undefined);
    expect(resolveGithubLogin).toHaveBeenCalled();
    expect(githubReviewState).toHaveBeenCalledWith(expect.objectContaining({ repoKey: 'gh:jan/watchtower' }), 1, 'jan');
    expect(state).toEqual({ amIAuthor: true, approved: true, mergeable: true, mergeBlockedReason: null });
  });

  it('reviewState() resolves the azdo user id then delegates to azdoReviewState', async () => {
    const resolveAzdoUser = vi.fn(async () => ({ id: 'me-guid', displayName: 'Jan' }));
    const azdoReviewState = vi.fn(async () => ({ amIAuthor: false, approved: false, mergeable: false, mergeBlockedReason: 'Merge status: conflicts' }));
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      resolveAzdoUser, azdoReviewState,
    });
    const state = await svc.reviewState('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 7, { 'devops.skoda.vwgroup.com': 'pat-value' });
    expect(resolveAzdoUser).toHaveBeenCalledWith('https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop', 'pat-value');
    expect(azdoReviewState).toHaveBeenCalledWith(expect.objectContaining({ repo: 'technology' }), 7, 'pat-value', 'me-guid');
    expect(state.mergeBlockedReason).toBe('Merge status: conflicts');
  });

  it('reviewState() throws a clear error when the azdo PAT is missing', async () => {
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
    });
    await expect(svc.reviewState('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 7, {}))
      .rejects.toThrow(/Missing DevOps PAT/);
  });

  it('azdoUser() is memoized per apiBase — a second reviewState() call reuses the cached id', async () => {
    const resolveAzdoUser = vi.fn(async () => ({ id: 'me-guid', displayName: 'Jan' }));
    const azdoReviewState = vi.fn(async () => ({ amIAuthor: false, approved: false, mergeable: true, mergeBlockedReason: null }));
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      resolveAzdoUser, azdoReviewState,
    });
    const pats = { 'devops.skoda.vwgroup.com': 'pat-value' };
    await svc.reviewState('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 7, pats);
    await svc.reviewState('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 8, pats);
    expect(resolveAzdoUser).toHaveBeenCalledTimes(1);
    expect(azdoReviewState).toHaveBeenCalledTimes(2);
  });

  it('approve() delegates to approveGithubPr for github and returns {ok:true}', async () => {
    const approveGithubPr = vi.fn(async () => {});
    const svc = new ReviewsService({ ...deps(), approveGithubPr });
    const res = await svc.approve('github', 'gh:jan/watchtower', 1, undefined);
    expect(approveGithubPr).toHaveBeenCalledWith('jan/watchtower', 1);
    expect(res).toEqual({ ok: true });
  });

  it('approve() resolves the azdo user id then delegates to approveAzdoPr', async () => {
    const resolveAzdoUser = vi.fn(async () => ({ id: 'me-guid', displayName: 'Jan' }));
    const approveAzdoPr = vi.fn(async () => {});
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      resolveAzdoUser, approveAzdoPr,
    });
    const res = await svc.approve('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 7, { 'devops.skoda.vwgroup.com': 'pat-value' });
    expect(approveAzdoPr).toHaveBeenCalledWith(
      'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop', 'technology', 7, 'me-guid', 'pat-value',
    );
    expect(res).toEqual({ ok: true });
  });

  it('close() delegates to closeGithubPr for github and returns {ok:true}', async () => {
    const closeGithubPr = vi.fn(async () => {});
    const svc = new ReviewsService({ ...deps(), closeGithubPr });
    const res = await svc.close('github', 'gh:jan/watchtower', 1, undefined);
    expect(closeGithubPr).toHaveBeenCalledWith('jan/watchtower', 1);
    expect(res).toEqual({ ok: true });
  });

  it('close() delegates to abandonAzdoPr with the repo PAT (no user id needed)', async () => {
    const abandonAzdoPr = vi.fn(async () => {});
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      abandonAzdoPr,
    });
    const res = await svc.close('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 7, { 'devops.skoda.vwgroup.com': 'pat-value' });
    expect(abandonAzdoPr).toHaveBeenCalledWith(
      'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop', 'technology', 7, 'pat-value',
    );
    expect(res).toEqual({ ok: true });
  });

  it('close() throws a clear error when the azdo PAT is missing', async () => {
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
    });
    await expect(svc.close('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 7, {}))
      .rejects.toThrow(/Missing DevOps PAT/);
  });

  it('approve() throws a clear error when the azdo PAT is missing', async () => {
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
    });
    await expect(svc.approve('azdo', 'azdo:devops.skoda.vwgroup.com/technology', 7, {}))
      .rejects.toThrow(/Missing DevOps PAT/);
  });
});
