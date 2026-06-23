import { describe, it, expect } from 'vitest';
import { tabFlex } from '../../apps/desktop/src/util/tabFlex.js';

describe('tabFlex', () => {
  it('falls back to equal flex when no sizes are known yet', () => {
    expect(tabFlex(undefined, 0)).toBe(1);
    expect(tabFlex([], 0)).toBe(1);
  });

  it('returns a proportional flex grow matching the live panel size', () => {
    const sizes = [70, 30];
    expect(tabFlex(sizes, 0)).toBe('70 1 0');
    expect(tabFlex(sizes, 1)).toBe('30 1 0');
  });

  it('falls back to equal flex for invalid / non-positive sizes', () => {
    expect(tabFlex([0, 100], 0)).toBe(1);
    expect(tabFlex([Number.NaN, 50], 0)).toBe(1);
    expect(tabFlex([50], 5)).toBe(1);
  });
});
