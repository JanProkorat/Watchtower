import { describe, it, expect } from 'vitest';
import { czechHolidays, countWorkdays } from '../../../packages/shared/src/billing/workdays.js';

describe('czechHolidays', () => {
  it('has 13 holidays and includes fixed + Easter-relative dates for 2026', () => {
    const h = czechHolidays(2026);
    expect(h.size).toBe(13);
    expect(h.has('2026-01-01')).toBe(true);  // New Year
    expect(h.has('2026-07-05')).toBe(true);  // Cyril & Methodius
    expect(h.has('2026-12-25')).toBe(true);  // Christmas
    expect(h.has('2026-04-03')).toBe(true);  // Good Friday 2026 (Easter Sun 2026-04-05)
    expect(h.has('2026-04-06')).toBe(true);  // Easter Monday 2026
  });
});

describe('countWorkdays', () => {
  it('counts Mon-Fri minus holidays minus extra non-working', () => {
    // 2026-06-01 (Mon) .. 2026-06-07 (Sun): Mon-Fri = 5 workdays, no holidays
    expect(countWorkdays('2026-06-01', '2026-06-07')).toBe(5);
    // Remove one via extraNonWorking (a booked day off)
    expect(countWorkdays('2026-06-01', '2026-06-07', new Set(['2026-06-03']))).toBe(4);
  });

  it('excludes a public holiday inside the range', () => {
    // 2026-07-05 (Cyril&Methodius) and 2026-07-06 (Hus) are holidays; both fall in this week
    // Week 2026-07-06 (Mon) .. 2026-07-10 (Fri): Mon 07-06 is a holiday → 4 workdays
    expect(countWorkdays('2026-07-06', '2026-07-10')).toBe(4);
  });
});
