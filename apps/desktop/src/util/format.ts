import dayjs from 'dayjs';

export const CZ_DATE_FORMAT = 'D. M. YYYY';
export const CZ_DATE_FORMAT_SHORT = 'D. M.';
export const CZ_MONTH_FORMAT = 'MMMM YYYY';

export function formatDateCz(date: string | null | undefined): string {
  if (!date) return '';
  const d = dayjs(date);
  return d.isValid() ? d.format(CZ_DATE_FORMAT) : String(date);
}

/**
 * "DD MMM YYYY" with Czech short month abbreviations — e.g. "02 led 2026",
 * "30 čvn 2026". Used in the rate-history row design to mirror
 * TimeTracker. Returns "now" for null/undefined so the formatter can be
 * called on an open-ended contract's `endDate` directly.
 */
export function formatDateAbbrCz(date: string | null | undefined): string {
  if (!date) return 'now';
  const d = dayjs(date).locale('cs');
  return d.isValid() ? d.format('DD MMM YYYY') : String(date);
}

export function formatDateShortCz(date: string | null | undefined): string {
  if (!date) return '';
  const d = dayjs(date);
  return d.isValid() ? d.format(CZ_DATE_FORMAT_SHORT) : String(date);
}

export function formatMonthCz(date: string | null | undefined): string {
  if (!date) return '';
  const d = dayjs(date);
  return d.isValid() ? d.format(CZ_MONTH_FORMAT) : String(date);
}

// Czech months in genitive case ("13. května 2026", not "13. květen 2026").
// dayjs cs locale ships only the nominative form in `MMMM`.
const CZ_MONTHS_GENITIVE = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
];

export function formatDateLongCz(date: string | null | undefined): string {
  if (!date) return '';
  const d = dayjs(date);
  if (!d.isValid()) return String(date);
  return `${d.date()}. ${CZ_MONTHS_GENITIVE[d.month()]} ${d.year()}`;
}

export function formatWeekdayDateLongCz(date: string | null | undefined): string {
  if (!date) return '';
  const d = dayjs(date);
  if (!d.isValid()) return String(date);
  return `${d.format('dddd')} ${formatDateLongCz(date)}`;
}

const MONEY_LOCALE = 'cs-CZ';

export function formatEarnings(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: 'currency',
      currency: 'CZK',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} Kč`;
  }
}

export function formatEarningsValue(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat(MONEY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatHours(minutes: number, fractionDigits = 1): string {
  return (minutes / 60).toFixed(fractionDigits);
}

/**
 * Formats an already-computed man-day value. Drops a trailing `.0` for whole
 * numbers (1 → "1", 1.5 → "1.5"). Mirrors the helper in ContractStatusCard so
 * MD figures read consistently across the reports surface.
 */
export function formatMd(md: number | null | undefined, fractionDigits = 1): string {
  if (md == null) return '—';
  if (Math.abs(md - Math.round(md)) < 1e-9) return String(Math.round(md));
  return md.toFixed(fractionDigits);
}

/**
 * Hours formatter that drops trailing `.00` for whole numbers but keeps the
 * full precision otherwise (e.g. 60 → "1", 30 → "0.50", 75 → "1.25").
 */
export function formatHoursTrim(minutes: number, fractionDigits = 2): string {
  const hours = minutes / 60;
  if (Math.abs(hours - Math.round(hours)) < 1e-9) {
    return Math.round(hours).toString();
  }
  return hours.toFixed(fractionDigits);
}

/**
 * Effective minutes for any worklog-shaped record. The server treats
 * reported_minutes as authoritative once it's filled in and falls back
 * to the tracked minutes column until then; the client mirrors that
 * rule for any aggregation that sums across worklogs.
 */
export function effectiveMinutes(w: {
  minutes: number;
  reported_minutes: number | null;
}): number {
  return w.reported_minutes ?? w.minutes;
}

export function formatMinutes(total: number): string {
  if (!total) return '0m';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Switches to man-days at >= 100h so totals don't render as "5301h".
export function formatMinutesReadable(total: number, hoursPerDay = 8): string {
  if (!total) return '0m';
  const totalHours = total / 60;
  if (totalHours < 100) return formatMinutes(total);
  const md = totalHours / (hoursPerDay > 0 ? hoursPerDay : 8);
  return `${md.toFixed(1)} MD`;
}

// Bare numbers are hours ("1" → 60, "1.5" → 90). Comma also accepted as decimal.
// Explicit forms still work: "1h 30m", "30m", "1:30".
export function parseMinutes(input: string): number {
  const trimmed = input.trim().toLowerCase().replace(',', '.');
  if (!trimmed) return NaN;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const hours = Number(trimmed);
    return Math.round(hours * 60);
  }
  const colon = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const hm = trimmed.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (hm && (hm[1] || hm[2])) {
    return Math.round(Number(hm[1] ?? 0) * 60) + Number(hm[2] ?? 0);
  }
  return NaN;
}

export function buildTaskUrl(baseUrl: string | null | undefined, number: string): string | null {
  if (!baseUrl) return null;
  if (baseUrl.includes('{n}')) return baseUrl.replace('{n}', encodeURIComponent(number));
  return baseUrl.replace(/\/?$/, '/') + encodeURIComponent(number);
}
