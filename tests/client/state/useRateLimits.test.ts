// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRateLimits } from '../../../apps/desktop/src/state/useRateLimits';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../apps/desktop/src/state/ipc', () => ({ invoke }));

// Epoch ms the fake clock starts at.
const NOW = Date.UTC(2026, 7, 6, 9, 0);

function snapshot(sessionResetsAtMs: number) {
  return {
    session: { usedPercent: 89, resetsAt: Math.floor(sessionResetsAtMs / 1000) },
    week: { usedPercent: 71, resetsAt: Math.floor((NOW + 3 * 86_400_000) / 1000) },
    capturedAt: NOW,
  };
}

/** Mount the hook and flush its initial `rateLimits:usage` round-trip. */
async function mount() {
  const view = renderHook(() => useRateLimits());
  await act(async () => {});
  return view;
}

describe('useRateLimits', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    invoke.mockReset();
    // The push subscription is a no-op for these tests; the point is that the
    // hook does not *need* a push to notice a rollover.
    (window as unknown as { watchtower: unknown }).watchtower = { on: () => () => {} };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a window that has already rolled over as 0%', async () => {
    invoke.mockResolvedValue(snapshot(NOW - 60_000));
    const { result } = await mount();
    expect(result.current.data?.session).toEqual({ usedPercent: 0, resetsAt: 0 });
    // The 7-day window is untouched — the two roll over independently.
    expect(result.current.data?.week?.usedPercent).toBe(71);
  });

  it('passes a window through untouched while it is still open', async () => {
    invoke.mockResolvedValue(snapshot(NOW + 60_000));
    const { result } = await mount();
    expect(result.current.data?.session?.usedPercent).toBe(89);
  });

  it('drops to 0% when the window rolls over, with no push and no refetch', async () => {
    // The regression: a snapshot is only refreshed when some Claude session
    // renders a statusline, so an idle rollover used to leave the bar frozen at
    // the pre-reset percentage indefinitely.
    invoke.mockResolvedValue(snapshot(NOW + 60_000));
    const { result } = await mount();
    expect(result.current.data?.session?.usedPercent).toBe(89);

    const callsBefore = invoke.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });

    expect(result.current.data?.session).toEqual({ usedPercent: 0, resetsAt: 0 });
    expect(invoke.mock.calls.length).toBe(callsBefore);
  });

  it('does not arm a timer when no window reports a reset instant', async () => {
    invoke.mockResolvedValue({ session: { usedPercent: 89, resetsAt: 0 }, week: null, capturedAt: NOW });
    const { result } = await mount();
    await act(async () => {
      vi.advanceTimersByTime(6 * 3_600_000);
    });
    // resetsAt 0 means "not reported" — there is no rollover instant to act on,
    // so the value must be left alone rather than zeroed on a guess.
    expect(result.current.data?.session?.usedPercent).toBe(89);
  });

  it('tolerates a null payload', async () => {
    invoke.mockResolvedValue(null);
    const { result } = await mount();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
