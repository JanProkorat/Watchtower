import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import type { TokenUsageBlock, TokenUsagePayload } from '@watchtower/shared/tokenUsageFormat.js';

// Watchtower has no native source for the Claude Code 5-hour rolling block /
// reset clock — Claude doesn't persist it. `ccusage` reconstructs it from the
// session JSONL transcripts, which is exactly what the user's statusline
// already shells out to. We mirror that here.
//
// `ccusage` is resolved from PATH first (repaired from the user's login shell
// in packaged builds, see electron/shellPath.ts), then from the common Homebrew
// location as a fallback so a stripped launchd PATH still works.
const CCUSAGE_ARGS = ['blocks', '--active', '--json', '--token-limit', 'max'];
const HOMEBREW_CCUSAGE = '/opt/homebrew/bin/ccusage';
const FETCH_TIMEOUT_MS = 20_000;

// ccusage ships as a Node script with a `#!/usr/bin/env node` shebang, so
// launching it (even by absolute path) needs `node` on PATH. macOS hands
// GUI-launched apps a stripped PATH, and the dev orchestrator may not inherit
// the user's full PATH either — in both cases /opt/homebrew/bin (where node +
// ccusage live) is missing and the shebang fails with
// "env: node: No such file or directory". Prepend the usual install dirs so
// both ccusage and its interpreter resolve. mergePaths-style dedup keeps the
// caller's existing PATH entries and their order.
const EXTRA_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', `${homedir()}/.local/bin`];

function augmentedPath(): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...EXTRA_BIN_DIRS, ...(process.env.PATH ?? '').split(':')]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(':');
}

/** Shape of the bits of a ccusage block we consume. Everything is optional —
 *  ccusage's schema drifts across versions, so we read defensively. */
interface RawCcusageBlock {
  startTime?: string;
  endTime?: string;
  isActive?: boolean;
  isGap?: boolean;
  totalTokens?: number;
  tokenCounts?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  models?: string[];
  burnRate?: { tokensPerMinute?: number } | null;
  projection?: { totalTokens?: number } | null;
  tokenLimitStatus?: {
    limit?: number;
    projectedUsage?: number;
    percentUsed?: number;
    status?: string;
  } | null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function normalizeBlock(raw: RawCcusageBlock): TokenUsageBlock | null {
  if (!raw.startTime || !raw.endTime) return null;
  const total = num(raw.totalTokens);
  const tls = raw.tokenLimitStatus ?? null;
  const limit = tls && typeof tls.limit === 'number' && tls.limit > 0 ? tls.limit : null;
  return {
    startTime: raw.startTime,
    endTime: raw.endTime,
    totalTokens: total,
    tokenCounts: {
      inputTokens: num(raw.tokenCounts?.inputTokens),
      outputTokens: num(raw.tokenCounts?.outputTokens),
      cacheCreationInputTokens: num(raw.tokenCounts?.cacheCreationInputTokens),
      cacheReadInputTokens: num(raw.tokenCounts?.cacheReadInputTokens),
    },
    limit,
    // ccusage's percentUsed is the *projected* end-of-block figure; compute the
    // current % ourselves so the card/tray show "used so far", not "will use".
    currentPercentUsed: limit ? (total / limit) * 100 : null,
    projectedPercentUsed: tls && typeof tls.percentUsed === 'number' ? tls.percentUsed : null,
    projectedTotalTokens:
      raw.projection && typeof raw.projection.totalTokens === 'number'
        ? raw.projection.totalTokens
        : null,
    status: tls && typeof tls.status === 'string' ? tls.status : null,
    burnRateTokensPerMinute:
      raw.burnRate && typeof raw.burnRate.tokensPerMinute === 'number'
        ? raw.burnRate.tokensPerMinute
        : null,
    models: Array.isArray(raw.models) ? raw.models.filter((m): m is string => typeof m === 'string') : [],
  };
}

/** Parse ccusage's stdout into a normalized payload. Exported for testing. */
export function parseCcusageOutput(stdout: string, fetchedAt: number): TokenUsagePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { available: false, error: 'ccusage output was not valid JSON', block: null, fetchedAt };
  }
  const blocks = (parsed as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) {
    return { available: false, error: 'ccusage output had no blocks array', block: null, fetchedAt };
  }
  const active = (blocks as RawCcusageBlock[]).find((b) => b.isActive && !b.isGap);
  if (!active) {
    // ccusage ran fine; there just isn't an active session right now.
    return { available: true, block: null, fetchedAt };
  }
  return { available: true, block: normalizeBlock(active), fetchedAt };
}

function run(command: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      CCUSAGE_ARGS,
      {
        timeout: FETCH_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PATH: augmentedPath() },
      },
      (err, stdout, stderr) => {
        if (err) {
          // execFile's default message is just "Command failed: <cmd>" — fold in
          // ccusage's stderr so the surfaced error is actually actionable.
          const trimmed = (stderr ?? '').trim();
          if (trimmed) (err as Error).message = `${(err as Error).message}: ${trimmed}`;
          reject(err);
        } else {
          resolve({ stdout });
        }
      },
    );
  });
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

/**
 * Run ccusage and return a normalized snapshot. Never throws — any failure
 * (ccusage missing, non-zero exit, timeout, bad JSON) resolves to
 * `{ available: false, error }` so callers can render a graceful empty state.
 */
export async function fetchTokenUsage(nowMs: number = Date.now()): Promise<TokenUsagePayload> {
  for (const command of ['ccusage', HOMEBREW_CCUSAGE]) {
    try {
      const { stdout } = await run(command);
      return parseCcusageOutput(stdout, nowMs);
    } catch (err) {
      // Only fall through to the Homebrew path when the binary wasn't found on
      // PATH. Any other error (timeout, crash) is terminal — report it.
      if (command === 'ccusage' && isEnoent(err)) continue;
      const message =
        isEnoent(err)
          ? 'ccusage not found — install it (npm i -g ccusage) to see token usage'
          : err instanceof Error
            ? err.message
            : String(err);
      return { available: false, error: message, block: null, fetchedAt: nowMs };
    }
  }
  return {
    available: false,
    error: 'ccusage not found — install it (npm i -g ccusage) to see token usage',
    block: null,
    fetchedAt: nowMs,
  };
}
