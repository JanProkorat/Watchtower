// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReplayState, ReplayTurn } from '@watchtower/shared/replay.js';

const ipc = vi.hoisted(() => ({ calls: [] as { kind: string; payload: unknown }[], initial: null as unknown }));
vi.mock('../../apps/desktop/src/state/ipc', () => ({
  invoke: vi.fn(async (kind: string, payload: unknown) => {
    ipc.calls.push({ kind, payload });
    return kind === 'replay:get' ? ipc.initial : null;
  }),
}));

import { useReplay, useUnseenSteps } from '../../apps/desktop/src/state/useReplay';

let push: ((s: ReplayState) => void) | undefined;
beforeEach(() => {
  ipc.calls.length = 0;
  ipc.initial = null;
  (window as unknown as { watchtower: unknown }).watchtower = {
    on: (kind: string, cb: (s: ReplayState) => void) => {
      if (kind === 'replay') push = cb;
      return () => {};
    },
  };
});

const step = { file: 'src/a.ts', tool: 'Edit', note: '', added: 1, deleted: 1, lines: [{ kind: 'del' as const, text: 'old' }, { kind: 'add' as const, text: 'new' }] };
const st = (instanceId: string, at: number): ReplayState => ({ instanceId, snapshot: { turn: { at, steps: [step] }, panelToggles: 0, sentAt: at }, receivedAt: at });

describe('useReplay', () => {
  it('loads the initial state and follows pushes for its own instance only', async () => {
    ipc.initial = st('i1', 1);
    const { result } = renderHook(() => useReplay('i1'));
    await waitFor(() => expect(result.current?.snapshot.turn?.at).toBe(1));
    expect(ipc.calls[0]).toEqual({ kind: 'replay:get', payload: { instanceId: 'i1' } });
    act(() => push?.(st('i1', 2)));
    expect(result.current?.snapshot.turn?.at).toBe(2);
    act(() => push?.(st('other', 3)));
    expect(result.current?.snapshot.turn?.at).toBe(2);
  });
});

describe('useUnseenSteps', () => {
  it('counts a turn whose at is 0 as unseen', () => {
    const { result } = renderHook(() => useUnseenSteps({ at: 0, steps: [step, step] }, false));
    expect(result.current).toBe(2);
  });

  it('counts an unseen turn until the tab shows it', () => {
    const t1 = { at: 1, steps: [step, step, step] };
    const { result, rerender } = renderHook(({ turn, showing }) => useUnseenSteps(turn, showing), { initialProps: { turn: t1 as ReplayTurn | null, showing: false } });
    expect(result.current).toBe(3);
    rerender({ turn: t1, showing: true });
    expect(result.current).toBe(0);
    rerender({ turn: t1, showing: false });
    expect(result.current).toBe(0);
    rerender({ turn: { at: 2, steps: [step] }, showing: false });
    expect(result.current).toBe(1);
  });
});
