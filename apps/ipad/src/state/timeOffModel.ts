import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import { czechHolidays } from '@watchtower/shared/billing/workdays.js';
import { czechMonthLabel, addMonths } from '@watchtower/ui-core';

export type TimeOffKind = 'vacation' | 'sick' | 'other' | 'holiday';
export interface CalDay { date: string | null; kind: TimeOffKind | null; isWeekend: boolean }
export interface MonthCal { month: string; label: string; weeks: CalDay[][] }
export interface UpcomingItem { date: string; kind: TimeOffKind; note: string | null }
export interface TimeOffModel { months: MonthCal[]; upcoming: UpcomingItem[] }

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function normalizeKind(k: string): TimeOffKind {
  return k === 'vacation' || k === 'sick' || k === 'other' ? k : 'other';
}

function buildMonth(month: string, daysOff: Map<string, TimeOffKind>, holidays: Map<string, string>): MonthCal {
  const parts = month.split('-');
  const y = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '1', 10);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first leading pad: JS getUTCDay() Sun=0..Sat=6 → Mon=0..Sun=6
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

  const cells: CalDay[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ date: null, kind: null, isWeekend: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${pad2(m)}-${pad2(d)}`;
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const kind: TimeOffKind | null = daysOff.get(date) ?? (holidays.has(date) ? 'holiday' : null);
    cells.push({ date, kind, isWeekend });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, kind: null, isWeekend: false });

  const weeks: CalDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { month, label: czechMonthLabel(month), weeks };
}

export function buildTimeOffModel(focusMonth: string, daysOff: DayOffRow[], today: string): TimeOffModel {
  const userByDate = new Map<string, TimeOffKind>();
  for (const d of daysOff) userByDate.set(d.date, normalizeKind(d.kind));

  const focusYear = parseInt(focusMonth.slice(0, 4), 10);
  const holidays = new Map<string, string>();
  for (const yr of [focusYear - 1, focusYear, focusYear + 1]) {
    for (const [date, name] of czechHolidays(yr)) holidays.set(date, name);
  }

  const months = [addMonths(focusMonth, -1), focusMonth, addMonths(focusMonth, 1)].map((mm) =>
    buildMonth(mm, userByDate, holidays),
  );

  // Upcoming: future user days_off ∪ holidays (prior year + focus year + next), user wins, asc, cap 30.
  // Include focusYear-1 because the -1 calendar pane can show still-future prior-year holidays (e.g. Dec when focus=Jan).
  const upcomingByDate = new Map<string, UpcomingItem>();
  for (const yr of [focusYear - 1, focusYear, focusYear + 1]) {
    for (const [date, name] of czechHolidays(yr)) {
      if (date >= today) upcomingByDate.set(date, { date, kind: 'holiday', note: name });
    }
  }
  for (const [date, kind] of userByDate) {
    if (date >= today) upcomingByDate.set(date, { date, kind, note: null }); // user wins
  }
  const upcoming = [...upcomingByDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, 30);

  return { months, upcoming };
}
