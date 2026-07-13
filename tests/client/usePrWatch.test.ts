// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePrWatch } from '../../apps/desktop/src/state/usePrWatch.js';

beforeEach(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) =>
      kind === 'prWatch:list'
        ? { items: [{ host: 'github', repoKey: 'acme/w', repoLabel: 'w', prNumber: 42, title: 'Add thing', myRole: 'author', approved: true, mergeable: true, mergeBlockedReason: null, latestEvent: 'pr-approved', latestAt: 'x', unread: true }], unread: 1 }
        : { ok: true }),
    on: vi.fn(() => () => {}),
  };
});

describe('usePrWatch', () => {
  it('loads the inbox and exposes unread count', async () => {
    const { result } = renderHook(() => usePrWatch());
    await waitFor(() => expect(result.current.unread).toBe(1));
    expect(result.current.items[0].prNumber).toBe(42);
  });

  it('markSeen invokes the IPC and refreshes', async () => {
    const { result } = renderHook(() => usePrWatch());
    await waitFor(() => expect(result.current.unread).toBe(1));
    await act(async () => { await result.current.markSeen('github', 'acme/w', 42); });
    expect((window as any).watchtower.invoke).toHaveBeenCalledWith('prWatch:markSeen', { host: 'github', repoKey: 'acme/w', prNumber: 42 });
  });

  it('surfaces a failed prWatch:list via the error field instead of a silent empty inbox', async () => {
    (window as any).watchtower.invoke = vi.fn(async () => { throw new Error('list boom'); });
    const { result } = renderHook(() => usePrWatch());
    await waitFor(() => expect(result.current.error).toBe('list boom'));
    expect(result.current.items).toEqual([]);
    expect(result.current.unread).toBe(0);
  });
});
