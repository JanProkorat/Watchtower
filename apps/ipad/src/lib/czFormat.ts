// cs-CZ format helpers for the iPad billing module.
// Pure functions — no DOM, no React, no side-effects.

const NBSP = ' '; // non-breaking space used as thousands separator

// ---------------------------------------------------------------------------
// CZK amount: NBSP thousands separator, Kč suffix, no decimals.
// Examples: 142500 → "142 500 Kč", 0 → "0 Kč"
// ---------------------------------------------------------------------------
export function formatCzk(amount: number): string {
  const formatted = new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(amount);
  // Intl.NumberFormat('cs-CZ') already uses NBSP as grouping separator.
  return `${formatted}${NBSP}Kč`;
}

// ---------------------------------------------------------------------------
// Hours: convert minutes to Czech-formatted hours string.
// Uses Czech decimal comma (,) and NBSP before the unit.
// Examples: 90 min → "1,5 h", 60 min → "1 h", 75 min → "1,25 h"
// Rounded to ≤2 decimals (quarter-hour precision) — never raw floats like
// "55,4166666667 h".
// ---------------------------------------------------------------------------
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  // Format with Czech locale (decimal comma); trailing zeros dropped.
  const formatted = new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(hours);
  return `${formatted}${NBSP}h`;
}

// ---------------------------------------------------------------------------
// ISO date → Czech D. M. YYYY (no leading zeros).
// Example: '2026-06-07' → '7. 6. 2026'
// ---------------------------------------------------------------------------
export function formatDateCz(iso: string): string {
  // Parse without timezone conversion: treat the date as local.
  const parts = iso.split('-');
  const year = parseInt(parts[0] ?? '0', 10);
  const month = parseInt(parts[1] ?? '0', 10);
  const day = parseInt(parts[2] ?? '0', 10);
  return `${day}. ${month}. ${year}`;
}
