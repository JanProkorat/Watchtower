# Reviews — "Implement review comments" agent

**Date:** 2026-07-20
**Status:** Design approved (pending spec review)
**Module:** Reviews (`apps/desktop/src/components/reviews/`, `orchestrator/services/`)

## Problem

When someone reviews the user's own PR and leaves inline comments asking for
code changes, the user must manually open the project, check out the PR branch,
read each comment, and implement the changes. Watchtower already knows the PR,
the project, and the comments — it can launch a Claude Code agent in that
project to do the implementation, with the reviewer feedback pre-loaded.

## Goal

A button in the PR inspector — shown only on the user's **own** PRs — that
spawns an **interactive** Claude Code session in a **dedicated git worktree**
checked out on the PR's source branch, pre-loaded with the unresolved
code-anchored reviewer comments, so the agent starts implementing immediately
while the user watches and approves outward actions (commit/push).

## Decisions (locked with the user)

1. **"My agents of that project" = a standard Claude Code session in the project
   folder.** There is no per-project agent config in Watchtower; a session
   launched with `cwd` inside the project automatically inherits that project's
   `CLAUDE.md`, `.claude/agents`, and skills. No agent-selection UI is built.
2. **Interactive session** (not headless). Reuses the `spawnInstance` launch
   path so the session appears in the Instances module and is fully steerable.
3. **Dedicated git worktree on the PR source branch.** The user may have WIP on
   the currently-checked-out branch, so we never `git checkout` in the main
   clone. The agent works in an isolated worktree; its commits/push land on the
   PR branch.
4. **Comments fed in = all _unresolved, code-anchored_ comments from others.**
   Code-anchored = both `file` and `line` present (general conversation comments
   excluded). See "Comment filtering" for the unresolved/authorship rules.
5. **First turn auto-runs, permission-gated.** The prompt is passed as the
   positional argument to `claude` so the agent begins immediately; default
   permission mode (NOT `bypassPermissions`) means it still prompts before
   editing files, committing, or pushing.
6. **Worktree in a Watchtower-managed dir:** `~/.watchtower/worktrees/<slug>`.
7. **End state = implement + commit, then ask before push.** The prompt
   instructs the agent to implement and commit on the PR branch, then ask the
   user before `git push` (which updates the live PR). No force-push.

## Out of scope (MVP)

- Posting replies back to the review threads (the agent may do so manually if it
  chooses, but Watchtower does not automate it).
- Selecting a specific named agent / model — uses the user's default `claude`.
- GitHub thread "resolved" detection (the current GitHub comment fetcher does
  not capture per-thread resolved state; needs a GraphQL fetch — follow-up).

## Launch mechanism (confirmed)

`claude` (Claude Code CLI) starts an **interactive** session by default. A
positional argument becomes the first user turn and the session **stays
interactive** afterward:

```
claude --session-id <uuid> "<implement prompt>"
```

- `cwd` of the spawned process = the worktree path → project context
  (`CLAUDE.md`, agents, skills) is auto-discovered.
- This composes with the existing `buildPtySpawnConfig` (`orchestrator/shellPolicy.ts:32-48`),
  which already builds `['--session-id', <id>, ...extraArgs]`. The implement
  prompt is passed as a single positional entry in `extraArgs` (the
  `spawnInstance` `args` payload). A few-KB markdown prompt as one argv string is
  well within OS argv limits.
- `-p`/`--print` is deliberately NOT used (that would make it headless).

## Architecture

### Data flow

```
PrInspectorDrawer (own PR, N qualifying comments)
  └─ button "Fix with agent (N)"  ── invoke('prImplement:start', {host, repoKey, prNumber})
       └─ electron-main: inject devopsPats  (ELECTRON injects, like other prs:* kinds)
            └─ orchestrator handler 'prImplement:start'
                 1. resolve project clonePath + PR sourceBranch (ReviewsService)
                 2. git fetch origin <sourceBranch>
                 3. git worktree add <worktreePath> <sourceBranch>   (abort if branch in use)
                 4. fetch + filter comments → build prompt
                 5. spawnInstance-equivalent: pty spawn claude in cwd=<worktreePath>,
                    args=[<prompt>], kind='claude'
                 6. persist instances.worktree_path = <worktreePath>
                 7. return { instanceId, worktreePath }
       └─ renderer: switch to Instances module, focus instanceId (activateInstance pattern)
```

### Components

**`orchestrator/services/prImplement.ts` (new)** — pure, unit-testable helpers:
- `filterImplementComments(threads, myLogin): PrCommentThreadPayload[]` — the
  qualifying-comment filter (see below).
- `buildImplementPrompt(pr, threads): string` — the prompt template.
- `worktreePathFor(base, host, repoKey, prNumber): string` — deterministic path.
- `implementWorktreeAddArgs(...)` / `implementFetchArgs(...)` — the git command
  argv (executed via the injectable `Exec` from
  `orchestrator/services/prProviders/exec.ts`, so tests assert command shape
  without touching git). Mirrors the `prReview.ts` worktree pattern
  (`prReview.ts:150-176`).

**`orchestrator/index.ts`** — new `prImplement:start` handler:
- Resolve repo + PR via `ReviewsService` (reuse `resolveRepos()` for clonePath;
  `sourceBranch` comes from the `PullRequestPayload` in the current list cache,
  or a targeted fetch). Fetch comments via `reviewsSvc().comments(...)`.
- Resolve `myLogin` (GitHub) / user id (Azure) to apply the authorship filter —
  the resolvers already exist (`resolveGithubLogin`, `resolveAzdoUser`).
- Create the worktree, then reuse `spawnPtyForInstance` /
  `spawnInstance` internals with `cwd=worktreePath`, `extraArgs=[prompt]`,
  `kind='claude'`; persist `worktree_path`.
- Errors surface via the normal IPC rejection → toast: no qualifying comments,
  branch-already-checked-out, git fetch/worktree failure.

**`orchestrator/db/migrations.ts` (v6)** — `ALTER TABLE instances ADD COLUMN
worktree_path TEXT` (nullable). Guard against the node:sqlite / better-sqlite3
ADD-COLUMN divergence (memory: sqlite-add-column-engine-divergence) by using a
constant/NULL default only.

**`instances` removal handler** — on `instances:remove` (or close), if the row
has a `worktree_path`, attempt **safe cleanup**:
- `git worktree remove <path>` (NON-force). If it fails because the tree is
  dirty or the branch has unpushed commits, do NOT force — leave the worktree and
  emit a warning toast with the path. Nothing uncommitted is ever discarded.

**`packages/shared/src/ipcContract.ts`** — add request/response kind
`prImplement:start` (request `{ host, repoKey, prNumber }`, response
`{ instanceId: number; worktreePath: string }`), and mirror into
`shared/messagePort.ts`. Add `prImplement:start` to `ELECTRON`-injected
devopsPats handling and (if needed) the electron passthrough list. Extend the
`instances` payload/row types with the optional `worktreePath`.

**`apps/desktop/src/state/useReviews.ts`** — add
`implementComments(pr): Promise<{ instanceId; worktreePath }>` wrapper +
a pure `countImplementableComments(threads, myLogin?)` helper for the badge.
(Author login on the client: the drawer can pass what it has; if `myLogin`
isn't available client-side, the count filter falls back to code-anchored +
unresolved only, and the authoritative authorship filter runs server-side.)

**`apps/desktop/src/components/reviews/PrInspectorDrawer.tsx`** — the button:
- Visible only when `amIAuthor` (from `fetchReviewState`, already loaded).
- Enabled when the loaded comment threads yield ≥1 qualifying comment; label
  shows the count.
- On click: `implementComments(pr)`, then trigger the app-level switch to the
  Instances module focused on the returned `instanceId`.

**App-level** — reuse the existing `activateInstance` push / deep-link plumbing
to bring the new session to the foreground after launch.

## Comment filtering (`filterImplementComments`)

Keep a thread iff **all** of:
1. **Code-anchored:** `thread.file != null && thread.line != null`.
2. **Unresolved:**
   - Azure DevOps: `thread.status` not in `{ 'fixed', 'closed' }`.
   - GitHub: `thread.status` is always `null` → treated as unresolved (cannot
     detect resolution today; prompt warns the agent to verify against current
     code). Documented limitation.
3. **From others:** the thread contains ≥1 comment whose `author` differs from
   the resolved current user. (Whole thread kept for context.)

Ordering: group by `file`, then ascending `line`, for a stable, readable prompt.

## Prompt template (`buildImplementPrompt`)

Structure (markdown):
- **Context:** "Implementing reviewer feedback on PR #`<n>` — `<title>` (project
  `<repoLabel>`). You are in a dedicated git worktree checked out on the PR's
  source branch `<sourceBranch>`; work from HEAD here. WIP on other branches is
  untouched."
- **Comments:** grouped by `` `file` `` → each as `- L<line> (<author>): <body>`.
- **Instructions:**
  - Implement the requested changes, following this project's `CLAUDE.md`
    conventions.
  - For any comment you disagree with or that's already addressed, do NOT change
    code — note it and move on.
  - Run this project's tests / typecheck before finishing.
  - Commit the changes on `<sourceBranch>` with a clear message. **Ask the user
    before running `git push`** (it updates the live PR). Never force-push.

## Error handling

- **No qualifying comments:** `prImplement:start` rejects with a clear message;
  but the button is disabled in that case, so this is a guard, not a normal path.
- **Branch already checked out** (main clone or another worktree): `git worktree
  add` fails; surface "Branch `<x>` is already checked out — close the other
  session/worktree first."
- **git fetch/worktree failure:** surfaced via the standard IPC-rejection toast.
- **Cleanup safety:** dirty/unpushed worktree is never force-removed (see above).
- All renderer IPC goes through `invoke()` → failures toast automatically
  (repo CLAUDE.md "Surfacing IPC errors"); no inline `<Alert>` added.

## Testing

**Orchestrator (vitest):**
- `filterImplementComments`: azdo `fixed`/`closed` excluded, `active` kept;
  github null-status kept; general (file/line null) excluded; author filter
  (own-only thread excluded, mixed-author thread kept).
- `buildImplementPrompt`: grouping by file/line, author + body rendering,
  instruction block present (push-gated), snapshot.
- `worktreePathFor` deterministic; `git worktree add`/`fetch` argv shape via
  injected `Exec`; branch-in-use error path.
- Migration v6: `worktree_path` column present, existing rows unaffected.
- Safe-cleanup: clean+pushed → remove; dirty/unpushed → left + warning.

**Renderer (vitest + jsdom):**
- `countImplementableComments` helper parity with the server filter's
  code-anchored + unresolved rules.
- `PrInspectorDrawer`: button hidden when `!amIAuthor`; disabled when count 0;
  enabled with count label; click invokes `prImplement:start` and requests the
  instance switch.

Full suite must stay green (currently 1374 tests); this feature adds tests.

## Files touched (implementation estimate)

- `orchestrator/services/prImplement.ts` (new)
- `orchestrator/index.ts` (handler + cleanup hook)
- `orchestrator/db/migrations.ts` (v6) + `orchestrator/db/repositories/instances.ts`
- `packages/shared/src/ipcContract.ts`, `packages/shared/src/messagePort.ts`
- `apps/desktop/src/state/useReviews.ts`
- `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx`
- App-level focus wiring (`App.tsx`) if not already reusable
- Tests under `tests/orchestrator/` and `tests/reviews/` / `tests/client/`

>5 files → implement on a feature branch/worktree (global principle #5 +
concurrent-worktree memory), one phase per commit.
