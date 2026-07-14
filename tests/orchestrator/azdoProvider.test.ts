import { describe, it, expect, vi } from 'vitest';
import { parseAzdoPrList, fetchAzdoReviewState, approveAzdoPr } from '../../orchestrator/services/prProviders/azureDevops.js';

const REPO = { host: 'azdo' as const, repoKey: 'azdo:devops.skoda.vwgroup.com/technology', repoLabel: 'PPS / technology',
  devopsHost: 'devops.skoda.vwgroup.com', apiBase: 'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop',
  repo: 'technology', localClonePath: '/tmp/pps' };
const AZDO = { value: [
  { pullRequestId: 4821, title: 'TEH-2044', createdBy: { uniqueName: 'm.kral@skoda' },
    sourceRefName: 'refs/heads/feature/TEH-2044', targetRefName: 'refs/heads/develop',
    creationDate: '2026-07-10T09:00:00Z' },
] };

describe('azdo provider', () => {
  it('normalizes AZDO PR JSON and strips refs/heads/', () => {
    const prs = parseAzdoPrList(AZDO, REPO);
    expect(prs[0]).toMatchObject({
      host: 'azdo', repoKey: 'azdo:devops.skoda.vwgroup.com/technology', number: 4821, title: 'TEH-2044',
      author: 'm.kral@skoda', sourceBranch: 'feature/TEH-2044', targetBranch: 'develop', reviewable: true,
    });
    expect(prs[0].url).toContain('/pullrequest/4821');
  });
});

describe('fetchAzdoReviewState', () => {
  it('GETs the single-PR endpoint and derives amIAuthor/approved/mergeable', async () => {
    const get = vi.fn(async () => ({
      createdBy: { id: 'me-guid' },
      reviewers: [{ id: 'ann', vote: 10 }],
      mergeStatus: 'succeeded',
    }));
    const state = await fetchAzdoReviewState(REPO, 4821, 'pat-value', 'me-guid', get);
    expect(get).toHaveBeenCalledWith(
      'https://devops.skoda.vwgroup.com/projects/EOM-7/PPSToolshop/_apis/git/repositories/technology/pullRequests/4821?api-version=7.1',
      'pat-value',
    );
    expect(state).toEqual({ amIAuthor: true, approved: true, mergeable: true, mergeBlockedReason: null });
  });

  it('amIAuthor is false when createdBy.id does not match myId', async () => {
    const get = vi.fn(async () => ({ createdBy: { id: 'someone-else' }, reviewers: [], mergeStatus: 'conflicts' }));
    const state = await fetchAzdoReviewState(REPO, 4821, 'pat-value', 'me-guid', get);
    expect(state.amIAuthor).toBe(false);
    expect(state.mergeable).toBe(false);
    expect(state.mergeBlockedReason).toBe('Merge status: conflicts');
  });
});

describe('approveAzdoPr', () => {
  it('PUTs a vote:10 to the reviewers/{myId} endpoint', async () => {
    const put = vi.fn(async () => {});
    await approveAzdoPr('https://host/org', 'repo', 4821, 'me-guid', 'pat-value', put);
    expect(put).toHaveBeenCalledWith(
      'https://host/org/_apis/git/repositories/repo/pullRequests/4821/reviewers/me-guid?api-version=7.1',
      'pat-value',
      { vote: 10 },
    );
  });
});
