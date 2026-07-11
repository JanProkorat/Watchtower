import os from 'node:os';
import path from 'node:path';
import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import type { Exec } from './prProviders/types.js';
import { defaultExec } from './prProviders/exec.js';

const CLAUDE_TIMEOUT_MS = 600_000;

export interface ReviewRunnerDeps {
  exec?: Exec;
  claudeBin?: string;
  workRoot?: string;
  now?: () => string;
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

export function buildReviewPrompt(pr: { title: string; sourceBranch: string; targetBranch: string }): string {
  return `You are reviewing a pull request titled "${pr.title}" (branch \`${pr.sourceBranch}\` into \`${pr.targetBranch}\`). ` +
    `Its changes are on this checked-out branch relative to the base ref \`${pr.targetBranch}\`. ` +
    `Run \`git diff ${pr.targetBranch}...HEAD\` to see the diff, and read surrounding code as needed. ` +
    'Report correctness/logic/security **bugs** AND reuse/simplification/efficiency **quality** issues. ' +
    'For each finding give the repo-relative file, the 1-based line on the new side, a severity (error|warn|info), ' +
    'a short category (e.g. correctness, efficiency, simplification), a one-line summary, and optional detail. ' +
    'Also give a 2-3 sentence overall summary. Output must match the provided JSON schema.';
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

  if (envelope.is_error) return fail();

  let parsed: { summary?: unknown; findings?: unknown };
  if (typeof envelope.result === 'string') {
    try {
      parsed = JSON.parse(envelope.result) as { summary?: unknown; findings?: unknown };
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
): Promise<{ summary: string; findings: PrFindingPayload[] }> {
  const exec = deps.exec ?? defaultExec;
  const claudeBin = deps.claudeBin ?? 'claude';
  const workRoot = deps.workRoot ?? os.tmpdir();
  const now = deps.now ?? (() => Date.now().toString(36));

  const rand = `${now()}-${Math.random().toString(36).slice(2, 8)}`;
  const worktree = path.join(workRoot, `wt-review-${headSha.slice(0, 7)}-${rand}`);

  await exec('git', ['-C', clonePath, 'worktree', 'add', '--detach', worktree, headSha]);

  try {
    const prompt = buildReviewPrompt(pr);
    const stdout = await exec(claudeBin, [
      '-p', prompt,
      '--model', 'opus',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(REVIEW_SCHEMA),
      '--permission-mode', 'bypassPermissions',
    ], { cwd: worktree, timeoutMs: CLAUDE_TIMEOUT_MS });
    return parseReviewOutput(stdout);
  } finally {
    try {
      await exec('git', ['-C', clonePath, 'worktree', 'remove', '--force', worktree]);
    } catch (err) {
      console.error('[prReview] failed to remove worktree', worktree, err);
    }
  }
}
