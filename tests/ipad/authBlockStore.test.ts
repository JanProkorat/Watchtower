import { describe, it, expect } from 'vitest';
import { applyAuthBlock } from '../../apps/ipad/src/state/authBlockStore.js';

describe('applyAuthBlock', () => {
  it('adds an instance when blocked', () => {
    expect([...applyAuthBlock(new Set(), { instanceId: 'i1', blocked: true })]).toEqual(['i1']);
  });
  it('removes an instance when cleared', () => {
    expect([...applyAuthBlock(new Set(['i1']), { instanceId: 'i1', blocked: false })]).toEqual([]);
  });
  it('returns the same set identity when nothing changes', () => {
    const s = new Set(['i1']);
    expect(applyAuthBlock(s, { instanceId: 'i1', blocked: true })).toBe(s);
  });
});
