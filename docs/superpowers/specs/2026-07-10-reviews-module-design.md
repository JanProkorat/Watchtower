# Reviews — cross-repo PR review module

**Status:** Design approved 2026-07-10. Ready for implementation planning.
**Prototype:** `docs/prototypes/reviews-module.html`
**Author:** Jan Prokorát (with Claude)

## 1. Overview

A new top-level Watchtower module, **Reviews**, that consolidates open pull
requests across every project repo — GitHub and Škoda Azure DevOps — into one
list, lets the user read each PR's diff in-app, fire a review agent at any PR,
read the resulting report, and optionally post selected findings back to the
PR.

It is a peer module to Instances / TimeTracker / Settings and obeys the same
layering rule: **renderer → IPC → orchestrator services → SQLite/network/git**.
The renderer never touches git, the network, SQLite, or secrets directly.

This is **not** a review of work done by managed Watchtower instances. It
targets arbitrary open PRs (authored by anyone) on the user's project repos.

## 2. Goals / non-goals

**Goals**
- One list of **all open PRs** across GitHub + Azure DevOps project repos.
- Read a PR's **diff in-app** without running any agent.
- Fire a **review agent** at a PR; get a markdown report + structured findings
  with full-repo context (via a throwaway worktree at the PR branch).
- **Report-first**: nothing is written to the PR unless the user opts in.
- **Post-back**: push selected findings to the PR as inline comments / a
  review, host-aware (GitHub vs DevOps).

**Non-goals (YAGNI for v1)**
- No CI status, checks, merge/approve, or PR creation.
- No PR-author/reviewer filtering beyond host + a text search (list shows all
  open PRs). Grouping/filtering by mine/awaiting-review is a later nice-to-have.
- No review of local uncommitted changes (that is `/code-review` territory).
- No streaming multi-agent review fan-out in v1 (single review run per PR).

## 3. Architecture

### 3.1 Module placement
- **Renderer:** `apps/desktop/src/` — a new `Reviews` module (sidebar entry +
  content) alongside the existing modules. Thin state hooks live in
  `apps/desktop/src/state/` (e.g. `usePullRequests.ts`, `usePrReview.ts`),
  never calling `window.watchtower.invoke` from components directly.
- **IPC contract:** `packages/shared/src/ipcContract.ts` (renderer ↔ main) and
  `packages/shared/src/messagePort.ts` (main ↔ orchestrator), following the
  tagged-union `<noun>:<verb>` convention.
- **Orchestrator services:** new `orchestrator/services/prProviders/`
  (`github.ts`, `azureDevops.ts`, a shared `types.ts` with the normalized
  model) and `orchestrator/services/prReview.ts` (worktree + headless review +
  findings capture + persistence). Handlers wired in `orchestrator/index.ts`.
- **Secrets:** the DevOps PAT is stored **encrypted via Electron
  `safeStorage`** (Keychain-backed), never in the SQLite `settings` table as
  plaintext. Encryption/decryption happens in electron-main (which owns
  `safeStorage`). **Decision:** all provider HTTP lives in the orchestrator
  adapters (consistent with every other `orchestrator/services/` service);
  electron-main decrypts the PAT on demand and passes it to the orchestrator
  **per request** over the MessagePort — used transiently, never persisted in
  the child process. See §8.

### 3.2 Data flow (happy path)
```
renderer         electron-main            orchestrator                external
--------         -------------            ------------                --------
prs:refresh  ──▶ forward            ──▶  github.list() ─────────────▶ gh CLI
                                         azureDevops.list(pat) ──────▶ DevOps REST
             ◀── normalized PR[]    ◀──  merge + persist cache
prReview:start ▶ forward            ──▶  prReview.run():
                                          - git worktree add <tmp> <branch>
                                          - spawn headless review agent (cwd=tmp)
                                          - parse findings (structured)
                                          - persist to pr_reviews (v20)
                                          - git worktree remove <tmp>
             ◀── review row + push ◀──  progress + final report
prReview:postComments ▶ forward     ──▶  provider.postComments(pat, findings) ─▶ host
```

## 4. Data model

### 4.1 Normalized PR (in-memory / cache), `prProviders/types.ts`
```ts
type PrHost = 'github' | 'azdo';
interface PullRequest {
  host: PrHost;
  repoKey: string;        // stable id: "gh:owner/repo" | "azdo:project/repo"
  repoLabel: string;      // display: "Watchtower" | "PPS / technology" | "Spot"
  number: number;         // PR/MR number (GitHub #, DevOps !)
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;            // web URL for "open externally"
  updatedAt: string;      // ISO; drives "age" + sort
  localClonePath: string | null; // project folder_path if the repo is cloned locally
}
```
Repos are resolved from the Watchtower `projects` table (`folder_path`) plus a
small module config that maps each project to its host + remote coordinates
(see §8). A PR whose repo has no local clone can still be **listed** and its
**diff viewed** (diff fetched from the host API), but **cannot be reviewed**
(review requires a local clone to build a worktree) — the Review action is
disabled with a tooltip in that case.

### 4.2 `pr_reviews` table — migration **v20**
```
pr_reviews(
  id            INTEGER PRIMARY KEY,
  host          TEXT NOT NULL,          -- 'github' | 'azdo'
  repo_key      TEXT NOT NULL,
  pr_number     INTEGER NOT NULL,
  head_sha      TEXT NOT NULL,          -- reviewed commit; staleness check vs current PR head
  status        TEXT NOT NULL,          -- 'running' | 'done' | 'error'
  summary       TEXT,                   -- markdown
  findings_json TEXT,                   -- JSON array of Finding (see 4.3)
  error         TEXT,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
)
```
`(host, repo_key, pr_number, head_sha)` is treated as one review; re-reviewing
the same head reuses/replaces the row. A PR whose current head ≠ `head_sha`
shows a "diff changed since review" indicator.

### 4.3 Finding (structured), mirrors the `ReportFindings` shape
```ts
interface Finding {
  file: string;         // repo-relative
  line: number;         // 1-indexed anchor
  severity: 'error' | 'warn' | 'info';
  category: string;     // e.g. 'correctness' | 'efficiency' | 'simplification'
  summary: string;      // one-line
  detail?: string;      // optional longer text
  snippet?: string;     // optional offending code
}
```
Structured findings are what make (a) inline diff markers, (b) Report↔diff line
links, and (c) post-back to inline comments possible without re-parsing prose.

## 5. Providers

### 5.1 GitHub — `github.ts`
- Auth: existing `gh` CLI login (no new secret).
- List: `gh pr list --state open --json number,title,author,headRefName,baseRefName,updatedAt,url` per repo (or `gh search prs` across repos).
- Diff: `gh pr diff <n>`.
- Post-back (SP3): `gh api` review-comments endpoint (or `gh pr review`).

### 5.2 Azure DevOps — `azureDevops.ts`
- Auth: **PAT** (Basic auth header), PAT supplied by main from `safeStorage`.
- Config: org/collection base URL + project list (PPS, Spot) — see §8.
- List: `GET {base}/{project}/_apis/git/repositories/{repo}/pullrequests?searchCriteria.status=active&api-version=7.1`.
- Diff: iterations / `GET .../pullRequests/{id}/iterations/{it}/changes` + blob fetch, or the unified-diff endpoint; normalize to the same hunk model as GitHub.
- Post-back (SP3): `POST .../pullRequests/{id}/threads` with a thread anchored to `filePath` + line (right side).

Both adapters implement a common interface:
```ts
interface PrProvider {
  listOpen(repo): Promise<PullRequest[]>;
  fetchDiff(pr): Promise<DiffFile[]>;      // normalized file/hunk/line model
  postComments(pr, findings): Promise<void>;
}
```

## 6. IPC contract additions

New kinds (mirror into `messagePort.ts`; handlers in `orchestrator/index.ts`):
- `prs:list` → `{ pullRequests: PullRequest[], syncedAt: string }` (cached)
- `prs:refresh` → re-query both hosts, update cache, return same shape
- `prs:diff` `{ host, repoKey, prNumber }` → `{ files: DiffFile[] }`
- `prReview:start` `{ host, repoKey, prNumber }` → `{ reviewId }` (async; progress via push)
- `prReview:get` `{ reviewId }` → review row (summary + findings)
- `prReview:list` `{ repoKey?, prNumber? }` → recent reviews (for the list's review-state column)
- `prReview:postComments` `{ reviewId, findingIndexes: number[] }` → `{ posted: number }` (SP3)
- `devops:setPat` `{ pat }` (electron-only; writes to `safeStorage`) + `devops:hasPat` → `boolean`

New pushes (`IpcPush`, orchestrator → renderer):
- `prReviewProgress` `{ reviewId, status, message }`
- `prReviewDone` `{ reviewId }`

## 7. Sub-projects (build order)

### Sub-project 1 — PR listing + diff (ship first, read-only)
**Scope:** both provider adapters (list + fetchDiff), normalized model, repo
config resolution, `prs:list` / `prs:refresh` / `prs:diff` IPC, DevOps PAT
storage (`safeStorage`), the Reviews sidebar entry + list UI (host groups,
row = host badge · number+title · repo · author · branch · age · review-state
column · action), filter chips + text search + refresh, and the drawer's
**Diff tab** (changed-file tree + syntax-highlighted unified diff).
**Value:** a unified, readable PR inbox on day one; zero write risk.
**Done when:** all open PRs from GitHub + PPS + Spot list and refresh; any PR's
diff renders in the Diff tab; PAT can be set and is stored encrypted.

### Sub-project 2 — Review runner (core)
**Scope:** `prReview.ts` — worktree lifecycle (`git worktree add/remove` at the
PR branch in the local clone), headless review-agent spawn with full repo
context (reuse the project's review approach; agent emits structured
`Finding[]` + markdown summary), findings capture, `pr_reviews` table
(migration **v20**), `prReview:start/get/list` IPC + progress pushes, the
Report tab (summary + findings), inline finding markers on the Diff tab, and
Report↔diff line linking. Review action disabled for repos without a local
clone.
**Done when:** firing Review on a locally-cloned PR produces a persisted report
that survives reload, with findings shown inline on the diff.

### Sub-project 3 — Post-back (opt-in)
**Scope:** write paths in both adapters (`postComments`), finding-selection UI
in the Report tab (checkboxes + "N selected"), `prReview:postComments` IPC, and
the host-aware post button ("Post N comments to <PR>"). "Copy markdown" escape
hatch is available from SP2.
**Done when:** selected findings post as inline comments on a GitHub PR and as
DevOps threads, anchored to the right file+line.

## 8. Auth, secrets & config

- **DevOps PAT** stored via Electron `safeStorage.encryptString`; the encrypted
  blob persists in the `settings` table (key `reviews.devops.patEnc`) but is
  useless without the Keychain. Main decrypts on demand.
- **PAT usage boundary:** DevOps HTTP is issued from the **orchestrator**
  `azureDevops.ts` adapter (all provider logic in one place). Electron-main
  decrypts the PAT via `safeStorage` and passes it to the orchestrator **per
  request** over the MessagePort; the orchestrator uses it transiently for that
  call and never persists the plaintext PAT. (Rationale: keeps all provider
  logic co-located in `orchestrator/services/`, while the secret only ever
  rests encrypted in the process that owns Keychain.)
- **DevOps org/collection URL + project→repo map**: module config in the
  `settings` table (key `reviews.repos`), editable from a small Reviews
  settings panel. GitHub repos are auto-discovered from `projects.folder_path`
  git remotes where possible; DevOps repos are configured explicitly (PPS,
  Spot).
- **Backup convention:** any settings file write follows Watchtower's
  `<path>.bak.<ts>` convention (not applicable to `safeStorage`).

## 9. Error handling

- **List:** a failing host degrades gracefully — show the reachable host's PRs
  plus an inline `<Alert severity="error">` naming the failed host (pattern:
  `useProjects` + `ProjectsList`). Missing/expired PAT → a "Connect Azure
  DevOps" prompt, not an error spew.
- **Diff:** per-PR fetch error surfaces in the drawer's own error state.
- **Review:** worktree-add failure (dirty branch, missing clone) → review row
  `status='error'` with the git stderr in `error`; surfaced in the drawer.
  Worktree is always removed in a `finally` (never leak worktrees — matches the
  project's worktree-hygiene practice).
- **Post-back:** partial failure reports how many posted; never silent.

## 10. Testing

- **Providers:** unit-test normalization from canned GitHub/DevOps JSON
  fixtures → `PullRequest` / `DiffFile`. No live network in tests.
- **prReview:** test worktree lifecycle with a temp git repo (add → run stub
  agent → remove), findings parse/persist round-trip, staleness detection
  (`head_sha` change), and the `finally` worktree cleanup on agent failure.
- **Migration v20:** forward migration test (note the node:sqlite vs
  better-sqlite3 `ADD COLUMN` divergence — this is a new table, so low risk, but
  run the migration test suite).
- **IPC:** contract round-trip for the new kinds.
- Keep the suite green (219+ / current count); add tests with the code.

## 11. Decisions log
- PR scope: **all open PRs**, host-grouped, text-searchable (no author filter v1).
- Review output: **report-first, post optional**.
- Review depth: **full repo via throwaway worktree** at the PR branch.
- Diff viewing: **in-app Diff tab**, agent-free, part of SP1; findings link to lines.
- DevOps auth: **PAT** via Electron `safeStorage`; HTTP brokered by main.
- Table version: **v20** (`pr_reviews`).

## 12. Open questions (resolve during SP1 planning)
- Exact DevOps org/collection base URL(s) for PPS and Spot (config value).
- Whether GitHub repo discovery from `projects.folder_path` remotes is reliable
  enough, or all repos should be explicitly configured like DevOps.
- Diff rendering lib vs. hand-rolled (prefer a light, self-contained renderer to
  avoid a heavy dependency; unified view only in v1, no split view).
