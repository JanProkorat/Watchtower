import { describe, it, expect } from 'vitest';
import { prKey, detectListChange } from '../../orchestrator/services/reviews/detectMerged.js';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';

const pr = (repoKey: string, number: number): PullRequestPayload => ({
  host: repoKey.startsWith('gh') ? 'github' : 'azdo',
  repoKey, repoLabel: repoKey, number, title: `PR ${number}`, author: 'x',
  sourceBranch: 's', targetBranch: 't', url: 'u', updatedAt: '2026-07-22T00:00:00Z', reviewable: true,
});

describe('prKey', () => {
  it('joins host:repoKey:number', () => {
    expect(prKey(pr('gh:o/r', 7))).toBe('github:gh:o/r:7');
  });
});

describe('detectListChange', () => {
  it('flags a PR that disappeared from a succeeded repo as a candidate and drops it from nextCache', () => {
    const a = pr('gh:o/r', 1), b = pr('gh:o/r', 2);
    const res = detectListChange([a, b], [a], new Set(['gh:o/r']));
    expect(res.candidates.map((p) => p.number)).toEqual([2]);
    expect(res.nextCache.map((p) => p.number)).toEqual([1]);
  });

  it('retains PRs of a repo that FAILED this cycle and does not flag them', () => {
    const a = pr('gh:o/r', 1), b = pr('azdo:h/r', 9);
    // only the github repo succeeded; the azdo repo errored (not in succeeded set, none returned)
    const res = detectListChange([a, b], [a], new Set(['gh:o/r']));
    expect(res.candidates).toEqual([]); // b's repo didn't succeed → not a candidate
    expect(res.nextCache.map((p) => p.number).sort()).toEqual([1, 9]); // b retained
  });

  it('does not flag newly-appeared PRs (present in open, absent in prev)', () => {
    const a = pr('gh:o/r', 1);
    const res = detectListChange([], [a], new Set(['gh:o/r']));
    expect(res.candidates).toEqual([]);
    expect(res.nextCache.map((p) => p.number)).toEqual([1]);
  });
});
