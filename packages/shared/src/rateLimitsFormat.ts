// Dependency-free (no Node/DOM/React) — same contract as tokenUsageFormat.ts.

/** One rolling-window limit as reported by Claude Code's statusline JSON. */
export interface RateLimitEntry {
  /** 0–100, from `rate_limits.<window>.used_percentage`. */
  usedPercent: number;
  /** Epoch **seconds**, from `rate_limits.<window>.resets_at`. */
  resetsAt: number;
}

/** Latest usage snapshot captured from a statusline render. */
export interface RateLimitsSnapshot {
  /** 5-hour rolling window; null if absent (API-key users / older CC). */
  session: RateLimitEntry | null;
  /** 7-day rolling window; null if absent. */
  week: RateLimitEntry | null;
  /** Epoch **ms** when the orchestrator received this snapshot. */
  capturedAt: number;
}

/** IPC payload for `rateLimits:usage` and the `rateLimitsUsage` push. */
export type RateLimitsPayload = RateLimitsSnapshot | null;

/** Shape of the relevant slice of Claude Code's statusline JSON. */
export interface StatuslineRateLimits {
  five_hour?: { used_percentage?: number; resets_at?: number } | null;
  seven_day?: { used_percentage?: number; resets_at?: number } | null;
}

/**
 * Extract a snapshot from a parsed statusline JSON body. Returns null when the
 * body carries no usable `rate_limits` (both windows absent). Never throws.
 * @param capturedAt epoch ms (injected for deterministic tests).
 */
export function extractRateLimits(body: unknown, capturedAt: number): RateLimitsSnapshot | null {
  if (!body || typeof body !== 'object') return null;
  const rl = (body as { rate_limits?: StatuslineRateLimits }).rate_limits;
  if (!rl || typeof rl !== 'object') return null;

  const entry = (w: { used_percentage?: number; resets_at?: number } | null | undefined): RateLimitEntry | null => {
    if (!w || typeof w !== 'object') return null;
    const usedPercent = w.used_percentage;
    const resetsAt = w.resets_at;
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return null;
    return { usedPercent, resetsAt: typeof resetsAt === 'number' ? resetsAt : 0 };
  };

  const session = entry(rl.five_hour);
  const week = entry(rl.seven_day);
  if (!session && !week) return null;
  return { session, week, capturedAt };
}
