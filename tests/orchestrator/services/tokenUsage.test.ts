import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable execFile mock. Each test sets `execFileImpl` to drive the
// callback the way the real child_process would.
type ExecCb = (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void;
let execFileImpl: (command: string, args: string[], options: unknown, cb: ExecCb) => void;

vi.mock('node:child_process', () => ({
  execFile: (command: string, args: string[], options: unknown, cb: ExecCb) =>
    execFileImpl(command, args, options, cb),
}));

const { fetchTokenUsage, parseCcusageOutput } = await import(
  '../../../orchestrator/services/tokenUsage.js'
);

const NOW = Date.parse('2026-05-29T12:06:00.000Z');

const ACTIVE_BLOCK_JSON = JSON.stringify({
  blocks: [
    {
      startTime: '2026-05-29T10:00:00.000Z',
      endTime: '2026-05-29T15:00:00.000Z',
      isActive: true,
      isGap: false,
      totalTokens: 144_702_107,
      tokenCounts: {
        inputTokens: 142_072,
        outputTokens: 343_594,
        cacheCreationInputTokens: 4_713_500,
        cacheReadInputTokens: 139_502_941,
      },
      models: ['claude-opus-4-8'],
      burnRate: { tokensPerMinute: 3854.77 },
      projection: { totalTokens: 344_210_519 },
      tokenLimitStatus: { limit: 369_186_587, percentUsed: 93.23, status: 'warning' },
    },
  ],
});

describe('parseCcusageOutput', () => {
  it('normalizes the active block and computes current %', () => {
    const res = parseCcusageOutput(ACTIVE_BLOCK_JSON, NOW);
    expect(res.available).toBe(true);
    expect(res.block).not.toBeNull();
    const b = res.block!;
    expect(b.endTime).toBe('2026-05-29T15:00:00.000Z');
    expect(b.totalTokens).toBe(144_702_107);
    expect(b.limit).toBe(369_186_587);
    // current % is total/limit, NOT ccusage's projected percentUsed
    expect(b.currentPercentUsed).toBeCloseTo((144_702_107 / 369_186_587) * 100, 5);
    expect(b.projectedPercentUsed).toBe(93.23);
    expect(b.burnRateTokensPerMinute).toBeCloseTo(3854.77, 2);
    expect(b.status).toBe('warning');
  });

  it('reports available with a null block when no block is active', () => {
    const json = JSON.stringify({ blocks: [{ isActive: false, isGap: false }] });
    const res = parseCcusageOutput(json, NOW);
    expect(res.available).toBe(true);
    expect(res.block).toBeNull();
  });

  it('skips gap blocks', () => {
    const json = JSON.stringify({
      blocks: [{ isActive: true, isGap: true, startTime: 'x', endTime: 'y' }],
    });
    expect(parseCcusageOutput(json, NOW).block).toBeNull();
  });

  it('treats a missing limit as null (no current %)', () => {
    const json = JSON.stringify({
      blocks: [
        {
          startTime: '2026-05-29T10:00:00.000Z',
          endTime: '2026-05-29T15:00:00.000Z',
          isActive: true,
          totalTokens: 1000,
        },
      ],
    });
    const b = parseCcusageOutput(json, NOW).block!;
    expect(b.limit).toBeNull();
    expect(b.currentPercentUsed).toBeNull();
  });

  it('fails gracefully on non-JSON output', () => {
    const res = parseCcusageOutput('not json at all', NOW);
    expect(res.available).toBe(false);
    expect(res.error).toMatch(/JSON/);
  });

  it('fails gracefully when blocks is missing', () => {
    const res = parseCcusageOutput(JSON.stringify({ foo: 1 }), NOW);
    expect(res.available).toBe(false);
  });
});

describe('fetchTokenUsage', () => {
  beforeEach(() => {
    execFileImpl = () => {
      throw new Error('execFileImpl not set');
    };
  });

  it('returns the parsed payload on success', async () => {
    execFileImpl = (_cmd, _args, _opts, cb) => cb(null, ACTIVE_BLOCK_JSON, '');
    const res = await fetchTokenUsage(NOW);
    expect(res.available).toBe(true);
    expect(res.block?.totalTokens).toBe(144_702_107);
    expect(res.fetchedAt).toBe(NOW);
  });

  it('augments PATH so the `#!/usr/bin/env node` shebang resolves', async () => {
    let seenPath = '';
    execFileImpl = (_cmd, _args, opts, cb) => {
      seenPath = (opts as { env?: { PATH?: string } }).env?.PATH ?? '';
      cb(null, ACTIVE_BLOCK_JSON, '');
    };
    await fetchTokenUsage(NOW);
    // The dir holding node + ccusage must be prepended, else ccusage exits with
    // "env: node: No such file or directory" under a stripped GUI PATH.
    expect(seenPath.split(':')).toContain('/opt/homebrew/bin');
  });

  it('folds ccusage stderr into the surfaced error', async () => {
    execFileImpl = (_cmd, _args, _opts, cb) =>
      cb(new Error('Command failed: ccusage'), '', 'env: node: No such file or directory');
    const res = await fetchTokenUsage(NOW);
    expect(res.available).toBe(false);
    expect(res.error).toContain('env: node: No such file or directory');
  });

  it('falls back to the Homebrew path when ccusage is not on PATH', async () => {
    const seen: string[] = [];
    execFileImpl = (cmd, _args, _opts, cb) => {
      seen.push(cmd);
      if (cmd === 'ccusage') {
        const err = new Error('not found') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        return cb(err, '', '');
      }
      return cb(null, ACTIVE_BLOCK_JSON, '');
    };
    const res = await fetchTokenUsage(NOW);
    expect(seen).toEqual(['ccusage', '/opt/homebrew/bin/ccusage']);
    expect(res.available).toBe(true);
  });

  it('reports a helpful error when ccusage is missing everywhere', async () => {
    execFileImpl = (_cmd, _args, _opts, cb) => {
      const err = new Error('not found') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return cb(err, '', '');
    };
    const res = await fetchTokenUsage(NOW);
    expect(res.available).toBe(false);
    expect(res.error).toMatch(/ccusage not found/);
  });

  it('reports non-ENOENT failures without falling through', async () => {
    let calls = 0;
    execFileImpl = (_cmd, _args, _opts, cb) => {
      calls++;
      return cb(new Error('boom'), '', '');
    };
    const res = await fetchTokenUsage(NOW);
    expect(res.available).toBe(false);
    expect(res.error).toBe('boom');
    expect(calls).toBe(1); // did not retry the Homebrew path
  });
});
