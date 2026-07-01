import { describe, it, expect } from 'vitest';
import { buildTimeOffModel } from '@watchtower/module-timetracker';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';

describe('buildTimeOffModel', () => {
  it('produces a 3-month window centered on focus', () => {
    const m = buildTimeOffModel('2026-06', [], '2026-06-15');
    expect(m.months.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(m.months[1].weeks[0]).toHaveLength(7); // 7 columns
  });

  it('marks a user day off, and user wins over a holiday on the same date', () => {
    const daysOff: DayOffRow[] = [
      { date: '2026-07-06', kind: 'vacation' }, // 2026-07-06 is a Czech holiday (Jan Hus Day)
    ];
    const m = buildTimeOffModel('2026-07', daysOff, '2026-07-01');
    const julCells = m.months.find((x) => x.month === '2026-07')!.weeks.flat();
    const cell = julCells.find((c) => c.date === '2026-07-06')!;
    expect(cell.kind).toBe('vacation'); // user wins
  });

  it('builds an upcoming list of future items, user-wins dedupe, ascending', () => {
    const daysOff: DayOffRow[] = [{ date: '2026-07-06', kind: 'sick' }];
    const m = buildTimeOffModel('2026-06', daysOff, '2026-06-15');
    // first upcoming holiday after 2026-06-15 is 2026-07-05 (holiday), then 2026-07-06 (user 'sick', not 'holiday')
    const item0706 = m.upcoming.find((u) => u.date === '2026-07-06')!;
    expect(item0706.kind).toBe('sick');
    // sorted ascending
    const dates = m.upcoming.map((u) => u.date);
    expect([...dates]).toEqual([...dates].sort());
    // all future
    expect(m.upcoming.every((u) => u.date >= '2026-06-15')).toBe(true);
  });

  it('upcoming includes still-future prior-year holidays visible in the -1 calendar pane (fix: prior-year loop)', () => {
    // focus=2026-01, today=2025-12-20 → Dec 2025 pane is visible; Dec holidays are still future
    const m = buildTimeOffModel('2026-01', [], '2025-12-20');
    const upcomingDates = m.upcoming.map((u) => u.date);
    // Czech public holidays in December: 24th (Christmas Eve), 25th, 26th
    expect(upcomingDates).toContain('2025-12-24');
  });
});
