import { describe, it, expect, vi } from 'vitest';
import { parseAzdoPrList, listAzdoPrs, fetchAzdoReviewState, approveAzdoPr } from '../../orchestrator/services/prProviders/azureDevops.js';

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

describe('listAzdoPrs', () => {
  it('queries both creatorId and reviewerId (repo-scoped, active) and dedupes overlapping PRs', async () => {
    const mkPr = (id: number, title: string) => ({
      pullRequestId: id, title, createdBy: { uniqueName: 'me@skoda' },
      sourceRefName: `refs/heads/feature/${id}`, targetRefName: 'refs/heads/develop', creationDate: '2026-07-10T09:00:00Z',
    });
    const get = vi.fn(async (url: string) => {
      if (url.includes('searchCriteria.creatorId=me-guid')) return { value: [mkPr(1, 'A'), mkPr(2, 'B')] };
      if (url.includes('searchCriteria.reviewerId=me-guid')) return { value: [mkPr(2, 'B'), mkPr(3, 'C')] };
      throw new Error(`unexpected url ${url}`);
    });
    const prs = await listAzdoPrs(REPO, 'pat-value', 'me-guid', get);
    const [creatorUrl, reviewerUrl] = get.mock.calls.map((c) => c[0] as string);
    expect(creatorUrl).toContain('/repositories/technology/pullrequests?searchCriteria.creatorId=me-guid');
    expect(creatorUrl).toContain('searchCriteria.status=active');
    expect(reviewerUrl).toContain('/repositories/technology/pullrequests?searchCriteria.reviewerId=me-guid');
    expect(reviewerUrl).toContain('searchCriteria.status=active');
    // PR #2 appears in both result sets — deduped to a single payload.
    expect(prs.map((p) => p.number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
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
