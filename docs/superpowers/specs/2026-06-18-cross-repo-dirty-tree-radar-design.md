# Cross-repo dirty-tree radar — design

> Status: approved 2026-06-18. Next: implementation plan (writing-plans).

## Goal

One glance on the Dashboard tells me which billed-project repos have
uncommitted work or are ahead/behind their upstream — killing the
"WIP swept into the wrong branch" class of mistake (see the
`branch-from-dirty-tree` memory).

## Scope decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Which repos | **Billing project folders** — `projects.folder_path` where set | Curated, stable set: the repos I actually bill against. No noise from ad-hoc cwds. |
| Row data | **Local git only** — branch, dirty counts, ahead/behind | Fast, offline, no auth. Directly answers the pain. PR/CI can be layered later. |
| UI home | **Dashboard card** in `ModuleDashboard` | At-a-glance, no new rail module (none wanted). |
| Refresh | **On dashboard view + window focus + manual button** | Fresh exactly when I'd look; no background polling. |
| Row actions | **Open actions only** — "Open in instance" + "Open in VS Code" | Navigate straight to the fix; no git mutations from a dashboard. |

Explicitly out of scope (deferrable): open-PR / CI status (needs `gh`
+ network), git quick-actions (stash/commit), filesystem watchers,
polling, non-project ad-hoc repos.

## Architecture

Follows the project's standard 4-step IPC recipe (renderer hook →
`ipcContract` kind → `messagePort` mirror → orchestrator handler).

### 1. `orchestrator/services/repoStatus.ts` (new)

Input: `Array<{ projectId: number; name: string; folderPath: string }>`
(projects with a non-null `folder_path`).

For each folder, a single git call:

```
git -C <folderPath> status --porcelain=v2 --branch
```

`--porcelain=v2 --branch` yields, in one invocation:
- `# branch.head <name>` → current branch (or `(detached)`).
- `# branch.ab +<ahead> -<behind>` → ahead/behind vs upstream (absent
  when there is no upstream → `ahead`/`behind` are `null`).
- One line per changed path with XY status codes → counted into
  `staged` / `unstaged` / `untracked`.

The **git root** is resolved (from the toplevel) so two projects that
point into the same repository **dedupe by git root**.

Execution details (mirrors `orchestrator/services/tokenUsage.ts`):
- `execFile` with a per-call timeout.
- PATH augmentation (`/opt/homebrew/bin`, `/usr/local/bin`, …) so a
  stripped GUI/launchd PATH still resolves `git`.
- Repos scanned **in parallel with a small concurrency cap**.

The **parser is pure**: `(porcelainText: string) → ParsedRepoStatus`.
No git access in the parser — unit-tested against fixture outputs.

### 2. IPC

Add to `shared/ipcContract.ts`:
- Request: `{ kind: 'repos:status'; payload: Record<string, never> }`
- Response: `{ kind: 'repos:status'; payload: { repos: RepoStatusView[] } }`

Mirror into `shared/messagePort.ts`; handle in `orchestrator/index.ts`.

"Open in instance" reuses the Phase 21 launch bridge (App.tsx-level
callback + `instances:findByCwd`). "Open in VS Code" reuses the
existing electron-only `openInVSCode` kind.

### 3. `RepoStatusView` shape

```ts
interface RepoStatusView {
  projectId: number;
  projectName: string;
  folderPath: string;
  gitRoot: string | null;       // null when not a git repo / folder missing
  branch: string | null;        // null when detached or on error
  detached: boolean;
  ahead: number | null;         // null when no upstream
  behind: number | null;        // null when no upstream
  staged: number;
  unstaged: number;
  untracked: number;
  dirty: boolean;               // staged + unstaged + untracked > 0
  error: 'missing' | 'not-a-repo' | 'git-failed' | null;
}
```

### 4. Renderer

- `client/src/state/useRepoStatus.ts` — thin hook: `{ data, error, refresh() }`.
  Refresh fires on mount, on `window` focus, and on the manual button.
  No polling.
- `client/src/components/dashboard/RepoRadarCard.tsx` — wired into
  `ModuleDashboard.tsx` alongside the existing cards.

UI behavior:
- Rows needing attention (dirty, or ahead/behind ≠ 0, or `error`) sort
  to the top.
- Clean repos collapse behind a "*N clean*" summary line.
- Attention row: project name + branch chip, ↑ahead / ↓behind, dirty
  counts (e.g. `3✎ 1+`), and the two Open actions.

## Error handling

- **Per-repo failures are row states, not card failures.** A missing
  folder → `error: 'missing'` ("folder gone"); a non-git folder →
  `error: 'not-a-repo'`; a git invocation failure → `error: 'git-failed'`.
- The card-level `<Alert severity="error">` appears **only** if the
  IPC round-trip itself fails (the `useProjects` / `ProjectsList`
  pattern).

## Testing

- **Parser** (pure): clean / dirty / ahead-behind / detached /
  no-upstream / merge-conflict fixture outputs of
  `git status --porcelain=v2 --branch`.
- **Service**: injected exec runner (constructor injection, like
  `ptyManager` takes `node-pty`) — verifies dedup-by-git-root,
  concurrency, per-repo error isolation, timeout handling.
- **Hook**: `useRepoStatus` refresh + error surface.

Estimated ~8–10 new tests. Keeps the suite green (≥552 currently).
