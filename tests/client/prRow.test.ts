import { describe, it, expect } from 'vitest';
import { initials, avatarColor } from '../../apps/desktop/src/components/reviews/PrRow.js';

describe('PrRow helpers', () => {
  it('initials: two-part author names use first letter of each part', () => {
    expect(initials('m.kral')).toBe('MK');
    expect(initials('p.novak')).toBe('PN');
  });
  it('initials: single-part author names fall back to first two chars', () => {
    expect(initials('jan')).toBe('JA');
  });
  it('avatarColor is deterministic and returns a palette color', () => {
    const palette = ['#7c5cff', '#22d3ee', '#22c55e', '#f59e0b', '#ef4444', '#3b8fe0', '#c75b86'];
    const c1 = avatarColor('m.kral');
    const c2 = avatarColor('m.kral');
    expect(c1).toBe(c2);
    expect(palette).toContain(c1);
  });
});
