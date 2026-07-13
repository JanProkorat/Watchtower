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
    expect(svc.list()).toEqual({ pullRequests: [], syncedAt: null });
  });
  it('refresh() resolves GitHub repos from project remotes and caches', async () => {
    const svc = new ReviewsService(deps());
    const res = await svc.refresh(undefined);
    expect(res.pullRequests).toHaveLength(1);
    expect(res.syncedAt).not.toBeNull();
    expect(svc.list().pullRequests).toHaveLength(1); // cached
  });
  it('refresh() lists a DevOps project when its host has a matching PAT', async () => {
    const svc = new ReviewsService({
      ...deps(),
      projects: () => [{ id: 1, name: 'PPSToolshop', folder_path: '/tmp/pps' }],
      gitRemote: async () => 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_git/technology',
      listGithub: async () => [],
      listAzdo: async (repo) => [{ host: 'azdo', repoKey: repo.repoKey, repoLabel: repo.repoLabel,
        number: 7, title: 'y', author: 'jan', sourceBranch: 'b', targetBranch: 'main',
        url: 'u', updatedAt: '2026-07-10T00:00:00Z', reviewable: true }],
    });
    const res = await svc.refresh({ 'devops.skoda.vwgroup.com': 'pat-value' });
    expect(res.pullRequests).toHaveLength(1);
    expect(res.pullRequests[0]!.host).toBe('azdo');
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
    await expect(svc.refresh(undefined)).rejects.toThrow(/selhalo/);
  });
});
