import { describe, it, expect } from 'vitest';
import { parseGithubPrList, parseGitRemoteNwo } from '../../orchestrator/services/prProviders/github.js';

const REPO = { host: 'github' as const, repoKey: 'gh:o/r', repoLabel: 'r', nwo: 'o/r', localClonePath: '/tmp/r' };
const GH_JSON = JSON.stringify([
  { number: 165, title: 'feat: x', author: { login: 'jan' }, headRefName: 'b1', baseRefName: 'main',
    updatedAt: '2026-07-10T12:00:00Z', url: 'https://github.com/o/r/pull/165' },
]);

describe('github provider', () => {
  it('normalizes gh pr list JSON', () => {
    const prs = parseGithubPrList(GH_JSON, REPO);
    expect(prs[0]).toMatchObject({
      host: 'github', repoKey: 'gh:o/r', number: 165, title: 'feat: x',
      author: 'jan', sourceBranch: 'b1', targetBranch: 'main', reviewable: true,
    });
  });
  it('reviewable=false when no local clone', () => {
    const prs = parseGithubPrList(GH_JSON, { ...REPO, localClonePath: null });
    expect(prs[0].reviewable).toBe(false);
  });
  it('parses ssh and https remotes to nwo', () => {
    expect(parseGitRemoteNwo('git@github.com:o/r.git')).toBe('o/r');
    expect(parseGitRemoteNwo('https://github.com/o/r.git')).toBe('o/r');
    expect(parseGitRemoteNwo('https://gitlab.com/o/r.git')).toBeNull();
  });
});
