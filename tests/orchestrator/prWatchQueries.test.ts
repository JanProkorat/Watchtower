import { describe, it, expect } from 'vitest';
import { parseGithubDetail, parseAzdoPr } from '../../orchestrator/services/prWatch/queries.js';

describe('parseGithubDetail', () => {
  it('normalizes reviews, comments, and approval/mergeability', () => {
    const raw = {
      number: 42, title: 'Add thing', url: 'https://gh/pr/42',
      reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
      reviews: [{ author: { login: 'ann' }, state: 'APPROVED', submittedAt: '2026-07-12T02:00:00Z' }],
      comments: [{ author: { login: 'bob' }, createdAt: '2026-07-12T01:00:00Z' }],
    };
    const pr = parseGithubDetail(raw, 'acme/widgets', 'widgets', 'me', 'author');
    expect(pr.approved).toBe(true);
    expect(pr.mergeable).toBe(true);
    expect(pr.reviews).toEqual([{ author: 'ann', state: 'approved', ts: '2026-07-12T02:00:00Z' }]);
    expect(pr.comments).toEqual([{ author: 'bob', ts: '2026-07-12T01:00:00Z' }]);
  });

  it('reports mergeBlockedReason when not clean', () => {
    const raw = { number: 1, title: 't', url: 'u', reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviews: [], comments: [] };
    const pr = parseGithubDetail(raw, 'r', 'r', 'me', 'author');
    expect(pr.approved).toBe(false);
    expect(pr.mergeable).toBe(false);
    expect(pr.mergeBlockedReason).toMatch(/conflict/i);
  });
});

describe('parseAzdoPr', () => {
  it('maps votes to approval and threads to comments', () => {
    const raw = {
      pullRequestId: 7, title: 'AzDO PR', createdBy: { id: 'me' },
      reviewers: [{ id: 'ann', vote: 10 }],
      repository: { name: 'repo' },
      mergeStatus: 'succeeded',
    };
    const threads = [{ comments: [{ author: { uniqueName: 'ann' }, publishedDate: '2026-07-12T03:00:00Z' }] }];
    const pr = parseAzdoPr(raw, threads, 'me', 'dev.azure.com', 'https://dev.azure.com/org');
    expect(pr.repoKey).toBe('azdo:dev.azure.com/repo');
    expect(pr.approved).toBe(true);
    expect(pr.mergeable).toBe(true);
    expect(pr.comments).toEqual([{ author: 'ann', ts: '2026-07-12T03:00:00Z' }]);
    expect(pr.reviews).toEqual([{ author: 'ann', state: 'approved', ts: '2026-07-12T03:00:00Z' }]);
  });

  it('excludes self-authored comments by author GUID', () => {
    const raw = {
      pullRequestId: 8, title: 'AzDO PR', createdBy: { id: 'me' },
      reviewers: [], repository: { name: 'repo' }, mergeStatus: 'succeeded',
    };
    const threads = [{
      comments: [
        { author: { id: 'me', uniqueName: 'me@example.com' }, publishedDate: '2026-07-12T04:00:00Z' },
        { author: { id: 'ann-guid', uniqueName: 'ann@example.com' }, publishedDate: '2026-07-12T05:00:00Z' },
      ],
    }];
    const pr = parseAzdoPr(raw, threads, 'me', 'dev.azure.com', 'https://dev.azure.com/org');
    expect(pr.comments).toEqual([{ author: 'ann@example.com', ts: '2026-07-12T05:00:00Z' }]);
  });

  it('still surfaces a reviewer approval when the only thread comment is your own', () => {
    // Excluding self-comments must not blank the review timestamp basis: an
    // approval on your own PR should still notify even if you were the only
    // one who left a text comment.
    const raw = {
      pullRequestId: 9, title: 'AzDO PR', createdBy: { id: 'me' },
      reviewers: [{ id: 'ann-guid', vote: 10 }], repository: { name: 'repo' }, mergeStatus: 'succeeded',
    };
    const threads = [{
      comments: [{ author: { id: 'me', uniqueName: 'me@example.com' }, publishedDate: '2026-07-12T06:00:00Z' }],
    }];
    const pr = parseAzdoPr(raw, threads, 'me', 'dev.azure.com', 'https://dev.azure.com/org');
    expect(pr.comments).toEqual([]); // self-comment excluded from notification candidates
    expect(pr.reviews).toEqual([{ author: 'ann-guid', state: 'approved', ts: '2026-07-12T06:00:00Z' }]);
  });
});
