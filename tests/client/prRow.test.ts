import { describe, it, expect } from 'vitest';
import { initials, avatarColor, reviewStateDisplay } from '../../apps/desktop/src/components/reviews/PrRow.js';

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
  it('reviewStateDisplay: null → grey dot, "not reviewed"', () => {
    expect(reviewStateDisplay(null)).toEqual({ color: 'text.disabled', label: 'not reviewed' });
  });
  it('reviewStateDisplay: running → amber dot, "reviewing…"', () => {
    expect(reviewStateDisplay({ status: 'running', findingCount: 0 })).toEqual({ color: 'warning.main', label: 'reviewing…' });
  });
  it('reviewStateDisplay: done with findings → green dot, "N findings"', () => {
    expect(reviewStateDisplay({ status: 'done', findingCount: 3 })).toEqual({ color: 'success.main', label: '3 findings' });
    expect(reviewStateDisplay({ status: 'done', findingCount: 1 })).toEqual({ color: 'success.main', label: '1 finding' });
  });
  it('reviewStateDisplay: done with no findings → green dot, "no findings"', () => {
    expect(reviewStateDisplay({ status: 'done', findingCount: 0 })).toEqual({ color: 'success.main', label: 'no findings' });
  });
  it('reviewStateDisplay: error → red dot, "review failed"', () => {
    expect(reviewStateDisplay({ status: 'error', findingCount: 0 })).toEqual({ color: 'error.main', label: 'review failed' });
  });
});
