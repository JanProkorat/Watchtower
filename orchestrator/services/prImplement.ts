import path from 'node:path';
import type { PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';

const RESOLVED_STATUSES = new Set(['fixed', 'closed']);

/**
 * The reviewer comments to feed the implement agent: code-anchored (file+line),
 * unresolved, and — when `myAuthor` is known — containing at least one comment
 * from someone other than the PR author.
 *
 * GitHub threads always carry `status: null` (the fetcher does not expose
 * per-thread resolution today), so on GitHub every inline code comment is
 * treated as unresolved; the prompt tells the agent to verify against current
 * code. Azure DevOps threads expose `status`, so fixed/closed are dropped.
 */
export function filterImplementComments(
  threads: PrCommentThreadPayload[],
  myAuthor?: string | null,
): PrCommentThreadPayload[] {
  return threads.filter((t) => {
    if (t.file == null || t.line == null) return false; // code-anchored only
    if (t.status != null && RESOLVED_STATUSES.has(t.status)) return false; // unresolved only
    if (myAuthor) return t.comments.some((c) => c.author !== myAuthor); // from others
    return true;
  });
}

/** Filesystem-safe slug for a repoKey (e.g. `gh:acme/w` → `gh-acme-w`). */
export function sanitizeSlug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Deterministic, stable worktree path for a PR under the managed base dir. */
export function worktreePathFor(baseDir: string, repoKey: string, prNumber: number): string {
  return path.join(baseDir, `${sanitizeSlug(repoKey)}-pr${prNumber}`);
}

/** The initial prompt seeding the interactive session. */
export function buildImplementPrompt(
  pr: { number: number; title: string; repoLabel: string; sourceBranch: string; host: 'github' | 'azdo' },
  threads: PrCommentThreadPayload[],
): string {
  const hash = pr.host === 'github' ? '#' : '!';
  const byFile = new Map<string, PrCommentThreadPayload[]>();
  for (const t of threads) {
    const list = byFile.get(t.file!); if (list) list.push(t); else byFile.set(t.file!, [t]);
  }
  const sections: string[] = [];
  for (const [file, list] of byFile) {
    list.sort((a, b) => (a.line! - b.line!));
    const lines = list.map((t) => {
      const body = t.comments.map((c) => `${c.author}: ${c.body}`).join('\n    ');
      return `  - L${t.line}: ${body}`;
    }).join('\n');
    sections.push(`\`${file}\`\n${lines}`);
  }
  return [
    `You are implementing reviewer feedback on pull request ${hash}${pr.number} — "${pr.title}" (project ${pr.repoLabel}).`,
    ``,
    `You are in a DEDICATED git worktree checked out on the PR's source branch \`${pr.sourceBranch}\`. Work from HEAD here; the user's work-in-progress on other branches is untouched.`,
    ``,
    `Unresolved review comments to address (grouped by file):`,
    ``,
    ...sections,
    ``,
    `Instructions:`,
    `- Implement the requested changes, following this project's CLAUDE.md conventions.`,
    `- Some comments may already be addressed or may be wrong — do not change code for a comment you disagree with or that is already handled; note it and move on.`,
    `- Run this project's tests / typecheck before finishing.`,
    `- Commit your changes on \`${pr.sourceBranch}\` with a clear message.`,
    `- Then ASK the user before running \`git push\` (it updates the live PR). Never force-push.`,
  ].join('\n');
}

export interface PrepareImplementDeps {
  exec: (cmd: string, args: string[]) => Promise<string>;
  fetchComments: () => Promise<PrCommentThreadPayload[]>;
  resolveMyAuthor: () => Promise<string | null>;
  ensureDir: (dir: string) => void;
  baseDir: string;
}
export interface ImplementLaunch { worktreePath: string; prompt: string; commentCount: number; }

export async function prepareImplementLaunch(
  pr: { host: 'github' | 'azdo'; repoKey: string; number: number; title: string; repoLabel: string; sourceBranch: string; clonePath: string },
  deps: PrepareImplementDeps,
): Promise<ImplementLaunch> {
  const myAuthor = await deps.resolveMyAuthor().catch(() => null);
  const threads = filterImplementComments(await deps.fetchComments(), myAuthor);
  if (threads.length === 0) {
    throw new Error('This PR has no unresolved code comments to implement.');
  }
  const worktreePath = worktreePathFor(deps.baseDir, pr.repoKey, pr.number);
  deps.ensureDir(deps.baseDir);
  // Fetch the source branch, then check it out in a fresh worktree. No -B: we
  // never reset an existing local branch (that could drop the user's commits);
  // plain `worktree add <path> <branch>` reuses the local branch if present,
  // else creates it tracking origin/<branch>. Fails if the branch is already
  // checked out elsewhere — surfaced to the user verbatim.
  await deps.exec('git', ['-C', pr.clonePath, 'fetch', '--no-tags', '--force', 'origin', pr.sourceBranch]);
  await deps.exec('git', ['-C', pr.clonePath, 'worktree', 'add', worktreePath, pr.sourceBranch]);
  const prompt = buildImplementPrompt(pr, threads);
  return { worktreePath, prompt, commentCount: threads.length };
}

/**
 * Remove an implement-session worktree when its instance is removed. NON-force:
 * git refuses if the worktree has uncommitted changes, so nothing uncommitted is
 * ever discarded. Committed work survives regardless (it lives on the branch, not
 * the worktree). On failure we warn with the path and leave the worktree in place.
 */
export async function safeRemoveWorktree(
  worktreePath: string | null,
  deps: { exec: (cmd: string, args: string[]) => Promise<string>; warn: (msg: string) => void },
): Promise<void> {
  if (!worktreePath) return;
  try {
    await deps.exec('git', ['-C', worktreePath, 'worktree', 'remove', worktreePath]);
  } catch {
    deps.warn(`Left the worktree at ${worktreePath} (it has uncommitted changes or could not be removed). Remove it manually when done.`);
  }
}
