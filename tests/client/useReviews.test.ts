import { describe, it, expect } from 'vitest';
import { groupPrsByHost, sortByUpdatedDesc, applyPrFilter, relativeAge } from '../../apps/desktop/src/state/useReviews.js';

const pr = (o: Partial<any> = {}) => ({ host: 'github', repoKey: 'gh:o/r', repoLabel: 'r', number: 1,
  title: 'Add widget', author: 'jan', sourceBranch: 'b', targetBranch: 'main', url: 'u',
  updatedAt: '2026-07-10T10:00:00Z', reviewable: true, ...o });

describe('useReviews helpers', () => {
  it('groups by host with labels, github first', () => {
    const g = groupPrsByHost([pr(), pr({ host: 'azdo', repoKey: 'azdo:P/r' })]);
    expect(g.map((x) => x.host)).toEqual(['github', 'azdo']);
  });
  it('sorts by updatedAt desc', () => {
    const s = sortByUpdatedDesc([pr({ updatedAt: '2026-07-01T00:00:00Z', number: 1 }), pr({ updatedAt: '2026-07-09T00:00:00Z', number: 2 })]);
    expect(s[0].number).toBe(2);
  });
  it('filters by host and case-insensitive query on title/repo', () => {
    const list = [pr({ number: 1, title: 'Add widget' }), pr({ number: 2, title: 'Fix bug', host: 'azdo', repoKey: 'azdo:P/r' })];
    expect(applyPrFilter(list, 'github', '').map((p) => p.number)).toEqual([1]);
    expect(applyPrFilter(list, 'all', 'WIDGET').map((p) => p.number)).toEqual([1]);
  });
  it('relativeAge renders coarse buckets', () => {
    const now = Date.parse('2026-07-10T12:00:00Z');
    expect(relativeAge('2026-07-10T09:00:00Z', now)).toBe('3h');
    expect(relativeAge('2026-07-08T12:00:00Z', now)).toBe('2d');
    expect(relativeAge('2026-07-10T11:59:30Z', now)).toBe('just now');
  });
});
