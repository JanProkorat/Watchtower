// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useReviews } from '../../apps/desktop/src/state/useReviews.js';

const listPayload = { pullRequests: [], syncedAt: '2026-07-21T00:00:00.000Z', warnings: [] };
const reviewListPayload = { reviews: [] };

let handlers: Record<string, (payload: unknown) => void>;

beforeEach(() => {
  handlers = {};
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) => {
      if (kind === 'prs:list' || kind === 'prs:refresh') return listPayload;
      if (kind === 'prReview:list') return reviewListPayload;
      return {};
    }),
    on: vi.fn((kind: string, handler: (payload: unknown) => void) => {
      handlers[kind] = handler;
      return () => { delete handlers[kind]; };
    }),
  };
});

describe('useReviews prsChanged', () => {
  it('re-fetches prs:list when a prsChanged push arrives', async () => {
    const { result } = renderHook(() => useReviews());
    await waitFor(() => expect(result.current.loading).toBe(false));

    (window as any).watchtower.invoke.mockClear();

    expect(handlers.prsChanged).toBeTypeOf('function');
    act(() => { handlers.prsChanged?.({}); });

    await waitFor(() => expect((window as any).watchtower.invoke).toHaveBeenCalledWith('prs:list', {}));
  });
});
