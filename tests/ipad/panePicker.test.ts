import { describe, it, expect } from 'vitest';
import { availableInstancesForPicker } from '../../apps/ipad/src/lib/panePicker.js';

describe('availableInstancesForPicker', () => {
  it('removes already-mounted instances, preserving group order', () => {
    expect(availableInstancesForPicker(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
  it('returns empty when all are mounted', () => {
    expect(availableInstancesForPicker(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
  it('is a no-op when nothing is mounted', () => {
    expect(availableInstancesForPicker(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
