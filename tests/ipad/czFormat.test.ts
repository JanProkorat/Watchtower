import { describe, it, expect } from 'vitest';
import { formatCzk, formatHours, formatDateCz } from '../../apps/ipad/src/lib/czFormat.js';
const NBSP = ' ';
describe('czFormat', () => {
  it('formats CZK with NBSP thousands and Kč suffix', () => {
    expect(formatCzk(142500)).toBe(`142${NBSP}500${NBSP}Kč`);
    expect(formatCzk(0)).toBe(`0${NBSP}Kč`);
  });
  it('formats minutes as Czech hours', () => {
    expect(formatHours(90)).toBe(`1,5${NBSP}h`);
  });
  it('formats ISO date as D. M. YYYY', () => {
    expect(formatDateCz('2026-06-07')).toBe('7. 6. 2026');
  });
});
