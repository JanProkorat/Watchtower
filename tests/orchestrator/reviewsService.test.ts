import { describe, it, expect, beforeEach } from 'vitest';
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
  it('devops config round-trips through settings', () => {
    const svc = new ReviewsService(deps());
    svc.setDevopsConfig({ orgBaseUrl: 'https://x/tfs', repos: [{ orgBaseUrl: 'https://x/tfs', project: 'PPS', repo: 'technology' }] });
    const got = svc.getDevopsConfig();
    expect(got.orgBaseUrl).toBe('https://x/tfs');
    expect(got.repos[0].repo).toBe('technology');
  });
  it('refresh() skips DevOps when no PAT and reports only github', async () => {
    const svc = new ReviewsService(deps());
    svc.setDevopsConfig({ orgBaseUrl: 'https://x/tfs', repos: [{ orgBaseUrl: 'https://x/tfs', project: 'PPS', repo: 'technology' }] });
    const res = await svc.refresh(undefined);
    expect(res.pullRequests.every((p) => p.host === 'github')).toBe(true);
  });
});
