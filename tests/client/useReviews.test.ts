// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { groupPrsByProject, sortByUpdatedDesc, applyPrFilter, relativeAge, sortFindings, worstSeverity, sortFindingsWithIndex, useReviews } from '../../apps/desktop/src/state/useReviews.js';
import { toast } from '../../apps/desktop/src/state/useToast';
import type { PrFindingPayload } from '../../packages/shared/src/ipcContract.js';

const pr = (o: Partial<any> = {}) => ({ host: 'github', repoKey: 'gh:o/r', repoLabel: 'r', number: 1,
  title: 'Add widget', author: 'jan', sourceBranch: 'b', targetBranch: 'main', url: 'u',
  updatedAt: '2026-07-10T10:00:00Z', reviewable: true, ...o });

const finding = (o: Partial<PrFindingPayload> = {}): PrFindingPayload => ({
  file: 'a.ts', line: 1, severity: 'info', category: 'correctness', summary: 's', ...o,
});

describe('useReviews helpers', () => {
  it('groups by project (repoLabel), most-recently-active project first, Default bucket last', () => {
    const g = groupPrsByProject([
      pr({ number: 1, repoLabel: 'Spot', updatedAt: '2026-07-05T00:00:00Z' }),
      pr({ number: 2, repoLabel: 'PPS', updatedAt: '2026-07-10T00:00:00Z' }),
      pr({ number: 3, repoLabel: 'Spot', updatedAt: '2026-07-09T00:00:00Z' }),
      pr({ number: 4, repoLabel: '', updatedAt: '2026-07-11T00:00:00Z' }), // no project → Default, forced last despite newest
    ]);
    expect(g.map((x) => x.label)).toEqual(['PPS', 'Spot', 'Default']);
    // within a project, most-recent PR first
    expect(g.find((x) => x.label === 'Spot')!.prs.map((p) => p.number)).toEqual([3, 1]);
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

  it('closePr invokes prs:close then refreshes the list (evicting the closed PR)', async () => {
    const { result } = renderHook(() => useReviews());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (window as any).watchtower.invoke.mockClear();
    await act(async () => { await result.current.closePr('github', 'gh:acme/w', 42); });
    const kinds = (window as any).watchtower.invoke.mock.calls.map((c: unknown[]) => c[0]);
    expect((window as any).watchtower.invoke).toHaveBeenCalledWith('prs:close', { host: 'github', repoKey: 'gh:acme/w', prNumber: 42 });
    expect(kinds).toContain('prs:refresh');
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

// A window.watchtower double whose `on` records handlers so a test can push
// events (real bridge behaviour), unlike the no-op `on` in the block above.
// prs:list starts empty; prs:refresh returns `refreshPrs` — so a test can prove
// a live update actually flowed new data through without a manual Refresh.
function makeLiveWatchtower(refreshPrs: any[] = []) {
  const handlers: Record<string, ((p: any) => void)[]> = {};
  const invoke = vi.fn(async (kind: string) => {
    switch (kind) {
      case 'prs:list': return { pullRequests: [], syncedAt: '2026-07-14T10:00:00Z', warnings: [] };
      case 'prs:refresh': return { pullRequests: refreshPrs, syncedAt: '2026-07-14T11:00:00Z', warnings: [] };
      case 'prReview:list': return { reviews: [] };
      default: return {};
    }
  });
  const on = vi.fn((event: string, cb: (p: any) => void) => {
    (handlers[event] ??= []).push(cb);
    return () => { handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb); };
  });
  const emit = (event: string, p?: any) => { for (const h of [...(handlers[event] ?? [])]) h(p); };
  return { invoke, on, emit };
}

describe('useReviews live updates', () => {
  it('refreshes the list on a prWatchEvent push, without flipping the loading flag', async () => {
    const wt = makeLiveWatchtower([pr({ number: 7 })]);
    (window as any).watchtower = wt;
    const { result } = renderHook(() => useReviews());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pullRequests).toEqual([]); // initial prs:list is empty

    act(() => { wt.emit('prWatchEvent', { host: 'github', repoKey: 'gh:o/r', prNumber: 7 }); });

    await waitFor(() => expect(result.current.pullRequests.map((p) => p.number)).toEqual([7]));
    // Background refresh must not disable the Refresh button / show the spinner.
    expect(result.current.loading).toBe(false);
  });

  it('auto-refreshes on the focused (60s) interval with no user action', async () => {
    vi.useFakeTimers();
    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const wt = makeLiveWatchtower([pr({ number: 9 })]);
    (window as any).watchtower = wt;
    try {
      renderHook(() => useReviews());
      await vi.advanceTimersByTimeAsync(0); // flush the mount load
      wt.invoke.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wt.invoke.mock.calls.map((c) => c[0])).toContain('prs:refresh');
    } finally {
      focusSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('coalesces a burst of prWatchEvents into at most two refreshes', async () => {
    const wt = makeLiveWatchtower([pr({ number: 3 })]);
    (window as any).watchtower = wt;
    const { result } = renderHook(() => useReviews());
    await waitFor(() => expect(result.current.loading).toBe(false));
    wt.invoke.mockClear();

    await act(async () => {
      wt.emit('prWatchEvent', { host: 'github', repoKey: 'gh:o/r', prNumber: 3 });
      wt.emit('prWatchEvent', { host: 'github', repoKey: 'gh:o/r', prNumber: 3 });
      wt.emit('prWatchEvent', { host: 'github', repoKey: 'gh:o/r', prNumber: 3 });
    });

    const refreshCalls = wt.invoke.mock.calls.filter((c) => c[0] === 'prs:refresh').length;
    expect(refreshCalls).toBeGreaterThanOrEqual(1);
    expect(refreshCalls).toBeLessThanOrEqual(2);
  });
});
