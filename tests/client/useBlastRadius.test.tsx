// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { BlastRadiusState } from '@watchtower/shared/blastRadius.js';

const ipc = vi.hoisted(() => ({ calls: [] as { kind: string; payload: unknown }[], initial: null as unknown }));
vi.mock('../../apps/desktop/src/state/ipc', () => ({
  invoke: vi.fn(async (kind: string, payload: unknown) => {
    ipc.calls.push({ kind, payload });
    return kind === 'blastRadius:get' ? ipc.initial : { ok: true };
  }),
}));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../../apps/desktop/src/state/useToast', () => ({
  toast: { showInfo: (m: string) => toasts.push(`info ${m}`), showWarning: (m: string) => toasts.push(`warning ${m}`), showError: () => {}, showSuccess: () => {} },
}));

import { useBlastRadius } from '../../apps/desktop/src/state/useBlastRadius';

let push: ((s: BlastRadiusState) => void) | undefined;
beforeEach(() => {
  ipc.calls.length = 0;
  toasts.length = 0;
  ipc.initial = null;
  (window as unknown as { watchtower: unknown }).watchtower = {
    on: (kind: string, cb: (s: BlastRadiusState) => void) => {
      if (kind === 'blastRadius') push = cb;
      return () => {};
    },
  };
});

const hold = { id: 'h1', command: 'rm -rf dist', riskLabel: 'rm -rf', summary: 's', lines: [], more: 0, note: '', startedAt: 1 };
const st = (over: Partial<BlastRadiusState>): BlastRadiusState => ({ instanceId: 'i1', hold: null, decided: null, outcome: null, receivedAt: 1, ...over });

describe('useBlastRadius', () => {
  it('follows pushes for its instance and sends the answer for the pending hold', async () => {
    const { result } = renderHook(() => useBlastRadius('i1'));
    act(() => push?.(st({ hold })));
    expect(result.current.state?.hold?.id).toBe('h1');
    act(() => push?.(st({ instanceId: 'other', hold: null })));
    expect(result.current.state?.hold?.id).toBe('h1');
    act(() => result.current.decide('proceed'));
    expect(ipc.calls.at(-1)).toEqual({ kind: 'blastRadius:decide', payload: { instanceId: 'i1', holdId: 'h1', decision: 'proceed' } });
  });

  it('toasts each new outcome once, with its severity', () => {
    renderHook(() => useBlastRadius('i1'));
    act(() => push?.(st({ outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' } })));
    act(() => push?.(st({ outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' } })));
    act(() => push?.(st({ outcome: { id: 'h2', command: 'git clean -fd', decision: 'timeout' } })));
    expect(toasts).toEqual(['info Blast Radius: running `rm -rf dist`', "warning Blast Radius: didn't run `git clean -fd` (no answer within 10 minutes)"]);
  });

  it('never toasts an outcome that was already there when the pane loaded', async () => {
    ipc.initial = st({ outcome: { id: 'old', command: 'rm x', decision: 'cancel' } });
    const { result } = renderHook(() => useBlastRadius('i1'));
    await waitFor(() => expect(result.current.state?.outcome?.id).toBe('old'));
    act(() => push?.(st({ outcome: { id: 'old', command: 'rm x', decision: 'cancel' } })));
    expect(toasts).toEqual([]);
  });
});
