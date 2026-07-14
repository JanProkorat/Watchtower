import { describe, it, expect } from 'vitest';
import { parseGithubDetail, parseAzdoPr, deriveGithubMergeState, deriveAzdoMergeState } from '../../orchestrator/services/prWatch/queries.js';

describe('deriveGithubMergeState', () => {
  it('approved + mergeable when CLEAN/MERGEABLE/APPROVED', () => {
    const state = deriveGithubMergeState({ reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
    expect(state).toEqual({ approved: true, mergeable: true, mergeBlockedReason: null });
  });
  it('not approved when reviewDecision is not APPROVED', () => {
    const state = deriveGithubMergeState({ reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
    expect(state.approved).toBe(false);
  });
  it('reason: Merge conflicts when mergeable is CONFLICTING', () => {
    const state = deriveGithubMergeState({ reviewDecision: 'APPROVED', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
    expect(state.mergeable).toBe(false);
    expect(state.mergeBlockedReason).toBe('Merge conflicts');
  });
  it('reason: Required checks/approvals not satisfied when BLOCKED', () => {
    const state = deriveGithubMergeState({ reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' });
    expect(state.mergeBlockedReason).toBe('Required checks/approvals not satisfied');
  });
  it('reason: falls back to Not mergeable (<status>) for anything else', () => {
    const state = deriveGithubMergeState({ reviewDecision: 'REVIEW_REQUIRED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNSTABLE' });
    expect(state.mergeBlockedReason).toBe('Not mergeable (UNSTABLE)');
  });
});

describe('deriveAzdoMergeState', () => {
  it('approved when a reviewer voted >=10 and nobody voted <0', () => {
    const state = deriveAzdoMergeState([{ id: 'a', vote: 10 }], 'succeeded');
    expect(state).toEqual({ approved: true, mergeable: true, mergeBlockedReason: null });
  });
  it('not approved when a reviewer rejected (vote < 0), even if another approved', () => {
    const state = deriveAzdoMergeState([{ id: 'a', vote: 10 }, { id: 'b', vote: -10 }], 'succeeded');
    expect(state.approved).toBe(false);
  });
  it('not mergeable with reason when mergeStatus is not succeeded', () => {
    const state = deriveAzdoMergeState([], 'conflicts');
    expect(state.mergeable).toBe(false);
    expect(state.mergeBlockedReason).toBe('Merge status: conflicts');
  });
  it('reason falls back to "unknown" when mergeStatus is undefined', () => {
    const state = deriveAzdoMergeState(undefined, undefined);
    expect(state.mergeBlockedReason).toBe('Merge status: unknown');
  });
});

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
