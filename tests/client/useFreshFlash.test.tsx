// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { FileTreeActivityState } from '@watchtower/shared/fileTree.js';
import { useFreshFlash } from '../../apps/desktop/src/state/useFileTreeActivity';

const stateAt = (receivedAt: number): FileTreeActivityState => ({
  instanceId: 'i1',
  receivedAt,
  snapshot: { panelToggles: 0, sentAt: receivedAt, activity: [{ path: '/r/a.ts', kind: 'write', at: receivedAt - 100 }] },
});

describe('useFreshFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('flashes a fresh touch, then empties after 4 s', () => {
    const state = stateAt(Date.now());
    const { result } = renderHook(() => useFreshFlash(state, '/r'));
    expect(result.current.has('a.ts')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current.size).toBe(0);
  });

  it('is empty at once for a stale state', () => {
    const { result } = renderHook(() => useFreshFlash(stateAt(Date.now() - 10_000), '/r'));
    expect(result.current.size).toBe(0);
  });
});
