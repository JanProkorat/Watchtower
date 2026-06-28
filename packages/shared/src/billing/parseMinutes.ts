/**
 * Parse a human minutes/hours string into integer minutes.
 * Accepts: "1.5"/"1,5" (decimal hours), "1:30" (h:mm), "1h30m"/"2h"/"45m".
 * Returns NaN for empty or unrecognised input.
 */
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
