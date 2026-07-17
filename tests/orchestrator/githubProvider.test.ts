import { describe, it, expect, vi } from 'vitest';
import { parseGithubPrList, parseGitRemoteNwo, githubReviewState, approveGithubPr, closeGithubPr } from '../../orchestrator/services/prProviders/github.js';

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
  it('prefers author.name, falling back to login when name is empty or absent', () => {
    const withName = JSON.stringify([{ number: 1, title: 't', author: { login: 'jan', name: 'Jan Prokorát' },
      headRefName: 'b', baseRefName: 'main', updatedAt: '', url: '' }]);
    expect(parseGithubPrList(withName, REPO)[0]!.author).toBe('Jan Prokorát');
    // gh returns name:'' (not null) for accounts with no display name — must fall back.
    const emptyName = JSON.stringify([{ number: 2, title: 't', author: { login: 'jan', name: '' },
      headRefName: 'b', baseRefName: 'main', updatedAt: '', url: '' }]);
    expect(parseGithubPrList(emptyName, REPO)[0]!.author).toBe('jan');
  });
  it('parses ssh and https remotes to nwo', () => {
    expect(parseGitRemoteNwo('git@github.com:o/r.git')).toBe('o/r');
    expect(parseGitRemoteNwo('https://github.com/o/r.git')).toBe('o/r');
    expect(parseGitRemoteNwo('https://gitlab.com/o/r.git')).toBeNull();
  });
});

describe('githubReviewState', () => {
  it('fetches author,reviewDecision,mergeable,mergeStateStatus and derives state', async () => {
    const exec = vi.fn(async () => JSON.stringify({
      author: { login: 'jan' }, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    }));
    const state = await githubReviewState(REPO, 165, 'jan', exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'view', '165', '--repo', 'o/r', '--json', 'author,reviewDecision,mergeable,mergeStateStatus']);
    expect(state).toEqual({ amIAuthor: true, approved: true, mergeable: true, mergeBlockedReason: null });
  });

  it('amIAuthor is false when the login does not match the PR author', async () => {
    const exec = vi.fn(async () => JSON.stringify({
      author: { login: 'someoneelse' }, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
    }));
    const state = await githubReviewState(REPO, 165, 'jan', exec);
    expect(state.amIAuthor).toBe(false);
    expect(state.approved).toBe(false);
    expect(state.mergeBlockedReason).toBe('Required checks/approvals not satisfied');
  });
});

describe('approveGithubPr', () => {
  it('runs gh pr review --approve', async () => {
    const exec = vi.fn(async () => '');
    await approveGithubPr('o/r', 165, exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'review', '165', '--repo', 'o/r', '--approve']);
  });
});

describe('closeGithubPr', () => {
  it('runs gh pr close (keeps the branch)', async () => {
    const exec = vi.fn(async () => '');
    await closeGithubPr('o/r', 165, exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'close', '165', '--repo', 'o/r']);
  });
});
