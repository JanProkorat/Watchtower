import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import type { Exec } from './prProviders/types.js';
import { defaultExec } from './prProviders/exec.js';

const CLAUDE_TIMEOUT_MS = 600_000;

export interface RunClaudeResult { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; aborted: boolean; }

// Spawn-based claude invocation (replaces the old execFile call): (a) ignores stdin
// (stdio: ['ignore', ...]) so claude never prints/waits on the "no stdin data
// received" warning, (b) NEVER rejects on non-zero exit — it resolves with
// {stdout, stderr, code, signal} so the caller can inspect claude's JSON envelope
// (which carries the real is_error reason in stdout even on failure — execFile
// discarded that), (c) supports cancellation via an AbortSignal, (d) enforces the
// timeout by killing the child.
export function runClaudeProcess(
  claudeBin: string, args: string[], cwd: string,
  opts: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs: CLAUDE_TIMEOUT_MS },
): Promise<RunClaudeResult> {
  return new Promise((resolve) => {
    const child = spawn(claudeBin, args, {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],           // stdin=/dev/null → no "no stdin data" warning
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` },
    });
    let stdout = '', stderr = '', aborted = false;
    const cap = 128 * 1024 * 1024;
    child.stdout.on('data', (d) => { if (stdout.length < cap) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 64 * 1024) stderr += d; });
    const timer = setTimeout(() => { aborted = true; child.kill('SIGKILL'); }, opts.timeoutMs);
    const onAbort = () => { aborted = true; child.kill('SIGKILL'); };
    if (opts.signal) { if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener('abort', onAbort, { once: true }); }
    child.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: stderr + String(err), code: null, signal: null, aborted }); });
    child.on('close', (code, signal) => { clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); resolve({ stdout, stderr, code, signal, aborted }); });
  });
}

export interface ReviewRunnerDeps {
  exec?: Exec;
  claudeBin?: string;
  workRoot?: string;
  now?: () => string;
  runClaude?: typeof runClaudeProcess;
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['error', 'warn', 'info'] },
          category: { type: 'string' },
          summary: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['file', 'line', 'severity', 'category', 'summary'],
      },
    },
  },
  required: ['summary', 'findings'],
};

export function buildReviewPrompt(
  pr: { title: string; sourceBranch: string; targetBranch: string },
  baseRef: string,
  language: 'en' | 'cs' = 'en',
): string {
  const base = `You are reviewing a pull request titled "${pr.title}" (branch \`${pr.sourceBranch}\` into \`${pr.targetBranch}\`). ` +
    `Its changes are on this checked-out branch relative to the base ref \`${baseRef}\`. ` +
    `Run \`git diff ${baseRef}...HEAD\` to see the diff, and read surrounding code as needed. ` +
    'Report correctness/logic/security **bugs** AND reuse/simplification/efficiency **quality** issues. ' +
    'For each finding give the repo-relative file, the 1-based line on the new side, a severity (error|warn|info), ' +
    'a short category (e.g. correctness, efficiency, simplification), a one-line summary, and optional detail. ' +
    'Also give a 2-3 sentence overall summary. Output must match the provided JSON schema.';
  if (language === 'cs') {
    return base +
      " Write all human-readable text — the overall summary and every finding's summary and detail — in Czech (čeština). " +
      'Keep the JSON structure, field names, and the severity enum values (error|warn|info) in English.';
  }
  return base;
}

export function parseReviewOutput(stdout: string): { summary: string; findings: PrFindingPayload[] } {
  const fail = (): never => {
    throw new Error(`could not parse review output: ${stdout.slice(0, 200)}`);
  };

  let envelope: { result?: unknown; is_error?: boolean };
  try {
    envelope = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
  } catch {
    return fail();
  }

  if (envelope === null || typeof envelope !== 'object') return fail();

  if (envelope.is_error) {
    const detail = typeof envelope.result === 'string'
      ? envelope.result
      : JSON.stringify(envelope.result ?? (envelope as { error?: unknown }).error ?? '');
    throw new Error(`review failed: ${detail.slice(0, 800)}`);
  }

  let parsed: { summary?: unknown; findings?: unknown };
  if (typeof envelope.result === 'string') {
    try {
      const inner = JSON.parse(envelope.result);
      if (inner === null || typeof inner !== 'object') return fail();
      parsed = inner as { summary?: unknown; findings?: unknown };
    } catch {
      return fail();
    }
  } else if (envelope.result && typeof envelope.result === 'object') {
    parsed = envelope.result as { summary?: unknown; findings?: unknown };
  } else {
    return fail();
  }

  if (typeof parsed.summary !== 'string') return fail();

  return {
    summary: parsed.summary,
    findings: Array.isArray(parsed.findings) ? (parsed.findings as PrFindingPayload[]) : [],
  };
}

export async function runReview(
  clonePath: string,
  baseRef: string,
  headSha: string,
  pr: { title: string; sourceBranch: string; targetBranch: string },
  deps: ReviewRunnerDeps = {},
  signal?: AbortSignal,
  language: 'en' | 'cs' = 'en',
): Promise<{ summary: string; findings: PrFindingPayload[] }> {
  const exec = deps.exec ?? defaultExec;
  const claudeBin = deps.claudeBin ?? 'claude';
  const workRoot = deps.workRoot ?? os.tmpdir();
  const now = deps.now ?? (() => Date.now().toString(36));
  const runClaude = deps.runClaude ?? runClaudeProcess;

  const rand = `${now()}-${Math.random().toString(36).slice(2, 8)}`;
  const worktree = path.join(workRoot, `wt-review-${headSha.slice(0, 7)}-${rand}`);

  await exec('git', ['-C', clonePath, 'worktree', 'add', '--detach', worktree, headSha]);

  try {
    const prompt = buildReviewPrompt(pr, baseRef, language);
    const args = [
      '-p', prompt,
      '--model', 'opus',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(REVIEW_SCHEMA),
      '--permission-mode', 'bypassPermissions',
    ];
    const res = await runClaude(claudeBin, args, worktree, { timeoutMs: CLAUDE_TIMEOUT_MS, signal });
    if (res.aborted) throw new Error('Cancelled');
    if (!res.stdout.trim()) {
      throw new Error(`claude exited ${res.code ?? 'null'}${res.signal ? '/' + res.signal : ''}${res.stderr.trim() ? ': ' + res.stderr.trim().slice(0, 500) : ''}`);
    }
    return parseReviewOutput(res.stdout);
  } finally {
    try {
      await exec('git', ['-C', clonePath, 'worktree', 'remove', '--force', worktree]);
    } catch (err) {
      console.error('[prReview] failed to remove worktree', worktree, err);
    }
  }
}
