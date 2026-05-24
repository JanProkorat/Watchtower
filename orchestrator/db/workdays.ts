/**
 * Czech public holidays + workday counter, shared by the task grid (Phase 18
 * capacity), contracts (Phase 17 MD budget), and the time-off tab (Phase 19
 * calendar). Output is a Map<YYYY-MM-DD, name> so callers can both check
 * "is this date a holiday" and label cells with the holiday name.
 *
 * Algorithm: Anonymous Gregorian for Easter; everything else is fixed.
 * Czech state holidays per Act No. 245/2000 Sb.
 */

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Anonymous Gregorian — returns Easter Sunday for the given (Gregorian) year. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function addDays(year: number, month: number, day: number, delta: number): {
  year: number;
  month: number;
  day: number;
} {
  const dt = new Date(year, month - 1, day);
  dt.setDate(dt.getDate() + delta);
  return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() };
}

/**
 * Returns the full Czech-state-holiday calendar for the given year.
 * Cached per-year because the computation is pure and the set is small.
 */
const cache = new Map<number, Map<string, string>>();

export function czechHolidays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;

  const map = new Map<string, string>();

  // Fixed-date holidays (per § 1 and § 2 of zákon č. 245/2000 Sb.)
  const FIXED: Array<[number, number, string]> = [
    [1, 1, 'New Year / Restoration Day'],
    [5, 1, 'Labour Day'],
    [5, 8, 'Liberation Day'],
    [7, 5, 'Cyril & Methodius Day'],
    [7, 6, 'Jan Hus Day'],
    [9, 28, 'St. Wenceslas Day'],
    [10, 28, 'Statehood Day'],
    [11, 17, 'Freedom & Democracy Day'],
    [12, 24, 'Christmas Eve'],
    [12, 25, 'Christmas Day'],
    [12, 26, "St. Stephen's Day"],
  ];
  for (const [month, day, name] of FIXED) {
    map.set(ymd(year, month, day), name);
  }

  // Easter-relative holidays
  const easter = easterSunday(year);
  const goodFriday = addDays(year, easter.month, easter.day, -2);
  const easterMonday = addDays(year, easter.month, easter.day, +1);
  map.set(ymd(goodFriday.year, goodFriday.month, goodFriday.day), 'Good Friday');
  map.set(ymd(easterMonday.year, easterMonday.month, easterMonday.day), 'Easter Monday');

  cache.set(year, map);
  return map;
}

/**
 * Mon-Fri count for the period, minus Czech public holidays that fell on a
 * weekday. Returns whole-day workdays — no fractions. Bounds are inclusive
 * and expressed as YYYY-MM-DD strings.
 */
export function countWorkdays(from: string, to: string): number {
  if (from > to) return 0;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (
    fy === undefined ||
    fm === undefined ||
    fd === undefined ||
    ty === undefined ||
    tm === undefined ||
    td === undefined
  ) {
    return 0;
  }
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  // Holiday cache by year — only fetch as we cross year boundaries.
  let lastYear = -1;
  let holidayMap: Map<string, string> = new Map();
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    if (d.getFullYear() !== lastYear) {
      lastYear = d.getFullYear();
      holidayMap = czechHolidays(lastYear);
    }
    const key = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (holidayMap.has(key)) continue;
    count++;
  }
  return count;
}

/** Returns the holidays whose date falls inside [from, to]. */
export function holidaysInRange(from: string, to: string): PublicHoliday[] {
  if (from > to) return [];
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const out: PublicHoliday[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const map = czechHolidays(y);
    for (const [date, name] of map) {
      if (date >= from && date <= to) out.push({ date, name });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
