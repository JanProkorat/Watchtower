import { describe, it, expect } from 'vitest';
import { reconcileAcked, visibleAttention } from '../../apps/ipad/src/state/attentionAck.js';

const item = (instanceId: string) => ({ instanceId, label: instanceId, reason: 'x' });

describe('reconcileAcked', () => {
  it('keeps acked ids still in attention, drops ids that left attention', () => {
    const acked = new Set(['a', 'b', 'c']);
    const attention = new Set(['a', 'c', 'd']); // b left attention
    expect([...reconcileAcked(acked, attention)].sort()).toEqual(['a', 'c']);
  });

  it('returns the same reference when nothing is pruned (so the hook can bail)', () => {
    const acked = new Set(['a', 'b']);
    expect(reconcileAcked(acked, new Set(['a', 'b', 'c']))).toBe(acked);
  });

  it('empty acked stays the same reference', () => {
    const acked = new Set<string>();
    expect(reconcileAcked(acked, new Set(['a']))).toBe(acked);
  });

  it('drops everything when no acked id is still in attention', () => {
    const acked = new Set(['a', 'b']);
    expect([...reconcileAcked(acked, new Set(['c']))]).toEqual([]);
  });
});

describe('visibleAttention', () => {
  it('excludes acknowledged instances', () => {
    const all = [item('a'), item('b'), item('c')];
    expect(visibleAttention(all, new Set(['b'])).map((i) => i.instanceId)).toEqual(['a', 'c']);
  });

  it('returns all when nothing is acknowledged', () => {
    const all = [item('a'), item('b')];
    expect(visibleAttention(all, new Set()).map((i) => i.instanceId)).toEqual(['a', 'b']);
  });
});
