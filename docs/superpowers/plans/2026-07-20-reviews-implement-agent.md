# "Implement review comments" agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button on the user's own PRs that spawns an interactive Claude Code session in a dedicated git worktree on the PR's source branch, pre-loaded with the unresolved code-anchored reviewer comments.

**Architecture:** A new pure helper module (`orchestrator/services/prImplement.ts`) does the testable work — filter comments, build the prompt, compute the worktree path, and orchestrate `git fetch` + `git worktree add` via an injectable `Exec`. A thin `prImplement:start` IPC handler wires it to the existing instance-spawn path (`spawnPtyForInstance`) with `cwd = worktree`. The worktree path is persisted on the instance row (migration v25) so closing the session can clean it up safely (non-force `git worktree remove`, which refuses if there are uncommitted changes). The renderer adds a gated button in `PrInspectorDrawer` and focuses the new session via an App-level callback.

**Tech Stack:** TypeScript, Node `child_process`/node-pty (existing `PtyManager`), better-sqlite3 + `node:sqlite` (migrations), React + MUI v5, vitest.

## Global Constraints

- UI text is **English**; no i18n. (repo CLAUDE.md)
- Migrations: **new version is v25** (current max is v24 — CLAUDE.md's "v5" is stale). Use only **constant/NULL** ADD COLUMN defaults (node:sqlite vs better-sqlite3 divergence — memory `sqlite-add-column-engine-divergence`).
- All renderer IPC goes through `invoke()` in `apps/desktop/src/state/ipc.ts`; failures toast automatically — do **not** add inline `<Alert>` for IPC rejections. (repo CLAUDE.md "Surfacing IPC errors")
- New IPC kind must be: added to `IpcRequest` + `IpcResponse` in `packages/shared/src/ipcContract.ts`, mirrored in `packages/shared/src/messagePort.ts`, and (since it needs Azure PATs) added to the devopsPats-injection branch in `electron/ipc.ts:184-185`. It proxies to the orchestrator, so it is **NOT** electron-only.
- Interactive `claude` launch = positional prompt (NO `-p`), default permission mode (NOT `bypassPermissions`). Confirmed: `claude --session-id <uuid> "<prompt>"` seeds the first turn and stays interactive.
- Never force-remove a worktree with uncommitted work. Never force-push.
- `npm test` must stay green (currently **1374** tests); every task adds tests. Typecheck: `npm run typecheck:ci`.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Persist `worktreePath` on the instance row (migration v25 + plumbing)

**Files:**
- Modify: `orchestrator/db/migrations.ts` (append a v25 migration after the v24 entry, before the runner at line ~508)
- Modify: `packages/shared/src/stateModel.ts` (`InstanceRow` interface, line ~30)
- Modify: `orchestrator/db/repositories/instances.ts` (`DbInstanceRow` type, `toRow`, `insert`)
- Modify: `orchestrator/index.ts` (`spawnInstance` insert at 790-807 — add `worktreePath: null`)
- Test: `tests/orchestrator/instancesWorktreeColumn.test.ts` (new)

**Interfaces:**
- Produces: `InstanceRow.worktreePath: string | null`; `instances.worktree_path` TEXT column; `InstancesRepo.insert` persists it; `InstancesRepo.get(id)` returns it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/instancesWorktreeColumn.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { InstancesRepo } from '../../orchestrator/db/repositories/instances.js';

describe('instances.worktree_path (v25)', () => {
  it('round-trips worktreePath through insert/get', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db as any);
    const repo = new InstancesRepo(db as any);
    repo.insert({
      id: 'i1', cwd: '/tmp/wt', status: 'spawning', claudeSessionId: 'i1',
      spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null,
      resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null, kind: 'claude',
      taskId: null, worktreePath: '/home/u/.watchtower/worktrees/repo-pr7',
    });
    expect(repo.get('i1')?.worktreePath).toBe('/home/u/.watchtower/worktrees/repo-pr7');
  });

  it('defaults worktreePath to null for rows that do not set it', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db as any);
    const repo = new InstancesRepo(db as any);
    repo.insert({
      id: 'i2', cwd: '/tmp', status: 'working', claudeSessionId: null,
      spawnedAt: 1, lastActivityAt: 1, exitCode: null, terminationReason: null,
      resumedFromInstanceId: null, jiraKeyHint: null, argsJson: null, kind: 'shell',
      taskId: null, worktreePath: null,
    });
    expect(repo.get('i2')?.worktreePath).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/instancesWorktreeColumn.test.ts`
Expected: FAIL — `worktreePath` not in `InstanceRow` type / column missing.

- [ ] **Step 3: Add the migration** (append to the `migrations` array in `orchestrator/db/migrations.ts`, after the v24 entry)

```ts
  {
    version: 25,
    up: (db: SqliteLike) => {
      // Constant default (NULL) only — a non-constant ADD COLUMN default diverges
      // between node:sqlite (tests) and better-sqlite3 (prod). Nullable: only the
      // Reviews "implement review comments" agent sets it; every other instance
      // (interactive spawns, shells) leaves it NULL.
      db.exec(`ALTER TABLE instances ADD COLUMN worktree_path TEXT`);
    },
  },
```

- [ ] **Step 4: Add `worktreePath` to the shared `InstanceRow`** (`packages/shared/src/stateModel.ts`, inside the interface)

```ts
  /** For a Reviews "implement comments" session: the dedicated git worktree the
   *  session runs in, so closing the instance can clean it up. Null otherwise. */
  worktreePath: string | null;
```

- [ ] **Step 5: Plumb it through the repo** (`orchestrator/db/repositories/instances.ts`)

Add `worktree_path: string | null;` to `DbInstanceRow`. In `toRow`, add `worktreePath: r.worktree_path,`. In `insert`, add `worktree_path` to the column list and one more `?`, and pass `row.worktreePath` in the `.run(...)` args (place it right after `row.kind`, before `displayOrder`, and add `worktree_path` in the column list right after `kind`).

- [ ] **Step 6: Fix the `spawnInstance` insert** (`orchestrator/index.ts`, in the object passed to `repo().insert({...})` at ~790-807)

Add `worktreePath: null,` to that object literal (normal interactive spawns have no worktree).

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/orchestrator/instancesWorktreeColumn.test.ts && npm run typecheck:ci`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add orchestrator/db/migrations.ts packages/shared/src/stateModel.ts orchestrator/db/repositories/instances.ts orchestrator/index.ts tests/orchestrator/instancesWorktreeColumn.test.ts
git commit -m "feat(reviews): persist worktree_path on instances (migration v25)"
```

---

### Task 2: Pure `prImplement` helpers (filter + prompt + path)

**Files:**
- Create: `orchestrator/services/prImplement.ts`
- Test: `tests/orchestrator/prImplement.test.ts`

**Interfaces:**
- Consumes: `PrCommentThreadPayload`, `PullRequestPayload` from `@watchtower/shared/ipcContract.js`.
- Produces:
  - `filterImplementComments(threads: PrCommentThreadPayload[], myAuthor?: string | null): PrCommentThreadPayload[]`
  - `buildImplementPrompt(pr: { number: number; title: string; repoLabel: string; sourceBranch: string; host: 'github' | 'azdo' }, threads: PrCommentThreadPayload[]): string`
  - `sanitizeSlug(s: string): string`
  - `worktreePathFor(baseDir: string, repoKey: string, prNumber: number): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/orchestrator/prImplement.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { filterImplementComments, buildImplementPrompt, sanitizeSlug, worktreePathFor } from '../../orchestrator/services/prImplement.js';

const thread = (o: Partial<any> = {}) => ({
  id: 't', file: 'src/a.ts', line: 10, status: null,
  comments: [{ author: 'reviewer', date: '2026-07-20T00:00:00Z', body: 'rename this' }], ...o,
});

describe('filterImplementComments', () => {
  it('keeps code-anchored threads (file + line present)', () => {
    const kept = filterImplementComments([thread(), thread({ id: 'g', file: null, line: null })]);
    expect(kept.map((t) => t.id)).toEqual(['t']);
  });
  it('drops azdo threads marked fixed/closed, keeps active/null', () => {
    const kept = filterImplementComments([
      thread({ id: 'a', status: 'active' }), thread({ id: 'f', status: 'fixed' }),
      thread({ id: 'c', status: 'closed' }), thread({ id: 'n', status: null }),
    ]);
    expect(kept.map((t) => t.id).sort()).toEqual(['a', 'n']);
  });
  it('when myAuthor given, drops threads with no comment from someone else', () => {
    const kept = filterImplementComments([
      thread({ id: 'mine', comments: [{ author: 'me', date: 'x', body: 'note to self' }] }),
      thread({ id: 'theirs', comments: [{ author: 'reviewer', date: 'x', body: 'fix' }] }),
    ], 'me');
    expect(kept.map((t) => t.id)).toEqual(['theirs']);
  });
  it('when myAuthor omitted, does not apply the authorship filter', () => {
    const kept = filterImplementComments([thread({ id: 'mine', comments: [{ author: 'me', date: 'x', body: 'n' }] })]);
    expect(kept.map((t) => t.id)).toEqual(['mine']);
  });
});

describe('buildImplementPrompt', () => {
  const pr = { number: 7, title: 'Add widget', repoLabel: 'Spot', sourceBranch: 'feat/widget', host: 'github' as const };
  it('includes PR context, the source branch, grouped comments, and push-gated instructions', () => {
    const p = buildImplementPrompt(pr, [thread({ file: 'src/a.ts', line: 10, comments: [{ author: 'rev', date: 'x', body: 'rename foo' }] })]);
    expect(p).toContain('#7');
    expect(p).toContain('Add widget');
    expect(p).toContain('feat/widget');
    expect(p).toContain('src/a.ts');
    expect(p).toContain('rename foo');
    expect(p.toLowerCase()).toContain('ask'); // ask before push
    expect(p.toLowerCase()).toContain('push');
    expect(p.toLowerCase()).toContain('never force');
  });
});

describe('worktreePathFor / sanitizeSlug', () => {
  it('sanitizes repoKey and builds a stable path', () => {
    expect(sanitizeSlug('azdo:dev.azure.com/o/r')).toBe('azdo-dev.azure.com-o-r');
    expect(worktreePathFor('/base', 'gh:acme/w', 7)).toBe('/base/gh-acme-w-pr7');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/prImplement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// orchestrator/services/prImplement.ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/prImplement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/prImplement.ts tests/orchestrator/prImplement.test.ts
git commit -m "feat(reviews): pure helpers to filter comments + build implement prompt"
```

---

### Task 3: `prepareImplementLaunch` orchestration (git fetch + worktree add, injectable)

**Files:**
- Modify: `orchestrator/services/prImplement.ts`
- Test: `tests/orchestrator/prImplement.test.ts` (extend)

**Interfaces:**
- Consumes: an injectable `Exec` (same shape as `orchestrator/services/prProviders/exec.ts`: `(cmd: string, args: string[]) => Promise<string>`).
- Produces:
  ```ts
  interface PrepareImplementDeps {
    exec: (cmd: string, args: string[]) => Promise<string>;
    fetchComments: () => Promise<PrCommentThreadPayload[]>;
    resolveMyAuthor: () => Promise<string | null>;
    ensureDir: (dir: string) => void;      // mkdir -p
    baseDir: string;
  }
  interface ImplementLaunch { worktreePath: string; prompt: string; commentCount: number; }
  prepareImplementLaunch(
    pr: { host: 'github'|'azdo'; repoKey: string; number: number; title: string; repoLabel: string; sourceBranch: string; clonePath: string },
    deps: PrepareImplementDeps,
  ): Promise<ImplementLaunch>
  ```

- [ ] **Step 1: Write the failing tests** (append to `tests/orchestrator/prImplement.test.ts`)

```ts
import { prepareImplementLaunch } from '../../orchestrator/services/prImplement.js';

describe('prepareImplementLaunch', () => {
  const basePr = { host: 'github' as const, repoKey: 'gh:acme/w', number: 7, title: 'Add widget', repoLabel: 'Spot', sourceBranch: 'feat/widget', clonePath: '/repo' };
  const okThreads = [{ id: 't', file: 'src/a.ts', line: 3, status: null, comments: [{ author: 'rev', date: 'x', body: 'fix' }] }];

  it('fetches the source branch and adds a worktree on it, returning prompt + path', async () => {
    const calls: string[][] = [];
    const launch = await prepareImplementLaunch(basePr, {
      exec: async (cmd, args) => { calls.push([cmd, ...args]); return ''; },
      fetchComments: async () => okThreads as any,
      resolveMyAuthor: async () => 'me',
      ensureDir: () => {},
      baseDir: '/base',
    });
    expect(launch.worktreePath).toBe('/base/gh-acme-w-pr7');
    expect(launch.commentCount).toBe(1);
    expect(launch.prompt).toContain('src/a.ts');
    // git fetch origin feat/widget
    expect(calls.some((c) => c.join(' ') === 'git -C /repo fetch --no-tags --force origin feat/widget')).toBe(true);
    // git worktree add <path> feat/widget  (no -B: never resets an existing local branch)
    expect(calls.some((c) => c.join(' ') === 'git -C /repo worktree add /base/gh-acme-w-pr7 feat/widget')).toBe(true);
  });

  it('throws when there are no qualifying comments (nothing to implement)', async () => {
    await expect(prepareImplementLaunch(basePr, {
      exec: async () => '',
      fetchComments: async () => [{ id: 'g', file: null, line: null, status: null, comments: [{ author: 'rev', date: 'x', body: 'lgtm' }] }] as any,
      resolveMyAuthor: async () => 'me',
      ensureDir: () => {}, baseDir: '/base',
    })).rejects.toThrow(/no unresolved code comments/i);
  });

  it('propagates a git worktree-add failure (e.g. branch already checked out)', async () => {
    await expect(prepareImplementLaunch(basePr, {
      exec: async (_cmd, args) => { if (args.includes('add')) throw new Error("fatal: 'feat/widget' is already checked out"); return ''; },
      fetchComments: async () => okThreads as any,
      resolveMyAuthor: async () => 'me',
      ensureDir: () => {}, baseDir: '/base',
    })).rejects.toThrow(/already checked out/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/prImplement.test.ts`
Expected: FAIL — `prepareImplementLaunch` not exported.

- [ ] **Step 3: Implement** (append to `orchestrator/services/prImplement.ts`)

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/orchestrator/prImplement.test.ts && npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/services/prImplement.ts tests/orchestrator/prImplement.test.ts
git commit -m "feat(reviews): prepareImplementLaunch (fetch + worktree add, injectable)"
```

---

### Task 4: IPC contract for `prImplement:start`

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (request ~104, response ~787, and add nothing to `ELECTRON_ONLY_KINDS`)
- Modify: `packages/shared/src/messagePort.ts` (mirror request ~152 + response ~687)
- Modify: `electron/ipc.ts` (add `prImplement:start` to the devopsPats-injection branch at 184-185)
- Test: `tests/shared/ipcContractPrImplement.test.ts` (new, type-level smoke)

**Interfaces:**
- Produces IPC kind `prImplement:start`:
  - request payload: `{ host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> }`
  - response payload: `{ instanceId: string | null; worktreePath: string | null; error?: string }`

- [ ] **Step 1: Add the request** to `IpcRequest` in `ipcContract.ts` (next to `prReview:start` at line 104)

```ts
  | { kind: 'prImplement:start'; payload: { host: PrHost; repoKey: string; prNumber: number; devopsPats?: Record<string, string> } }
```

- [ ] **Step 2: Add the response** to `IpcResponse` (next to `prReview:start` at line 787)

```ts
  | { kind: 'prImplement:start'; payload: { instanceId: string | null; worktreePath: string | null; error?: string } }
```

- [ ] **Step 3: Mirror into `messagePort.ts`** — add the same request (with an `id: string;` field, matching the sibling `spawnInstance`/`prReview:start` shapes at lines 5/152) and the same response (line ~687).

- [ ] **Step 4: Inject devopsPats in electron** (`electron/ipc.ts:184`) — extend the condition:

```ts
      if (kind === 'prs:refresh' || kind === 'prs:diff' || kind === 'prs:comments' || kind === 'prReview:postComments'
        || kind === 'prs:merge' || kind === 'prs:reviewState' || kind === 'prs:approve' || kind === 'prs:close'
        || kind === 'prImplement:start') {
```

- [ ] **Step 5: Write a type-level smoke test**

```ts
// tests/shared/ipcContractPrImplement.test.ts
import { describe, it, expect } from 'vitest';
import type { IpcRequest, IpcResponse } from '../../packages/shared/src/ipcContract.js';

describe('prImplement:start contract', () => {
  it('request and response types line up', () => {
    const req: Extract<IpcRequest, { kind: 'prImplement:start' }> =
      { kind: 'prImplement:start', payload: { host: 'github', repoKey: 'gh:a/b', prNumber: 1 } };
    const res: Extract<IpcResponse, { kind: 'prImplement:start' }> =
      { kind: 'prImplement:start', payload: { instanceId: 'x', worktreePath: '/p' } };
    expect(req.payload.prNumber).toBe(1);
    expect(res.payload.instanceId).toBe('x');
  });
});
```

- [ ] **Step 6: Run typecheck + test**

Run: `npm run typecheck:ci && npx vitest run tests/shared/ipcContractPrImplement.test.ts`
Expected: PASS (typecheck is the real gate here).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts electron/ipc.ts tests/shared/ipcContractPrImplement.test.ts
git commit -m "feat(reviews): prImplement:start IPC contract + electron PAT injection"
```

---

### Task 5: Orchestrator `prImplement:start` handler + spawn

**Files:**
- Modify: `orchestrator/index.ts` (new case near `prReview:start` ~1461; imports at top)
- Test: covered by Task 3's `prepareImplementLaunch` unit tests (handler is thin glue; verified end-to-end in Task 8). No new unit test file — the handler wires tested units to `spawnPtyForInstance`.

**Interfaces:**
- Consumes: `prepareImplementLaunch`, `ImplementLaunch` (Task 3); `reviewsSvc().resolveRepoAndPr` / `.resolveRepos` / `.comments`; `resolveGithubLogin`; `spawnPtyForInstance`; `repo()` (InstancesRepo); `randomUUID`, `homedir`, `path`, `fs`.
- Produces: handles `prImplement:start`, returns `{ instanceId, worktreePath }`.

- [ ] **Step 1: Add the handler** (in the big `switch` in `orchestrator/index.ts`, after the `prReview:*` cases)

```ts
    case 'prImplement:start': {
      const p = req.payload;
      // Reuse the review resolver to get the local clone path + the PR's source
      // branch (it also fetches, harmlessly). Then resolve the repoLabel for the
      // prompt from resolveRepos().
      const target = await reviewsSvc().resolveRepoAndPr(p.host, p.repoKey, p.prNumber);
      if (!target) throw new Error(`Cannot resolve repo/PR: ${p.host}:${p.repoKey}#${p.prNumber}`);
      const { github, azdo } = await reviewsSvc().resolveRepos();
      const repoCfg = (p.host === 'github' ? github : azdo).find((r) => r.repoKey === p.repoKey);
      const baseDir = path.join(homedir(), '.watchtower', 'worktrees');
      const launch = await prepareImplementLaunch(
        { host: p.host, repoKey: p.repoKey, number: p.prNumber, title: target.pr.title,
          repoLabel: repoCfg?.repoLabel ?? '', sourceBranch: target.pr.sourceBranch, clonePath: target.clonePath },
        {
          exec: (cmd, args) => defaultExec(cmd, args),
          fetchComments: () => reviewsSvc().comments(p.host, p.repoKey, p.prNumber, p.devopsPats),
          // github author = login (reliable). azdo authors are display names, not
          // reliably comparable — skip the authorship filter there.
          resolveMyAuthor: async () => (p.host === 'github' ? await resolveGithubLogin().catch(() => null) : null),
          ensureDir: (dir) => { fs.mkdirSync(dir, { recursive: true }); },
          baseDir,
        },
      );
      // Spawn an interactive claude in the worktree, seeded with the prompt as a
      // positional arg (stays interactive; default permission mode asks before edits).
      const id = randomUUID();
      const now = Date.now();
      repo().insert({
        id, cwd: launch.worktreePath, status: 'spawning', claudeSessionId: id,
        spawnedAt: now, lastActivityAt: now, exitCode: null, terminationReason: null,
        resumedFromInstanceId: null, jiraKeyHint: null,
        argsJson: JSON.stringify([launch.prompt]), kind: 'claude', taskId: null,
        worktreePath: launch.worktreePath,
      });
      spawnPtyForInstance({ id, cwd: launch.worktreePath, extraArgs: [launch.prompt], kind: 'claude' });
      return { instanceId: id, worktreePath: launch.worktreePath };
    }
```

- [ ] **Step 2: Add imports** at the top of `orchestrator/index.ts` if not already present: `import fs from 'node:fs';` (check existing imports first — `path`, `homedir`, `randomUUID`, `resolveGithubLogin`, `defaultExec`, `prepareImplementLaunch` from `./services/prImplement.js`). Add only the missing ones.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 4: Run the full orchestrator test slice** (nothing should regress)

Run: `npx vitest run tests/orchestrator/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(reviews): prImplement:start handler — worktree + interactive spawn"
```

---

### Task 6: Safe worktree cleanup on instance removal

**Files:**
- Modify: `orchestrator/index.ts` (`removeInstance` case ~854)
- Test: `tests/orchestrator/implementWorktreeCleanup.test.ts` (new) — test a pure helper `safeRemoveWorktree`.

**Interfaces:**
- Produces: `safeRemoveWorktree(worktreePath: string | null, deps: { exec, warn }): Promise<void>` in `orchestrator/services/prImplement.ts`.
  - `exec: (cmd, args) => Promise<string>`, `warn: (msg: string) => void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/implementWorktreeCleanup.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { safeRemoveWorktree } from '../../orchestrator/services/prImplement.js';

describe('safeRemoveWorktree', () => {
  it('no-ops when path is null', async () => {
    const exec = vi.fn(async () => '');
    await safeRemoveWorktree(null, { exec, warn: () => {} });
    expect(exec).not.toHaveBeenCalled();
  });
  it('runs a NON-force git worktree remove', async () => {
    const calls: string[][] = [];
    await safeRemoveWorktree('/base/gh-acme-w-pr7', { exec: async (c, a) => { calls.push([c, ...a]); return ''; }, warn: () => {} });
    const joined = calls.map((c) => c.join(' '));
    expect(joined).toContain('git -C /base/gh-acme-w-pr7 worktree remove /base/gh-acme-w-pr7');
    expect(joined.some((c) => c.includes('--force'))).toBe(false);
  });
  it('warns (does not throw) when removal fails — uncommitted work is left in place', async () => {
    const warn = vi.fn();
    await safeRemoveWorktree('/w', { exec: async () => { throw new Error('contains modified or untracked files'); }, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/w'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/orchestrator/implementWorktreeCleanup.test.ts`
Expected: FAIL — `safeRemoveWorktree` not exported.

- [ ] **Step 3: Implement** (append to `orchestrator/services/prImplement.ts`)

```ts
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
```

- [ ] **Step 4: Wire it into `removeInstance`** (`orchestrator/index.ts` ~854). Read the row BEFORE disposing, then clean up:

```ts
    case 'removeInstance': {
      const removedId = req.payload.instanceId;
      const worktreePath = repo().get(removedId)?.worktreePath ?? null;
      disposeInstanceRow(removedId);
      void safeRemoveWorktree(worktreePath, {
        exec: (cmd, args) => defaultExec(cmd, args),
        warn: (msg) => emitPush({ kind: 'notify', payload: { target: 'generic', title: 'Watchtower', body: msg } as never }),
      });
      emitPush({ kind: 'stateChanged', payload: { instanceId: removedId, status: 'finished' } });
      return { ok: true };
    }
```

> NOTE for the implementer: check the actual `notify` push shape in `ipcContract.ts` (the `notify` union). If a `target: 'generic'` variant does not exist, instead surface the warning by the simplest available means (e.g. `console.warn` + an existing toast-capable push). Do NOT invent a new push kind for this — keep it to what exists. The `void` (fire-and-forget) is intentional: cleanup must not block the removal response.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/orchestrator/implementWorktreeCleanup.test.ts && npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/services/prImplement.ts orchestrator/index.ts tests/orchestrator/implementWorktreeCleanup.test.ts
git commit -m "feat(reviews): safe worktree cleanup on instance removal"
```

---

### Task 7: Renderer — `useReviews` wrapper + comment count helper

**Files:**
- Modify: `apps/desktop/src/state/useReviews.ts`
- Test: `tests/client/useReviews.test.ts` (extend)

**Interfaces:**
- Produces:
  - `countImplementableComments(threads: PrCommentThreadPayload[]): number` (exported pure fn — client-side count for the badge; code-anchored + unresolved, NO authorship filter since the client lacks the login; server applies the authoritative filter).
  - `implementComments(pr: PullRequestPayload): Promise<{ instanceId: string | null; worktreePath: string | null }>` on the hook's return object.

- [ ] **Step 1: Write the failing tests** (append to `tests/client/useReviews.test.ts`)

```ts
import { countImplementableComments } from '../../apps/desktop/src/state/useReviews.js';

describe('countImplementableComments', () => {
  const t = (o: any = {}) => ({ id: 'x', file: 'a.ts', line: 1, status: null, comments: [{ author: 'r', date: 'x', body: 'b' }], ...o });
  it('counts code-anchored, unresolved threads only', () => {
    expect(countImplementableComments([
      t(), t({ id: 'g', file: null, line: null }), t({ id: 'f', status: 'fixed' }), t({ id: 'a', status: 'active' }),
    ])).toBe(2); // default-null + active
  });
});

describe('useReviews implementComments', () => {
  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (window as any).watchtower = {
      invoke: vi.fn(async (kind: string) => {
        if (kind === 'prs:list' || kind === 'prs:refresh') return { pullRequests: [], syncedAt: 'x', warnings: [] };
        if (kind === 'prReview:list') return { reviews: [] };
        if (kind === 'prImplement:start') return { instanceId: 'inst-1', worktreePath: '/w' };
        return {};
      }),
      on: vi.fn(() => () => {}),
    };
  });
  it('invokes prImplement:start with host/repoKey/prNumber and returns the payload', async () => {
    const { result } = renderHook(() => useReviews());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const out = await act(async () => result.current.implementComments(
      { host: 'github', repoKey: 'gh:a/b', number: 5 } as any));
    expect((window as any).watchtower.invoke).toHaveBeenCalledWith('prImplement:start', { host: 'github', repoKey: 'gh:a/b', prNumber: 5 });
    expect(out).toEqual({ instanceId: 'inst-1', worktreePath: '/w' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/client/useReviews.test.ts`
Expected: FAIL — `countImplementableComments` / `implementComments` not defined.

- [ ] **Step 3: Implement**

At module scope in `useReviews.ts` (near the other exported helpers), add:

```ts
const RESOLVED_STATUSES = new Set(['fixed', 'closed']);
// Client-side count for the drawer button badge: code-anchored + unresolved.
// The authorship ("from others") filter runs server-side, where the login is
// known — so this may slightly over-count on GitHub; that is acceptable for a
// badge and the server refuses launches with zero qualifying comments.
export function countImplementableComments(threads: PrCommentThreadPayload[]): number {
  return threads.filter((t) => t.file != null && t.line != null && !(t.status != null && RESOLVED_STATUSES.has(t.status))).length;
}
```

Inside `useReviews()`, add the wrapper and expose it in the returned object:

```ts
  const implementComments = useCallback(async (pr: PullRequestPayload): Promise<{ instanceId: string | null; worktreePath: string | null }> => {
    return invoke('prImplement:start', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
  }, []);
```

Add `implementComments` to the `return { ... }` object. Ensure `PrCommentThreadPayload` is imported (it already is in the `import type { ... }` line).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/client/useReviews.test.ts && npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/state/useReviews.ts tests/client/useReviews.test.ts
git commit -m "feat(reviews): useReviews.implementComments + count helper"
```

---

### Task 8: Renderer — button in `PrInspectorDrawer` + App focus wiring

**Files:**
- Modify: `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx`
- Modify: `apps/desktop/src/components/reviews/ModuleReviews.tsx` (thread a callback prop)
- Modify: `apps/desktop/src/App.tsx` (provide `focusInstance`, pass to ModuleReviews)
- Test: `tests/reviews/prImplementButton.test.tsx` (new)

**Interfaces:**
- Consumes: `implementComments`, `countImplementableComments` (Task 7); `reviewState.amIAuthor`, `threads` (already in the drawer).
- Produces: a gated "Fix with agent (N)" button; on click → `implementComments(pr)` → `onImplementLaunched(instanceId)`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/reviews/prImplementButton.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PrInspectorDrawer } from '../../apps/desktop/src/components/reviews/PrInspectorDrawer';

const pr = { host: 'github', repoKey: 'gh:a/b', number: 5, title: 'T', repoLabel: 'R', author: 'me', sourceBranch: 's', targetBranch: 'main', url: 'u', updatedAt: 'x', reviewable: true } as any;
const anchored = [{ id: 't', file: 'a.ts', line: 1, status: null, comments: [{ author: 'rev', date: 'x', body: 'fix' }] }];

const baseProps = (over: any = {}) => ({
  pr, onClose: () => {},
  loadDiff: async () => [], loadComments: async () => anchored as any,
  review: null, reviewRunning: false, openReviewFor: async () => {}, runReview: async () => 1,
  cancelReview: async () => {}, postComments: async () => ({ posted: 0, skipped: 0, errors: [] }),
  mergePr: async () => {}, closePr: async () => {}, approvePr: async () => {},
  fetchReviewState: async () => ({ amIAuthor: true, approved: false, mergeable: false, mergeBlockedReason: null }),
  implementComments: vi.fn(async () => ({ instanceId: 'inst-1', worktreePath: '/w' })),
  onImplementLaunched: vi.fn(),
  ...over,
});

describe('Fix with agent button', () => {
  it('shows on own PR with a count and launches on click', async () => {
    const props = baseProps();
    render(<PrInspectorDrawer {...props} />);
    const btn = await screen.findByRole('button', { name: /fix with agent \(1\)/i });
    fireEvent.click(btn);
    await waitFor(() => expect(props.implementComments).toHaveBeenCalledWith(pr));
    await waitFor(() => expect(props.onImplementLaunched).toHaveBeenCalledWith('inst-1'));
  });

  it('is hidden when the user is not the author', async () => {
    const props = baseProps({ fetchReviewState: async () => ({ amIAuthor: false, approved: true, mergeable: true, mergeBlockedReason: null }) });
    render(<PrInspectorDrawer {...props} />);
    await screen.findByRole('button', { name: /approve/i }); // review state loaded
    expect(screen.queryByRole('button', { name: /fix with agent/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/reviews/prImplementButton.test.tsx`
Expected: FAIL — no such button / props.

- [ ] **Step 3: Add the props + button to `PrInspectorDrawer.tsx`**

Add to the component's prop type:
```ts
  implementComments(pr: PullRequestPayload): Promise<{ instanceId: string | null; worktreePath: string | null }>;
  onImplementLaunched(instanceId: string): void;
```
Destructure `implementComments, onImplementLaunched` in the signature. Import the helper:
```ts
import { countImplementableComments } from '../../state/useReviews.js';
```
Add state + handler:
```ts
  const [implementing, setImplementing] = useState(false);
  const implementCount = countImplementableComments(threads);
  const handleImplement = async (): Promise<void> => {
    if (!pr) return;
    setImplementing(true);
    try {
      const { instanceId } = await implementComments(pr);
      if (instanceId) onImplementLaunched(instanceId);
    } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
    finally { setImplementing(false); }
  };
```
In the action row (inside the `reviewState?.amIAuthor` region, next to the Close button at ~152-157), add:
```tsx
            {reviewState?.amIAuthor && implementCount > 0 && (
              <Button variant="outlined" size="small" disabled={implementing}
                onClick={() => void handleImplement()} sx={{ mr: 1 }}>
                Fix with agent ({implementCount})
              </Button>
            )}
```

- [ ] **Step 4: Thread the callback through `ModuleReviews.tsx`**

Add prop `onImplementLaunched: (instanceId: string) => void;` to `ModuleReviews`'s props; pull `implementComments` from `useReviews()` (add to the destructure at ~21-23); pass both to `<PrInspectorDrawer ... implementComments={implementComments} onImplementLaunched={onImplementLaunched} />` (~109-112).

- [ ] **Step 5: Provide `focusInstance` in `App.tsx`**

Where `ModuleReviews` is rendered (`activeModule === 'reviews'`, ~554-562), pass:
```tsx
onImplementLaunched={(instanceId) => { setActiveModule('instances'); setActive(instanceId); }}
```
(`setActive` is the same setter used by the `activateInstance` handler at App.tsx:247; `setActiveModule` is already in scope.)

- [ ] **Step 6: Run test + typecheck**

Run: `npx vitest run tests/reviews/prImplementButton.test.tsx && npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/reviews/PrInspectorDrawer.tsx apps/desktop/src/components/reviews/ModuleReviews.tsx apps/desktop/src/App.tsx tests/reviews/prImplementButton.test.tsx
git commit -m "feat(reviews): 'Fix with agent' button + focus the launched session"
```

---

### Task 9: Full verification + whole-branch review

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — **1374 + new tests**, 0 failures.

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 3: Whole-branch review** (memory `sdd-whole-branch-review-catches-cross-task-bugs`): diff the whole branch vs `main` and check the cross-task seams — especially the `repoKey` string format flowing renderer → `prImplement:start` → `resolveRepos().find(r => r.repoKey === ...)` (must match the `gh:<nwo>` / `azdo:<host>/<repo>` format the service mints), and the `instanceId` type (string) flowing handler → `onImplementLaunched` → `setActive`.

Run: `git diff main...HEAD -- '*.ts' '*.tsx'`

- [ ] **Step 4: Live verification** (memory `desktop-live-verify-playwright`): rebuild main+orch+renderer, launch, open one of your own PRs with reviewer comments, click "Fix with agent", confirm a Claude session opens in a worktree on the PR branch, seeded with the comments. Document the result.

---

## Self-Review

**Spec coverage:**
- Button on own PRs, gated + count → Task 8. ✓
- Unresolved code-anchored comments filter (azdo status, github fallback, authorship) → Task 2 (`filterImplementComments`) + Task 5 server wiring. ✓
- Interactive Claude session in a worktree on the PR branch → Tasks 3 (worktree add) + 5 (spawn). ✓
- Auto-run positional prompt, default permission mode → Task 5 (`extraArgs: [prompt]`, no `-p`). ✓
- Watchtower-managed worktree dir → Task 5 (`~/.watchtower/worktrees`). ✓
- Persist worktree path + safe cleanup on removal → Tasks 1 + 6. ✓
- IPC contract + PAT injection → Task 4. ✓
- Focus the launched session → Task 8 (App `onImplementLaunched`). ✓
- End state implement+commit, ask before push → Task 2 (prompt text). ✓
- GitHub resolved-state limitation documented → Task 2 comment + prompt. ✓
- Branch-in-use error → Task 3 test + handler propagation. ✓

**Placeholder scan:** No TBD/TODO. The one NOTE (Task 6, `notify` push shape) instructs the implementer to verify an existing shape and gives a concrete fallback — not a placeholder.

**Type consistency:** `implementComments` returns `{ instanceId: string | null; worktreePath: string | null }` in Tasks 4/5/7/8. `worktreePath` on `InstanceRow` is `string | null` (Task 1) and set in Task 5. `filterImplementComments(threads, myAuthor?)` signature matches Tasks 2/3/5. `countImplementableComments(threads)` (client, no authorship arg) matches Tasks 7/8. `onImplementLaunched(instanceId: string)` matches Task 8's `setActive(string)`.
