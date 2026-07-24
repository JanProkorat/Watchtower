import { describe, it, expect } from 'vitest';
import { notificationBody } from '../../orchestrator/index';
import type { WatchedPr, WatchEvent } from '../../orchestrator/services/prWatch/types';

const pr: WatchedPr = {
  host: 'github',
  repoKey: 'gh:acme/widgets',
  repoLabel: 'widgets',
  prNumber: 42,
  title: 'Add sprockets',
  url: 'https://github.com/acme/widgets/pull/42',
  myRole: 'author',
  reviewRequestedOfMe: false,
  comments: [],
  reviews: [],
  approved: false,
  mergeable: true,
  mergeBlockedReason: null,
};

describe('notificationBody', () => {
  it('formats review_requested with no author', () => {
    const ev: WatchEvent = { type: 'review_requested' };
    expect(notificationBody(pr, ev)).toBe('Review requested on "Add sprockets"');
  });

  it('formats commented with the commenting author', () => {
    const ev: WatchEvent = { type: 'commented', author: 'alice' };
    expect(notificationBody(pr, ev)).toBe('alice commented on "Add sprockets"');
  });

  it('formats reviewed with the reviewing author', () => {
    const ev: WatchEvent = { type: 'reviewed', author: 'bob' };
    expect(notificationBody(pr, ev)).toBe('bob reviewed "Add sprockets"');
  });

  it('formats approved with the approving author', () => {
    const ev: WatchEvent = { type: 'approved', author: 'carol' };
    expect(notificationBody(pr, ev)).toBe('carol approved "Add sprockets"');
  });

  it('formats changes_requested with the requesting author', () => {
    const ev: WatchEvent = { type: 'changes_requested', author: 'dave' };
    expect(notificationBody(pr, ev)).toBe('dave requested changes on "Add sprockets"');
  });

  it('formats merged with no author', () => {
    const ev: WatchEvent = { type: 'merged' };
    expect(notificationBody(pr, ev)).toBe('"Add sprockets" was merged');
  });
});
