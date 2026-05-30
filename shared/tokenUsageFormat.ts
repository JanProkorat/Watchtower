// Shared, dependency-free helpers + wire types for Claude Code token-usage
// reporting. Imported by the orchestrator service (produces the payload), the
// Electron tray (renders it into a menu) and the renderer dashboard card, so
// it must stay free of any Node/Electron/DOM/React imports.

/** The active 5-hour rolling block, normalized from `ccusage blocks --active`. */
export interface TokenUsageBlock {
  /** ISO timestamp the block started (first message). */
  startTime: string;
  /** ISO timestamp the block resets — 5h after startTime. The reset clock. */
  endTime: string;
  /** Total tokens consumed in the block (input + output + cache). */
  totalTokens: number;
  tokenCounts: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  /** ccusage's reconstructed token limit for the plan, or null if unknown. */
  limit: number | null;
  /** Current usage as a fraction of the limit (0–100+), null if no limit. */
  currentPercentUsed: number | null;
  /** ccusage's projected end-of-block usage as a % of the limit. */
  projectedPercentUsed: number | null;
  /** Projected total tokens by block end at the current burn rate. */
  projectedTotalTokens: number | null;
  /** ccusage's status flag: 'ok' | 'warning' | 'exceeds'. */
  status: string | null;
  /** Current burn rate in tokens/minute, null if not computed. */
  burnRateTokensPerMinute: number | null;
  /** Model ids seen in the block. */
  models: string[];
}

/** What `tokens:usage` returns and the `tokenUsage` push carries. */
export interface TokenUsagePayload {
  /** True iff ccusage ran and produced parseable output. */
  available: boolean;
  /** Human-readable reason when `available` is false. */
  error?: string;
  /** The active block, or null when ccusage reports no active block. */
  block: TokenUsageBlock | null;
  /** Epoch ms when this snapshot was produced. */
  fetchedAt: number;
}

/**
 * Compact a token count to a short label: 1234 → "1,2k", 144_702_107 → "144,7M".
 * Czech decimal comma per project locale. Values < 1000 are printed verbatim.
 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return String(Math.round(n));
  const units: Array<{ div: number; suffix: string }> = [
    { div: 1_000_000_000, suffix: 'mld' },
    { div: 1_000_000, suffix: 'M' },
    { div: 1_000, suffix: 'k' },
  ];
  for (const { div, suffix } of units) {
    if (n >= div) {
      // One decimal, then strip a trailing ",0" so 1000→"1k" but 144,7M keeps
      // its precision. Czech decimal comma per project locale.
      let s = (n / div).toFixed(1);
      if (s.endsWith('.0')) s = s.slice(0, -2);
      return s.replace('.', ',') + suffix;
    }
  }
  return String(Math.round(n));
}

/** Czech-style fixed-decimal formatting with a comma separator. */
function formatDecimal(n: number, decimals: number): string {
  return n.toFixed(decimals).replace('.', ',');
}

/**
 * Format the time remaining until `endTimeIso` relative to `nowMs` as e.g.
 * "2 h 54 min", "47 min", or "0 min" once elapsed. Returns null on a bad date.
 */
export function formatRemaining(endTimeIso: string, nowMs: number): string | null {
  const end = Date.parse(endTimeIso);
  if (Number.isNaN(end)) return null;
  const mins = Math.max(0, Math.round((end - nowMs) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Minutes remaining until reset, clamped at 0; null on a bad date. */
export function minutesRemaining(endTimeIso: string, nowMs: number): number | null {
  const end = Date.parse(endTimeIso);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - nowMs) / 60_000));
}

/** Format a percentage (0–100+) with one decimal and a Czech comma + sign. */
export function formatPercent(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return formatDecimal(pct, 1) + ' %';
}
