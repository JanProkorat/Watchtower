import { describe, it, expect } from 'vitest';
import { PtySizeOwnership } from '../../orchestrator/ptySizeOwnership.js';

describe('PtySizeOwnership', () => {
  it('first writer becomes owner and its resize applies', () => {
    const o = new PtySizeOwnership();
    const r = o.recordResize('i1', 'mac', 100, 40);
    expect(r).toEqual({ apply: true, cols: 100, rows: 40 });
  });

  it('non-owner resize is stored but not applied', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40); // mac is owner
    const r = o.recordResize('i1', 'ipad', 80, 25);
    expect(r.apply).toBe(false);
  });

  it('focus transfers ownership; the new owner then drives size', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40);
    o.recordResize('i1', 'ipad', 80, 25); // stored, not applied
    o.focus('i1', 'ipad');
    const r = o.recordResize('i1', 'ipad', 80, 25);
    expect(r).toEqual({ apply: true, cols: 80, rows: 25 });
  });

  it('owner disconnect falls back to a surviving client\'s stored dims', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40);
    o.recordResize('i1', 'ipad', 80, 25);
    const reapply = o.clientGone('mac');
    expect(reapply).toEqual([{ instanceId: 'i1', cols: 80, rows: 25 }]);
    // ipad is now owner
    expect(o.recordResize('i1', 'ipad', 81, 26)).toEqual({ apply: true, cols: 81, rows: 26 });
  });

  it('disconnect of a non-owner re-applies nothing', () => {
    const o = new PtySizeOwnership();
    o.recordResize('i1', 'mac', 100, 40);
    o.recordResize('i1', 'ipad', 80, 25);
    expect(o.clientGone('ipad')).toEqual([]);
  });
});
