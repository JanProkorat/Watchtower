import { describe, it, expect } from 'vitest';
import { mergeAttention } from '../../packages/module-attention/src/mergeAttention';

describe('mergeAttention', () => {
  it('dedupes by instanceId, thread item wins and is marked hasThread', () => {
    const merged = mergeAttention(
      [{ instanceId: 'i1', label: 'wt', kind: 'waiting-permission', messages: [], unanswered: true, closed: false }],
      [{ instanceId: 'i1', label: 'wt', reason: 'waiting for permission' }, { instanceId: 'i2', label: 'x', reason: 'crashed' }],
    );
    const i1 = merged.find(m => m.instanceId === 'i1')!;
    expect(i1.hasThread).toBe(true);
    expect(merged.find(m => m.instanceId === 'i2')!.hasThread).toBe(false);
    expect(merged.length).toBe(2);
  });
  it('excludes answered/closed threads', () => {
    const merged = mergeAttention(
      [{ instanceId: 'i1', label: 'wt', kind: null, messages: [], unanswered: false, closed: false }],
      [],
    );
    expect(merged.length).toBe(0);
  });
});
