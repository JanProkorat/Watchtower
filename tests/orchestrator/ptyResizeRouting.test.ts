import { describe, it, expect } from 'vitest';
import { PtySizeOwnership } from '../../orchestrator/ptySizeOwnership.js';

// Documents the routing contract used in index.ts: only owner resizes touch the pty.
describe('ptyResize routing via ownership', () => {
  it('applies owner resize, suppresses non-owner', () => {
    const o = new PtySizeOwnership();
    const applied: Array<[number, number]> = [];
    const resizePty = (d: { apply: boolean; cols: number; rows: number }) => {
      if (d.apply) applied.push([d.cols, d.rows]);
    };
    resizePty(o.recordResize('i1', 'local', 120, 30)); // owner
    resizePty(o.recordResize('i1', 'ws-1', 80, 24));    // suppressed
    o.focus('i1', 'ws-1');
    resizePty(o.recordResize('i1', 'ws-1', 80, 24));    // now applied
    expect(applied).toEqual([[120, 30], [80, 24]]);
  });
});
