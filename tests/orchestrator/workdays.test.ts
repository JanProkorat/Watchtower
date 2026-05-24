import { describe, it, expect } from 'vitest';
import {
  countWorkdays,
  czechHolidays,
  holidaysInRange,
} from '../../orchestrator/db/workdays.js';

describe('czechHolidays', () => {
  it('returns all 11 fixed-date holidays + Good Friday + Easter Monday', () => {
    const map = czechHolidays(2026);
    expect(map.size).toBe(13);
  });

  it('returns the correct fixed-date holidays', () => {
    const map = czechHolidays(2026);
    expect(map.get('2026-01-01')).toBe('New Year / Restoration Day');
    expect(map.get('2026-05-01')).toBe('Labour Day');
    expect(map.get('2026-05-08')).toBe('Liberation Day');
    expect(map.get('2026-07-05')).toBe('Cyril & Methodius Day');
    expect(map.get('2026-07-06')).toBe('Jan Hus Day');
    expect(map.get('2026-09-28')).toBe('St. Wenceslas Day');
    expect(map.get('2026-10-28')).toBe('Statehood Day');
    expect(map.get('2026-11-17')).toBe('Freedom & Democracy Day');
    expect(map.get('2026-12-24')).toBe('Christmas Eve');
    expect(map.get('2026-12-25')).toBe('Christmas Day');
    expect(map.get('2026-12-26')).toBe("St. Stephen's Day");
  });

  it('computes Easter correctly via Anonymous Gregorian', () => {
    // Easter Sunday 2024 = Mar 31 → Good Friday Mar 29, Easter Monday Apr 1
    const m24 = czechHolidays(2024);
    expect(m24.get('2024-03-29')).toBe('Good Friday');
    expect(m24.get('2024-04-01')).toBe('Easter Monday');
    // Easter Sunday 2025 = Apr 20 → Good Friday Apr 18, Easter Monday Apr 21
    const m25 = czechHolidays(2025);
    expect(m25.get('2025-04-18')).toBe('Good Friday');
    expect(m25.get('2025-04-21')).toBe('Easter Monday');
    // Easter Sunday 2026 = Apr 5 → Good Friday Apr 3, Easter Monday Apr 6
    const m26 = czechHolidays(2026);
    expect(m26.get('2026-04-03')).toBe('Good Friday');
    expect(m26.get('2026-04-06')).toBe('Easter Monday');
  });

  it('caches per-year so repeated calls return identical references', () => {
    expect(czechHolidays(2026)).toBe(czechHolidays(2026));
  });
});

describe('countWorkdays', () => {
  it('counts Mon-Fri across a normal week (no Czech holidays)', () => {
    // 2026-06-01 = Mon, 2026-06-07 = Sun, no holidays in June → 5 workdays.
    expect(countWorkdays('2026-06-01', '2026-06-07')).toBe(5);
  });

  it('subtracts Czech public holidays that fall on a weekday', () => {
    // 2026-05-01 = Fri (Labour Day): Mon-Thu of that week = 4 workdays.
    expect(countWorkdays('2026-04-27', '2026-05-03')).toBe(4);
    // 2026-05-08 = Fri (Liberation Day): Mon-Fri with Friday removed = 4.
    expect(countWorkdays('2026-05-04', '2026-05-10')).toBe(4);
    // Same week, Mon-Fri inclusive: Mon-Thu count, Fri removed → 4.
    expect(countWorkdays('2026-05-04', '2026-05-08')).toBe(4);
  });

  it('does not double-count holidays that already fall on a weekend', () => {
    // 2027-05-01 = Saturday (Labour Day) — full Mon-Fri count
    expect(countWorkdays('2027-04-26', '2027-05-02')).toBe(5);
  });

  it('returns 0 when from > to', () => {
    expect(countWorkdays('2026-05-10', '2026-05-04')).toBe(0);
  });

  it('returns 0 for malformed inputs', () => {
    expect(countWorkdays('not-a-date', '2026-05-10')).toBe(0);
  });

  it('crosses year boundaries correctly', () => {
    // 2025-12-29 (Mon) → 2026-01-02 (Fri)
    // 2025-12-31 is a regular workday in Czech law (Christmas Eve = 24, 25, 26)
    // 2026-01-01 is New Year — Thu — subtracted
    // Days: Mon Tue Wed (Thu=holiday) Fri = 4 workdays
    expect(countWorkdays('2025-12-29', '2026-01-02')).toBe(4);
  });
});

describe('holidaysInRange', () => {
  it('returns only holidays within [from, to] inclusive', () => {
    const may = holidaysInRange('2026-05-01', '2026-05-31');
    expect(may.map((h) => h.date)).toEqual(['2026-05-01', '2026-05-08']);
  });

  it('returns nothing when the range covers no holidays', () => {
    // Feb 2026 has no Czech state holidays
    expect(holidaysInRange('2026-02-01', '2026-02-28')).toEqual([]);
  });

  it('spans year boundaries correctly', () => {
    const res = holidaysInRange('2025-12-20', '2026-01-15');
    expect(res.map((h) => h.date)).toEqual([
      '2025-12-24',
      '2025-12-25',
      '2025-12-26',
      '2026-01-01',
    ]);
  });

  it('output is sorted by date ascending', () => {
    const all = holidaysInRange('2026-01-01', '2026-12-31');
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.date >= all[i - 1]!.date).toBe(true);
    }
  });
});
