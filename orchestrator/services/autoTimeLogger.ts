/** Gaps between consecutive activity pings longer than this count as idle. */
export const IDLE_CAP_MS = 10 * 60 * 1000;

/** Local YYYY-MM-DD for an epoch-ms timestamp. */
export function localDateStr(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Capped-gap active minutes grouped by local work date. For each consecutive
 * pair of pings the elapsed time (capped at idleCapMs) is credited to the
 * local date of the EARLIER ping. A lone ping has no measurable duration → 0.
 * A gap that straddles midnight is credited whole to the earlier day; since
 * gaps are capped at idleCapMs (10 min) the misattribution is bounded and
 * accepted (see the design's edge-cases section).
 */
export function activeMinutesByDate(
  pings: number[],
  idleCapMs: number,
): Map<string, number> {
  const sorted = [...pings].sort((a, b) => a - b);
  const msByDate = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.min(sorted[i]! - sorted[i - 1]!, idleCapMs);
    if (gap <= 0) continue;
    const date = localDateStr(sorted[i - 1]!);
    msByDate.set(date, (msByDate.get(date) ?? 0) + gap);
  }
  const minutesByDate = new Map<string, number>();
  for (const [date, ms] of msByDate) {
    minutesByDate.set(date, Math.round(ms / 60000));
  }
  return minutesByDate;
}
