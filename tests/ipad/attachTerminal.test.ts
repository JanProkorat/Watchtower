// tests/ipad/attachTerminal.test.ts
import { describe, it, expect } from 'vitest';
import { attachTerminal } from '../../apps/ipad/src/lib/attachTerminal.js';

function fakeBridge() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    emitData: (p: unknown) => handlers.get('ptyData')?.forEach((h) => h(p)),
    bridge: {
      invoke: async (kind: string) => {
        if (kind === 'terminalAttach') return { data: 'SNAP', cols: 90, rows: 30 };
        return { ok: true };
      },
      on: (kind: string, h: (p: unknown) => void) => {
        let set = handlers.get(kind); if (!set) { set = new Set(); handlers.set(kind, set); }
        set.add(h);
        return () => set!.delete(h);
      },
    },
  };
}

function fakeBridgeRejecting() {
  let handlerCount = 0;
  return {
    get ptyDataHandlerCount() { return handlerCount; },
    bridge: {
      invoke: async (kind: string) => {
        if (kind === 'terminalAttach') throw new Error('WS drop');
        return { ok: true };
      },
      on: (_kind: string, _h: (p: unknown) => void) => {
        handlerCount++;
        return () => { handlerCount--; };
      },
    },
  };
}

describe('attachTerminal', () => {
  it('cleans up ptyData subscription when terminalAttach rejects', async () => {
    const { bridge, ptyDataHandlerCount } = fakeBridgeRejecting();
    const sink = { write: () => {}, resize: () => {} };
    await expect(attachTerminal(bridge, 'i1', sink)).rejects.toThrow('WS drop');
    expect(ptyDataHandlerCount).toBe(0);
  });

  it('writes snapshot then drains buffered chunks in order, no gap', async () => {
    const { bridge, emitData } = fakeBridge();
    const writes: string[] = [];
    const resizes: Array<[number, number]> = [];
    const sink = { write: (d: string) => writes.push(d), resize: (c: number, r: number) => resizes.push([c, r]) };

    // A chunk arrives during the attach round-trip; it must be buffered, not lost.
    const pending = attachTerminal(bridge, 'i1', sink);
    emitData({ instanceId: 'i1', chunk: 'BUFFERED' });
    const handle = await pending;

    expect(resizes[0]).toEqual([90, 30]);
    expect(writes[0]).toBe('SNAP');
    expect(writes[1]).toBe('BUFFERED');

    // After attach, live chunks write straight through.
    emitData({ instanceId: 'i1', chunk: 'LIVE' });
    expect(writes[2]).toBe('LIVE');

    // Chunks for other instances are ignored.
    emitData({ instanceId: 'other', chunk: 'NOPE' });
    expect(writes).not.toContain('NOPE');

    handle.dispose();
  });
});
