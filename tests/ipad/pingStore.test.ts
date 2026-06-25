import { describe, it, expect } from 'vitest';
import { applyPing, type Ping } from '../../apps/ipad/src/state/pingStore.js';

const p = (id: number): Ping => ({ instanceId: 'i1', pingId: id, kind: 'waiting-permission', title: 't', body: 'b' });

describe('applyPing', () => {
  it('keeps the latest ping', () => {
    expect(applyPing(null, p(1))).toEqual(p(1));
    expect(applyPing(p(1), p(2))).toEqual(p(2));
  });
  it('ignores an older pingId', () => {
    expect(applyPing(p(5), p(3))).toEqual(p(5));
  });
});
