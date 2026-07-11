# Reviews SP2 — review agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Fire a review agent at a PR: check out its branch in a throwaway git worktree, run headless Claude (Opus) with full-repo context to produce **structured findings + a summary**, persist them, show them in the Report tab, and surface them inline on the diff and as a review-state on the PR list.

**Architecture:** Orchestrator `prReview` service owns the worktree lifecycle and spawns `claude -p … --output-format json --json-schema … --permission-mode bypassPermissions --model opus` in the worktree; the schema forces findings into shape. Results persist to a new `pr_reviews` table (migration **v20**). Async: `prReview:start` returns a `reviewId`; progress/completion arrive via IPC pushes. Renderer Report tab runs/reads reviews; findings link to diff lines and render inline (distinct from existing comments); the PR-list review-state column reflects the latest review.

**Tech Stack:** TypeScript, `claude` CLI (v2.1.207, headless), `git worktree`, better-sqlite3 / node:sqlite, React + MUI.

## Global Constraints
- English UI text (app switched to English). MUI + `sx` only; theme-token colors; no `styled()`/`Table`/`Avatar`.
- Renderer → electron-main → orchestrator; renderer never touches git/DB/CLI directly. IPC kinds in `packages/shared/src/ipcContract.ts` (+ mirror orchestrator-bound kinds in `messagePort.ts`; pushes in `IpcPush`).
- Migrations: `orchestrator/db/migrations.ts`, current max **19** → add **20**. The migration test pins the version — bump its assertion to 20.
- Providers/services live in `orchestrator/services/`. Shared-type import specifier: `@watchtower/shared/ipcContract.js`.
- CLI exec via `execFile` with augmented PATH (reuse `orchestrator/services/prProviders/exec.ts` `defaultExec`); long timeout for the review (10 min) + large maxBuffer.
- SP2 is **read-only toward the PR** (no posting — that's SP3). The worktree must ALWAYS be removed in a `finally` (never leak worktrees).
- Tests: vitest node env, no RTL, `.js` extensions, test exported pure functions + service logic with injected seams. Keep the suite green.
- Findings schema (canonical — used by the `--json-schema` flag AND the payload type):
  `{ summary: string, findings: Array<{ file: string, line: number, severity: 'error'|'warn'|'info', category: string, summary: string, detail?: string }> }`

## File structure
**Create:** `orchestrator/services/prReview.ts` (worktree + headless-claude runner + parse), `orchestrator/db/repositories/prReviews.ts` (table repo), `apps/desktop/src/components/reviews/ReviewReport.tsx` (Report-tab body), `apps/desktop/src/components/reviews/FindingCard.tsx` (one finding, reused inline).
**Modify:** `orchestrator/db/migrations.ts` (+v20), `packages/shared/src/{ipcContract,messagePort}.ts`, `orchestrator/index.ts` (handlers + emit pushes), `orchestrator/services/reviews.ts` (expose a way to resolve a repo+PR for the runner), `apps/desktop/src/state/useReviews.ts` (start/get/list + push subscribe), `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx` (Report tab uses ReviewReport), `apps/desktop/src/components/reviews/DiffView.tsx` (inline findings), `apps/desktop/src/components/reviews/PrRow.tsx` (real review-state column).
**Test:** `tests/orchestrator/prReviews.test.ts`, `tests/orchestrator/prReviewRunner.test.ts`, `tests/orchestrator/migrations.test.ts` (bump).

---

## Task 1: Migration v20 + pr_reviews repo

**Files:** Modify `orchestrator/db/migrations.ts`; Create `orchestrator/db/repositories/prReviews.ts`; Test `tests/orchestrator/prReviews.test.ts`, and bump `tests/orchestrator/migrations.test.ts`.

**Interfaces produced:**
```ts
export interface PrReviewRow {
  id: number; host: string; repo_key: string; pr_number: number; head_sha: string;
  status: 'running' | 'done' | 'error'; summary: string | null; findings_json: string | null;
  error: string | null; created_at: string; finished_at: string | null;
}
export class PrReviewsRepo {
  constructor(db: SqliteLike);
  start(host: string, repoKey: string, prNumber: number, headSha: string): number; // insert running, return id
  finish(id: number, summary: string, findingsJson: string): void;                  // status=done + finished_at
  fail(id: number, error: string): void;                                            // status=error + finished_at
  get(id: number): PrReviewRow | undefined;
  latestFor(host: string, repoKey: string, prNumber: number): PrReviewRow | undefined;
  list(repoKey?: string): PrReviewRow[];
}
```

- [ ] **Step 1: Write failing repo test** — round-trip start→get (status running), finish→done with findings, fail→error; `latestFor` returns most recent by id. Use node:sqlite `DatabaseSync(':memory:')` + `runMigrations` (pattern: existing `tests/orchestrator/*.test.ts`).
- [ ] **Step 2: Run it, see it fail** (`npx vitest run tests/orchestrator/prReviews.test.ts`).
- [ ] **Step 3: Add migration v20** to the MIGRATIONS array:
```ts
{
  version: 20,
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS pr_reviews (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      host          TEXT    NOT NULL,
      repo_key      TEXT    NOT NULL,
      pr_number     INTEGER NOT NULL,
      head_sha      TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      summary       TEXT,
      findings_json TEXT,
      error         TEXT,
      created_at    TEXT    NOT NULL,
      finished_at   TEXT
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pr_reviews(host, repo_key, pr_number)`);
  },
},
```
Implement `PrReviewsRepo` (prepared statements; `created_at`/`finished_at` = `new Date().toISOString()`).
- [ ] **Step 4: Bump migration test** — in `tests/orchestrator/migrations.test.ts` change the `toBe(19)` assertion to `toBe(20)`; add an assertion that `pr_reviews` is among the created tables.
- [ ] **Step 5: Run both test files green** (`npx vitest run tests/orchestrator/prReviews.test.ts tests/orchestrator/migrations.test.ts`).
- [ ] **Step 6: Commit** `feat(reviews): pr_reviews table (migration v20) + repo`.

---

## Task 2: IPC contract — review kinds + pushes

**Files:** Modify `packages/shared/src/ipcContract.ts`, `packages/shared/src/messagePort.ts`.

**Interfaces produced (payload types in ipcContract):**
```ts
export interface PrFindingPayload { file: string; line: number; severity: 'error' | 'warn' | 'info'; category: string; summary: string; detail?: string; }
export interface PrReviewPayload {
  id: number; host: PrHost; repoKey: string; prNumber: number; headSha: string;
  status: 'running' | 'done' | 'error'; summary: string | null; findings: PrFindingPayload[];
  error: string | null; createdAt: string; finishedAt: string | null;
}
```
Request kinds:
- `prReview:start` `{ host: PrHost; repoKey: string; prNumber: number }` → `{ reviewId: number }`
- `prReview:get` `{ reviewId: number }` → `{ review: PrReviewPayload | null }`
- `prReview:list` `{ repoKey?: string }` → `{ reviews: PrReviewPayload[] }`
Pushes (`IpcPush`): `prReviewProgress` `{ reviewId: number; status: 'running'|'done'|'error'; message: string }`; `prReviewDone` `{ reviewId: number }`.

- [ ] **Step 1:** Add payload types + the 3 request kinds (with responses) + 2 push kinds to `ipcContract.ts`.
- [ ] **Step 2:** Mirror the 3 request kinds (with `id`) + responses into `messagePort.ts`; add the 2 pushes to `OrchPush`.
- [ ] **Step 3:** `npx tsc -p orchestrator/tsconfig.json --noEmit` compiles the contract (a non-exhaustive switch error at handleRequest is expected until Task 4 — fine).
- [ ] **Step 4: Commit** `feat(reviews): IPC contract for review runner`.

---

## Task 3: Review runner service (worktree + headless Claude)

**Files:** Create `orchestrator/services/prReview.ts`; Test `tests/orchestrator/prReviewRunner.test.ts`.

**Interfaces produced:**
```ts
export interface ReviewRunnerDeps {
  exec?: Exec;                                   // from prProviders/exec.js
  claudeBin?: string;                            // default 'claude'
  workRoot?: string;                             // default os.tmpdir()
  now?: () => string;
}
// Pure, exported, unit-tested:
export function parseReviewOutput(stdout: string): { summary: string; findings: PrFindingPayload[] }; // parse the --output-format json envelope
export function buildReviewPrompt(pr: { title: string; sourceBranch: string; targetBranch: string }): string;
// The orchestrator calls:
export async function runReview(
  clonePath: string, baseRef: string, headSha: string,
  pr: { title: string; sourceBranch: string; targetBranch: string },
  deps?: ReviewRunnerDeps,
): Promise<{ summary: string; findings: PrFindingPayload[] }>;
```

`runReview`:
1. `worktree = path.join(workRoot, 'wt-review-<headSha7>-<rand-from-now>')`.
2. `exec('git', ['-C', clonePath, 'worktree', 'add', '--detach', worktree, headSha])`.
3. In a `try`: run the agent (see below); `parseReviewOutput(stdout)`.
4. `finally`: `exec('git', ['-C', clonePath, 'worktree', 'remove', '--force', worktree])` (swallow removal errors but log).

Agent invocation (the verified CLI shape):
```ts
const schema = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object',
      properties: { file:{type:'string'}, line:{type:'number'},
        severity:{type:'string', enum:['error','warn','info']},
        category:{type:'string'}, summary:{type:'string'}, detail:{type:'string'} },
      required:['file','line','severity','category','summary'] } },
  }, required:['summary','findings'],
});
const prompt = buildReviewPrompt(pr);
const stdout = await exec(claudeBin, [
  '-p', prompt, '--model', 'opus', '--output-format', 'json',
  '--json-schema', schema, '--permission-mode', 'bypassPermissions',
], { cwd: worktree });   // NOTE: exec needs a long timeout — see below
```
`buildReviewPrompt` (returns a string like): "You are reviewing a pull request. Its changes are on this checked-out branch relative to the base ref `<baseRef>`. Run `git diff <baseRef>...HEAD` to see the diff, and read surrounding code as needed. Report correctness/logic/security **bugs** AND reuse/simplification/efficiency **quality** issues. For each finding give the repo-relative file, the 1-based line on the new side, a severity (error|warn|info), a short category (e.g. correctness, efficiency, simplification), a one-line summary, and optional detail. Also give a 2-3 sentence overall summary. Output must match the provided JSON schema." (Interpolate `baseRef`.)
`parseReviewOutput`: `JSON.parse(stdout)` → envelope; take `env.result`; if it's a string, `JSON.parse` it; coerce to `{summary, findings}`; default missing arrays to `[]`; on any parse failure throw `Error('could not parse review output: ' + firstChars)`.

> **Exec note:** the shared `defaultExec` uses a 90s timeout — too short for a review. Task 3 must pass a longer-timeout exec: extend `prProviders/exec.ts` with an optional `timeoutMs` in the `Exec` opts (default 90s) and have `defaultExec` read it, OR add a `longExec` variant with a 600_000ms timeout + 64MB buffer. Use 600_000ms for the claude call. Keep the change minimal and update the `Exec` type + its one other caller if you widen the opts.

- [ ] **Step 1: Write failing tests** for `parseReviewOutput` (feed a canned `{"type":"result","result":"{\"summary\":\"ok\",\"findings\":[{...}]}"}` envelope → assert parsed findings; feed `result` as an already-object; feed malformed → throws) and `buildReviewPrompt` (contains the baseRef + "JSON schema" wording). Also test `runReview` with an injected `exec` that (a) records the `git worktree add` call, (b) returns a canned claude envelope for the claude call, (c) records the `worktree remove` call — assert findings returned AND that remove was called even when the claude call throws (finally cleanup).
- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement `prReview.ts`.**
- [ ] **Step 4: Run green** (`npx vitest run tests/orchestrator/prReviewRunner.test.ts`).
- [ ] **Step 5: Commit** `feat(reviews): review runner — worktree + headless Claude (Opus)`.

---

## Task 4: Orchestrator wiring — start/get/list + async run + pushes

**Files:** Modify `orchestrator/index.ts`; Modify `orchestrator/services/reviews.ts`.

- Add to `reviews.ts` a helper `resolveRepoAndPr(host, repoKey, prNumber)` returning `{ clonePath, baseRef, headSha, pr }` for the runner: find the repo via `resolveRepos()`, find the PR in `this.cache`; for the branches, fetch them and resolve `headSha` (`git rev-parse`); `baseRef` = the fetched target ref (reuse the `refs/wt-review/*` fetch already used by the azdo diff, generalized for both hosts — for GitHub fetch `sourceBranch`/`targetBranch` too so a worktree can be created). Return null if not resolvable.
- In `orchestrator/index.ts`:
  - `case 'prReview:start'`: build a `PrReviewsRepo`; resolve repo+PR; `const id = repo.start(...)`; kick off the async run **without awaiting** (fire-and-forget with `.then/.catch`): on success `repo.finish(id, summary, JSON.stringify(findings))` + `emitPush({kind:'prReviewProgress',...done})` + `emitPush({kind:'prReviewDone',{reviewId:id}})`; on error `repo.fail(id, msg)` + progress push. Emit a `running` progress push immediately. Return `{ reviewId: id }`.
  - `case 'prReview:get'`: map row → `PrReviewPayload` (parse `findings_json`). Return `{ review }`.
  - `case 'prReview:list'`: map rows → payloads. Return `{ reviews }`.
  - Add a mapper `reviewPayloadOf(row): PrReviewPayload`.
- [ ] **Step 1:** Implement `resolveRepoAndPr` in reviews.ts (adapt the existing fetch logic; keep it working for both hosts).
- [ ] **Step 2:** Add the 3 handlers + async runner wiring + the mapper in index.ts.
- [ ] **Step 3:** `npm run typecheck:ci` clean (switch now exhaustive). `npx vitest run` — only the known EADDRINUSE failures.
- [ ] **Step 4: Commit** `feat(reviews): orchestrator review handlers + async run + pushes`.

---

## Task 5: Report tab + finding cards + hook

**Files:** Create `apps/desktop/src/components/reviews/{ReviewReport,FindingCard}.tsx`; Modify `apps/desktop/src/state/useReviews.ts`, `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx`.

- `useReviews`: add `startReview(pr) => Promise<number>` (invoke `prReview:start`), `getReview(reviewId)`, `listReviews()`, and subscribe to `prReviewDone`/`prReviewProgress` pushes (in a `useEffect`, `window.watchtower.on(...)`, refresh the open review on done). Expose the latest review per PR (a small map or a `reviewForPr(pr)` lookup fed by `prReview:list`).
- `FindingCard.tsx`: `{ finding: PrFindingPayload }` → glass card (same recipe as CommentThread): severity chip (error=error.main, warn=warning.main, info=info.main), category (muted), `file:line` (monospace, primary), summary (bold-ish), optional detail. English.
- `ReviewReport.tsx`: `{ pr, review, running, onRun }`:
  - No review + not running → a "Not yet reviewed" line + a **Run review ▸** `Button` (calls `onRun`).
  - running → spinner + "Reviewing… (Opus in a worktree)".
  - done → the `summary` (glass panel) + a count + the findings list (`FindingCard` each, sorted error→warn→info). error → an `<Alert severity="error">` with `review.error` + a Re-run button.
- `PrInspectorDrawer`: Report tab renders `<ReviewReport …>`; wire `startReview` + local running state + reload the review on the `prReviewDone` push. Show the finding count on the Report tab label when present.
- [ ] **Step 1:** `useReviews` additions (+ export any pure helper like `sortFindings` and test it in `tests/client/`).
- [ ] **Step 2:** `FindingCard` + `ReviewReport`.
- [ ] **Step 3:** Wire into `PrInspectorDrawer`.
- [ ] **Step 4:** `npm run typecheck:ci` clean; `npx vitest run tests/client/` green.
- [ ] **Step 5: Commit** `feat(reviews): Report tab — run review + findings`.

---

## Task 6: Inline findings on diff + real review-state on the PR list

**Files:** Modify `apps/desktop/src/components/reviews/DiffView.tsx`, `apps/desktop/src/components/reviews/PrRow.tsx`, `apps/desktop/src/components/reviews/ModuleReviews.tsx`, `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx`.

- `DiffView`: accept optional `findings?: PrFindingPayload[]`. Build a `findingsByLine` map for the active file (match `finding.file === file.path && finding.line === l.newNo`) and render a `FindingCard` inline beneath the matching line (distinct from comment threads — findings first, styled by severity). PrInspectorDrawer passes the current review's findings to `<DiffView findings={…}>`. Also add a per-file finding marker in the file tree (like the comment dot, but severity-colored) — reuse the existing `commentsByFile` pattern with a `findingsByFile` count.
- `PrRow` + `ModuleReviews`: replace the static `not reviewed` review-state with the real one from `prReview:list` (passed down from `useReviews`): `running` → amber dot + "reviewing…"; `done` → green dot + "N findings" (or "no findings"); none → grey dot + "not reviewed". Keep the action button.
- [ ] **Step 1:** DiffView inline findings + file-tree severity marker.
- [ ] **Step 2:** Thread the latest-review-per-PR through `useReviews` → `ModuleReviews` → `PrRow`; render real state.
- [ ] **Step 3:** `npm run typecheck:ci` clean; `npx vitest run` green (only known EADDRINUSE).
- [ ] **Step 4: Commit** `feat(reviews): inline findings on diff + real PR-list review state`.

---

## Self-review (plan author)
- **Spec coverage (design §7 SP2):** worktree checkout (T3), headless review agent (T3, verified CLI), structured findings + summary (T2/T3), `pr_reviews` + migration v20 (T1), `prReview:start/get/list` + progress pushes (T2/T4), Report tab (T5), inline findings on diff + Report↔diff (T6), review-state column (T6). Read-only toward the PR (no post-back) ✓.
- **Worktree hygiene:** removal in `finally` (T3), tested (T3 Step 1).
- **Type consistency:** `PrFindingPayload`/`PrReviewPayload` (T2) used verbatim in T3–T6; `PrReviewsRepo`/`PrReviewRow` (T1) used in T4. Findings-schema object (T3) matches `PrFindingPayload` fields.
- **Open risk to watch in review:** the exact `--output-format json` envelope shape from claude v2.1.207 (`.result` string vs object) — `parseReviewOutput` handles both; the runner's live behavior needs a real-app smoke (spawning `claude -p` from the orchestrator) before merge.
