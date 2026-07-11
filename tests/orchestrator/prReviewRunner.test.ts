import { describe, it, expect, vi } from 'vitest';
import {
  parseReviewOutput,
  buildReviewPrompt,
  runReview,
} from '../../orchestrator/services/prReview.js';
import type { Exec } from '../../orchestrator/services/prProviders/types.js';

describe('parseReviewOutput', () => {
  it('parses a result that arrives as a JSON string', () => {
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: JSON.stringify({
        summary: 'ok',
        findings: [
          { file: 'a.ts', line: 3, severity: 'warn', category: 'simplification', summary: 'do this instead' },
        ],
      }),
    });
    const parsed = parseReviewOutput(envelope);
    expect(parsed.summary).toBe('ok');
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]).toMatchObject({ file: 'a.ts', line: 3, severity: 'warn' });
  });

  it('parses a result that arrives as an already-parsed object', () => {
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: { summary: 'looks good', findings: [] },
    });
    const parsed = parseReviewOutput(envelope);
    expect(parsed.summary).toBe('looks good');
    expect(parsed.findings).toEqual([]);
  });

  it('defaults missing findings to an empty array', () => {
    const envelope = JSON.stringify({
      type: 'result', subtype: 'success', is_error: false,
      result: JSON.stringify({ summary: 'no findings key' }),
    });
    const parsed = parseReviewOutput(envelope);
    expect(parsed.findings).toEqual([]);
  });

  it('throws a clear error on malformed stdout', () => {
    expect(() => parseReviewOutput('not json at all')).toThrow(/could not parse review output/);
  });

  it('throws a clear error when the inner result string is not valid JSON', () => {
    const envelope = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'not json' });
    expect(() => parseReviewOutput(envelope)).toThrow(/could not parse review output/);
  });

  it('throws a clear error when the outer envelope is a JSON null literal', () => {
    expect(() => parseReviewOutput('null')).toThrow(/could not parse review output/);
  });

  it('throws a clear error when the inner result is a JSON null literal', () => {
    const envelope = JSON.stringify({ is_error: false, result: 'null' });
    expect(() => parseReviewOutput(envelope)).toThrow(/could not parse review output/);
  });
});

describe('buildReviewPrompt', () => {
  it('mentions the base ref and the JSON schema requirement', () => {
    const prompt = buildReviewPrompt({ title: 'Fix the thing', sourceBranch: 'feature/x', targetBranch: 'main' }, 'refs/wt-review/tgt');
    expect(prompt).toContain('main');
    expect(prompt).toMatch(/JSON schema/i);
  });

  it('uses baseRef in the git diff command', () => {
    const prompt = buildReviewPrompt({ title: 'Fix the thing', sourceBranch: 'feature/x', targetBranch: 'main' }, 'refs/wt-review/tgt');
    expect(prompt).toContain('git diff refs/wt-review/tgt...HEAD');
    expect(prompt).not.toMatch(/git diff main/);
  });
});

describe('runReview', () => {
  const CANNED_ENVELOPE = JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: JSON.stringify({
      summary: 'reviewed',
      findings: [{ file: 'b.ts', line: 7, severity: 'error', category: 'correctness', summary: 'bug here' }],
    }),
  });

  function makeExec(claudeImpl: () => Promise<string>) {
    const calls: { cmd: string; args: string[]; opts?: unknown }[] = [];
    const exec: Exec = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      if (cmd === 'git' && args.includes('worktree') && args.includes('add')) return '';
      if (cmd === 'git' && args.includes('worktree') && args.includes('remove')) return '';
      if (cmd === 'claude') return claudeImpl();
      throw new Error(`unexpected exec call: ${cmd} ${args.join(' ')}`);
    };
    return { exec, calls };
  }

  const PR = { title: 'Add feature', sourceBranch: 'feature/x', targetBranch: 'main' };

  it('adds a worktree, runs claude, parses findings, and removes the worktree', async () => {
    const { exec, calls } = makeExec(async () => CANNED_ENVELOPE);
    const result = await runReview('/clone/path', 'main', 'abc1234deadbeef', PR, { exec, claudeBin: 'claude' });

    expect(result.summary).toBe('reviewed');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ file: 'b.ts', line: 7, severity: 'error' });

    const addCall = calls.find((c) => c.args.includes('add'));
    expect(addCall).toBeDefined();
    expect(addCall!.args).toEqual(expect.arrayContaining(['-C', '/clone/path', 'worktree', 'add', '--detach']));
    expect(addCall!.args).toContain('abc1234deadbeef');

    const removeCall = calls.find((c) => c.args.includes('remove'));
    expect(removeCall).toBeDefined();
    expect(removeCall!.args).toEqual(expect.arrayContaining(['-C', '/clone/path', 'worktree', 'remove', '--force']));

    const claudeCall = calls.find((c) => c.cmd === 'claude');
    expect(claudeCall).toBeDefined();
    expect(claudeCall!.args).toEqual(expect.arrayContaining(['--model', 'opus', '--output-format', 'json', '--permission-mode', 'bypassPermissions']));
  });

  it('still removes the worktree (finally) even when the claude call throws', async () => {
    const { exec, calls } = makeExec(async () => { throw new Error('claude exploded'); });

    await expect(runReview('/clone/path', 'main', 'abc1234deadbeef', PR, { exec, claudeBin: 'claude' }))
      .rejects.toThrow('claude exploded');

    const removeCall = calls.find((c) => c.args.includes('remove'));
    expect(removeCall).toBeDefined();
  });

  it('swallows worktree-remove errors without masking the original result', async () => {
    const exec: Exec = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args.includes('add')) return '';
      if (cmd === 'git' && args.includes('remove')) throw new Error('remove failed');
      if (cmd === 'claude') return CANNED_ENVELOPE;
      throw new Error(`unexpected exec call: ${cmd}`);
    });
    const result = await runReview('/clone/path', 'main', 'abc1234deadbeef', PR, { exec, claudeBin: 'claude' });
    expect(result.summary).toBe('reviewed');
  });
});
