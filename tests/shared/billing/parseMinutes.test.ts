import { describe, it, expect } from 'vitest';
import { parseMinutes } from '@watchtower/shared/billing/parseMinutes.js';

describe('parseMinutes', () => {
  it('parses decimal hours (dot and comma)', () => {
    expect(parseMinutes('1.5')).toBe(90);
    expect(parseMinutes('1,5')).toBe(90);
  });
  it('parses h:mm', () => {
    expect(parseMinutes('1:30')).toBe(90);
    expect(parseMinutes('0:45')).toBe(45);
  });
  it('parses 1h30m / 2h / 45m', () => {
    expect(parseMinutes('1h30m')).toBe(90);
    expect(parseMinutes('2h')).toBe(120);
    expect(parseMinutes('45m')).toBe(45);
  });
  it('returns NaN for empty/garbage', () => {
    expect(parseMinutes('')).toBeNaN();
    expect(parseMinutes('abc')).toBeNaN();
  });
});
