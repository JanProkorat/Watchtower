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

/** A window that has rolled over: fresh, nothing consumed, next reset unknown. */
const FRESH: RateLimitEntry = { usedPercent: 0, resetsAt: 0 };

function isRolledOver(e: RateLimitEntry | null, nowMs: number): boolean {
  // resetsAt === 0 means "not reported" — no rollover instant to compare against.
  return e !== null && e.resetsAt > 0 && nowMs >= e.resetsAt * 1000;
}

/**
 * Age a snapshot to `nowMs`: any window whose `resetsAt` has passed is a *new*
 * window, so it reports 0% used and an unknown next reset.
 *
 * A snapshot only refreshes when some Claude session renders a statusline, and
 * it is persisted across restarts — without this, an idle rollover leaves the
 * usage bars frozen at the pre-reset percentage indefinitely. Returns the input
 * object unchanged (same reference) when nothing has rolled over, so callers can
 * use it as a render/push guard.
 */
export function rollForwardRateLimits(
  snap: RateLimitsSnapshot | null,
  nowMs: number,
): RateLimitsSnapshot | null {
  if (!snap) return null;
  const sessionStale = isRolledOver(snap.session, nowMs);
  const weekStale = isRolledOver(snap.week, nowMs);
  if (!sessionStale && !weekStale) return snap;
  return {
    session: sessionStale ? FRESH : snap.session,
    week: weekStale ? FRESH : snap.week,
    capturedAt: snap.capturedAt,
  };
}

/**
 * Epoch **ms** of the earliest window reset still in the future, or null when no
 * window reports one. Lets a UI re-evaluate exactly when a window rolls over
 * instead of polling.
 */
export function nextRateLimitResetMs(
  snap: RateLimitsSnapshot | null,
  nowMs: number,
): number | null {
  if (!snap) return null;
  const pending = [snap.session, snap.week]
    .map((e) => (e && e.resetsAt > 0 ? e.resetsAt * 1000 : null))
    .filter((ms): ms is number => ms !== null && ms > nowMs);
  return pending.length ? Math.min(...pending) : null;
}
