// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { groupPrsByHost, sortByUpdatedDesc, applyPrFilter, relativeAge, sortFindings, worstSeverity, sortFindingsWithIndex, useReviews } from '../../apps/desktop/src/state/useReviews.js';
import { toast } from '../../apps/desktop/src/state/useToast';
import type { PrFindingPayload } from '../../packages/shared/src/ipcContract.js';

const pr = (o: Partial<any> = {}) => ({ host: 'github', repoKey: 'gh:o/r', repoLabel: 'r', number: 1,
  title: 'Add widget', author: 'jan', sourceBranch: 'b', targetBranch: 'main', url: 'u',
  updatedAt: '2026-07-10T10:00:00Z', reviewable: true, ...o });

const finding = (o: Partial<PrFindingPayload> = {}): PrFindingPayload => ({
  file: 'a.ts', line: 1, severity: 'info', category: 'correctness', summary: 's', ...o,
});

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
  it('sortFindings orders error before warn before info', () => {
    const findings = [finding({ severity: 'info', file: 'i.ts' }), finding({ severity: 'error', file: 'e.ts' }),
      finding({ severity: 'warn', file: 'w.ts' })];
    expect(sortFindings(findings).map((f) => f.severity)).toEqual(['error', 'warn', 'info']);
  });
  it('sortFindings is stable for equal severities and does not mutate the input', () => {
    const findings = [finding({ severity: 'warn', file: 'w1.ts' }), finding({ severity: 'warn', file: 'w2.ts' })];
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => f.file)).toEqual(['w1.ts', 'w2.ts']);
    expect(sorted).not.toBe(findings);
  });
  it('worstSeverity picks error over warn/info regardless of order', () => {
    expect(worstSeverity([finding({ severity: 'info' }), finding({ severity: 'error' }), finding({ severity: 'warn' })])).toBe('error');
    expect(worstSeverity([finding({ severity: 'info' }), finding({ severity: 'warn' })])).toBe('warn');
    expect(worstSeverity([finding({ severity: 'info' })])).toBe('info');
  });
  it('worstSeverity returns null for an empty list', () => {
    expect(worstSeverity([])).toBeNull();
  });
  it('sortFindingsWithIndex orders by severity but keeps each finding\'s original array index', () => {
    // prReview:postComments indexes into the as-stored (unsorted) findings array, so
    // the UI must select by original index — not by position after sorting.
    const findings = [finding({ severity: 'info', file: 'i.ts' }), finding({ severity: 'error', file: 'e.ts' }),
      finding({ severity: 'warn', file: 'w.ts' })];
    const result = sortFindingsWithIndex(findings);
    expect(result.map((r) => r.finding.file)).toEqual(['e.ts', 'w.ts', 'i.ts']);
    expect(result.map((r) => r.index)).toEqual([1, 2, 0]);
  });
  it('sortFindingsWithIndex does not mutate the input', () => {
    const findings = [finding({ severity: 'info' }), finding({ severity: 'error' })];
    sortFindingsWithIndex(findings);
    expect(findings.map((f) => f.severity)).toEqual(['info', 'error']);
  });
});

describe('useReviews IPC wrappers', () => {
  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (window as any).watchtower = {
      invoke: vi.fn(async (kind: string) => {
        switch (kind) {
          case 'prs:list':
          case 'prs:refresh': return { pullRequests: [], syncedAt: '2026-07-14T10:00:00Z', warnings: [] };
          case 'prReview:list': return { reviews: [] };
          case 'prs:reviewState': return { amIAuthor: false, approved: true, mergeable: true, mergeBlockedReason: null };
          case 'prs:approve': return { ok: true };
          default: return {};
        }
      }),
      on: vi.fn(() => () => {}),
    };
  });

  it('fetchReviewState invokes prs:reviewState and returns the payload (no PATs sent by the renderer)', async () => {
    const { result } = renderHook(() => useReviews());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const state = await act(async () => result.current.fetchReviewState('github', 'gh:acme/w', 42));
    expect((window as any).watchtower.invoke).toHaveBeenCalledWith('prs:reviewState', { host: 'github', repoKey: 'gh:acme/w', number: 42 });
    expect(state).toEqual({ amIAuthor: false, approved: true, mergeable: true, mergeBlockedReason: null });
  });

  it('approvePr invokes prs:approve (no PATs sent by the renderer)', async () => {
    const { result } = renderHook(() => useReviews());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.approvePr('github', 'gh:acme/w', 42); });
    expect((window as any).watchtower.invoke).toHaveBeenCalledWith('prs:approve', { host: 'github', repoKey: 'gh:acme/w', number: 42 });
  });

  it('surfaces per-repo list warnings as toasts', async () => {
    (window as any).watchtower.invoke = vi.fn(async (kind: string) => {
      if (kind === 'prs:list' || kind === 'prs:refresh') {
        return { pullRequests: [], syncedAt: '2026-07-14T10:00:00Z', warnings: ['PPS: Azure DevOps 401'] };
      }
      if (kind === 'prReview:list') return { reviews: [] };
      return {};
    });
    const spy = vi.spyOn(toast, 'showWarning');
    renderHook(() => useReviews());
    await waitFor(() => expect(spy).toHaveBeenCalledWith('PPS: Azure DevOps 401'));
  });
});
