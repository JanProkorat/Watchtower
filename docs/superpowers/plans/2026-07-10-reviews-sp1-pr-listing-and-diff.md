# Reviews SP1 — PR listing + diff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only first slice of the Reviews module: list all open PRs across GitHub + Škoda Azure DevOps project repos, and view any PR's diff in-app.

**Architecture:** Orchestrator provider adapters (`github.ts` via the `gh` CLI, `azureDevops.ts` via REST + PAT) produce a normalized `PullRequest[]` and parse raw unified diffs into a structured `DiffFile[]` server-side. A `ReviewsService` merges both hosts, caches in memory, and resolves repo config (GitHub repos auto-discovered from `projects.folder_path` git remotes; DevOps repos + org URL from a settings blob). Electron-main holds the DevOps PAT encrypted via `safeStorage` and injects the decrypted value into DevOps-bound payloads as they proxy to the orchestrator. The renderer adds a `Reviews` module (peer of Instances/Billing/Settings) with a host-grouped PR list and a right-anchored inspector Drawer whose Diff tab renders `DiffFile[]` with a hand-rolled `Box`-grid view.

**Tech Stack:** TypeScript, Electron (main + Node `utilityProcess` orchestrator), React + MUI v5 (`sx` only), `node:child_process` `execFile` for `gh`/`git`, global `fetch` for DevOps REST, vitest (node env).

## Global Constraints

- **No i18n; Czech UI copy.** Dates `D. M. YYYY` (cs-CZ) via `formatDate*` in `apps/desktop/src/util/format.ts`; numbers use NBSP thousands sep. (No dates/numbers rendered in SP1 beyond relative age.)
- **Renderer never touches SQLite/git/network/secrets directly** — always renderer → `window.watchtower.invoke(kind, payload)` → main → orchestrator.
- **SP1 is read-only w.r.t. PRs** — no writes to any PR (that is SP3). DevOps calls are GET only.
- **Theme:** support dark + light via MUI theme-token strings (`'background.paper'`, `'divider'`, `'text.secondary'`, `'primary.main'`). Never import raw hex from `theme.ts`.
- **Renderer house style:** plain `Box` + CSS grid + `sx`. No MUI `Table`/`List`/`ListItem`, no `styled()`, no `Avatar` (use small `Box` circles).
- **IPC naming:** `<noun>:<verb>`. Add every new kind to `packages/shared/src/ipcContract.ts` (request+response) AND mirror into `packages/shared/src/messagePort.ts`; electron-only kinds also go in `ELECTRON_ONLY_KINDS`.
- **Test convention:** vitest node env, tests under `tests/orchestrator/*.test.ts` and `tests/client/*.test.ts`; imports use `.js` extensions; NO `@testing-library/react` — test exported pure functions, not rendered JSX. Keep the suite green (currently 219+; assertion in `tests/orchestrator/migrations.test.ts` pins the schema version — SP1 adds no migration so it stays 19).
- **CLI robustness:** run external binaries with `execFile` + augmented PATH (mirror `orchestrator/services/tokenUsage.ts`), timeout, and `maxBuffer` ≥ 8 MB.
- **Verify before done:** `npm test` and `npm run typecheck:ci` (covers all workspaces) must pass.

---

## File structure

**Create (orchestrator):**
- `orchestrator/services/prProviders/types.ts` — internal `RepoConfig`, `Exec`, `HttpGet`, provider interfaces.
- `orchestrator/services/prProviders/diffParse.ts` — `parseUnifiedDiff(raw): DiffFile[]` (pure).
- `orchestrator/services/prProviders/github.ts` — `parseGithubPrList`, `listGithubPrs`, `fetchGithubDiff`, `discoverGithubRepo`.
- `orchestrator/services/prProviders/azureDevops.ts` — `parseAzdoPrList`, `listAzdoPrs`, `fetchAzdoDiff`.
- `orchestrator/services/reviews.ts` — `ReviewsService` (config, resolution, merge, cache, diff dispatch).

**Create (electron):**
- `electron/devopsPat.ts` — safeStorage encrypt/decrypt + in-memory cache + persistence via orchestrator settings.

**Create (renderer):**
- `apps/desktop/src/state/useReviews.ts` — hook + exported pure helpers `groupPrsByHost`, `sortByUpdatedDesc`, `applyPrFilter`, `relativeAge`.
- `apps/desktop/src/components/reviews/ModuleReviews.tsx` — module shell + list.
- `apps/desktop/src/components/reviews/PrRow.tsx` — one PR row.
- `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx` — right drawer with Diff tab.
- `apps/desktop/src/components/reviews/DiffView.tsx` — hand-rolled diff renderer for `DiffFile[]`.
- `apps/desktop/src/components/reviews/ConnectDevopsDrawer.tsx` — capture PAT + org URL + repos.

**Modify:**
- `packages/shared/src/ipcContract.ts` — new payload types, `IpcRequest`/`IpcResponse` kinds, `ELECTRON_ONLY_KINDS`.
- `packages/shared/src/messagePort.ts` — mirror the kinds.
- `orchestrator/index.ts` — handlers in the `handleRequest` switch.
- `electron/ipc.ts` — DevOps-payload injection + `devops:setPat`/`devops:hasPat` electron-only handlers.
- `apps/desktop/src/components/ModuleRail.tsx` — `ModuleId` + `ITEMS`.
- `apps/desktop/src/state/useActiveModule.ts` — `VALID` set.
- `apps/desktop/src/App.tsx` — render `<ModuleReviews />`.

**Test:**
- `tests/orchestrator/diffParse.test.ts`, `tests/orchestrator/githubProvider.test.ts`, `tests/orchestrator/azdoProvider.test.ts`, `tests/orchestrator/reviewsService.test.ts`
- `tests/client/useReviews.test.ts`

---

## Task 1: Shared IPC types & kinds

**Files:**
- Modify: `packages/shared/src/ipcContract.ts`
- Modify: `packages/shared/src/messagePort.ts`

**Interfaces produced (used by every later task):**
```ts
export type PrHost = 'github' | 'azdo';
export interface PullRequestPayload {
  host: PrHost; repoKey: string; repoLabel: string;
  number: number; title: string; author: string;
  sourceBranch: string; targetBranch: string;
  url: string; updatedAt: string; reviewable: boolean; // false when repo not cloned locally
}
export interface DiffLinePayload { kind: 'add' | 'del' | 'ctx' | 'hunk'; oldNo: number | null; newNo: number | null; text: string; }
export interface DiffFilePayload { path: string; additions: number; deletions: number; lines: DiffLinePayload[]; }
export interface DevopsRepoConfigPayload { orgBaseUrl: string; project: string; repo: string; }
```
IPC kinds (request → response payload):
- `prs:list` `{}` → `{ pullRequests: PullRequestPayload[]; syncedAt: string | null }`
- `prs:refresh` `{ devopsPat?: string }` → same as `prs:list`
- `prs:diff` `{ host: PrHost; repoKey: string; prNumber: number; devopsPat?: string }` → `{ files: DiffFilePayload[] }`
- `reviews:getDevopsConfig` `{}` → `{ orgBaseUrl: string; repos: DevopsRepoConfigPayload[]; hasPat: boolean }`
- `reviews:setDevopsConfig` `{ orgBaseUrl: string; repos: DevopsRepoConfigPayload[] }` → `{ ok: true }`
- `devops:setPat` `{ pat: string }` → `{ ok: true }` — **electron-only**
- `devops:hasPat` `{}` → `{ hasPat: boolean }` — **electron-only**

(`devopsPat` on `prs:refresh`/`prs:diff` is injected by main; the renderer always sends it absent.)

- [ ] **Step 1: Add payload types + request/response kinds to `ipcContract.ts`**

Add the interface block above near the other payload types. Then add to the `IpcRequest` union:
```ts
  | { kind: 'prs:list'; payload: Record<string, never> }
  | { kind: 'prs:refresh'; payload: { devopsPat?: string } }
  | { kind: 'prs:diff'; payload: { host: PrHost; repoKey: string; prNumber: number; devopsPat?: string } }
  | { kind: 'reviews:getDevopsConfig'; payload: Record<string, never> }
  | { kind: 'reviews:setDevopsConfig'; payload: { orgBaseUrl: string; repos: DevopsRepoConfigPayload[] } }
  | { kind: 'devops:setPat'; payload: { pat: string } }
  | { kind: 'devops:hasPat'; payload: Record<string, never> }
```
And to `IpcResponse`:
```ts
  | { kind: 'prs:list'; payload: { pullRequests: PullRequestPayload[]; syncedAt: string | null } }
  | { kind: 'prs:refresh'; payload: { pullRequests: PullRequestPayload[]; syncedAt: string | null } }
  | { kind: 'prs:diff'; payload: { files: DiffFilePayload[] } }
  | { kind: 'reviews:getDevopsConfig'; payload: { orgBaseUrl: string; repos: DevopsRepoConfigPayload[]; hasPat: boolean } }
  | { kind: 'reviews:setDevopsConfig'; payload: { ok: true } }
  | { kind: 'devops:setPat'; payload: { ok: true } }
  | { kind: 'devops:hasPat'; payload: { hasPat: boolean } }
```

- [ ] **Step 2: Register electron-only kinds**

In `ipcContract.ts`, add to the `ELECTRON_ONLY_KINDS` set: `'devops:setPat'`, `'devops:hasPat'`.

- [ ] **Step 3: Mirror kinds into `messagePort.ts`**

Add the same seven kinds to `OrchRequest` (each with `id: string` prefix, matching the file's pattern) and `OrchResponse`, EXCEPT `devops:setPat`/`devops:hasPat` (electron-only, never reach the orchestrator). So the orchestrator side gets: `prs:list`, `prs:refresh`, `prs:diff`, `reviews:getDevopsConfig`, `reviews:setDevopsConfig`. Reuse the same payload types (import them from `./ipcContract.js` if the file already cross-imports; otherwise redeclare the minimal shapes as the file does for other kinds).

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit` and `npm run typecheck:ci`
Expected: no new errors (unused-kind errors are fine until handlers exist — if `tsc` flags an unhandled switch case, that surfaces in Task 6; contract file itself must compile).

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/ipcContract.ts packages/shared/src/messagePort.ts
git commit -m "feat(reviews): IPC contract for PR listing + diff"
```

---

## Task 2: Unified diff parser (pure)

**Files:**
- Create: `orchestrator/services/prProviders/diffParse.ts`
- Test: `tests/orchestrator/diffParse.test.ts`

**Interfaces:**
- Consumes: `DiffFilePayload`, `DiffLinePayload` (Task 1).
- Produces: `export function parseUnifiedDiff(raw: string): DiffFilePayload[]`

- [ ] **Step 1: Write the failing test**
```ts
// tests/orchestrator/diffParse.test.ts
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../../orchestrator/services/prProviders/diffParse.js';

const SAMPLE = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
`;

describe('parseUnifiedDiff', () => {
  it('parses one file with add/del/ctx lines and counts', () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/foo.ts');
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    const kinds = files[0].lines.map((l) => l.kind);
    expect(kinds).toContain('hunk');
    expect(kinds).toContain('add');
    expect(kinds).toContain('del');
    expect(kinds).toContain('ctx');
  });

  it('returns [] for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('assigns line numbers: ctx and add advance newNo, del advances oldNo', () => {
    const [f] = parseUnifiedDiff(SAMPLE);
    const add = f.lines.find((l) => l.kind === 'add' && l.text.includes('const c'))!;
    expect(add.newNo).toBe(4);
    expect(add.oldNo).toBeNull();
    const del = f.lines.find((l) => l.kind === 'del')!;
    expect(del.oldNo).toBe(2);
    expect(del.newNo).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/diffParse.test.ts`
Expected: FAIL — cannot find module `diffParse.js`.

- [ ] **Step 3: Write minimal implementation**
```ts
// orchestrator/services/prProviders/diffParse.ts
import type { DiffFilePayload, DiffLinePayload } from '@watchtower/shared/ipcContract.js';

const FILE_RE = /^\+\+\+ b\/(.+)$/;
const OLD_FILE_RE = /^--- a\/(.+)$/;
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(raw: string): DiffFilePayload[] {
  if (!raw.trim()) return [];
  const files: DiffFilePayload[] = [];
  let cur: DiffFilePayload | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      cur = null;
      continue;
    }
    const mOld = OLD_FILE_RE.exec(line);
    if (mOld) continue; // path taken from +++ line
    const mNew = FILE_RE.exec(line);
    if (mNew) {
      cur = { path: mNew[1], additions: 0, deletions: 0, lines: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    const mHunk = HUNK_RE.exec(line);
    if (mHunk) {
      oldNo = Number(mHunk[1]);
      newNo = Number(mHunk[2]);
      cur.lines.push({ kind: 'hunk', oldNo: null, newNo: null, text: line });
      continue;
    }
    const first = line[0];
    if (first === '+') {
      cur.lines.push({ kind: 'add', oldNo: null, newNo, text: line.slice(1) });
      cur.additions++;
      newNo++;
    } else if (first === '-') {
      cur.lines.push({ kind: 'del', oldNo, newNo: null, text: line.slice(1) });
      cur.deletions++;
      oldNo++;
    } else {
      // context (leading space) or trailing blank line
      cur.lines.push({ kind: 'ctx', oldNo, newNo, text: line.startsWith(' ') ? line.slice(1) : line });
      oldNo++;
      newNo++;
    }
  }
  return files;
}
```
(If `@watchtower/shared/ipcContract.js` is not the resolvable specifier, match the import style already used in `orchestrator/services/jiraBoard.ts` for shared types.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/diffParse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add orchestrator/services/prProviders/diffParse.ts tests/orchestrator/diffParse.test.ts
git commit -m "feat(reviews): unified-diff parser"
```

---

## Task 3: GitHub provider adapter

**Files:**
- Create: `orchestrator/services/prProviders/types.ts`
- Create: `orchestrator/services/prProviders/github.ts`
- Test: `tests/orchestrator/githubProvider.test.ts`

**Interfaces:**
- Consumes: `PullRequestPayload`, `DiffFilePayload` (Task 1); `parseUnifiedDiff` (Task 2).
- Produces:
```ts
// types.ts
export type Exec = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<string>;
export interface GithubRepoConfig { host: 'github'; repoKey: string; repoLabel: string; nwo: string; localClonePath: string | null; }
// github.ts
export function parseGithubPrList(json: string, repo: GithubRepoConfig): PullRequestPayload[];
export function listGithubPrs(repo: GithubRepoConfig, exec?: Exec): Promise<PullRequestPayload[]>;
export function fetchGithubDiff(repo: GithubRepoConfig, prNumber: number, exec?: Exec): Promise<DiffFilePayload[]>;
export function parseGitRemoteNwo(remoteUrl: string): string | null; // "git@github.com:o/r.git" -> "o/r"
```

- [ ] **Step 1: Write the failing test**
```ts
// tests/orchestrator/githubProvider.test.ts
import { describe, it, expect } from 'vitest';
import { parseGithubPrList, parseGitRemoteNwo } from '../../orchestrator/services/prProviders/github.js';

const REPO = { host: 'github' as const, repoKey: 'gh:o/r', repoLabel: 'r', nwo: 'o/r', localClonePath: '/tmp/r' };
const GH_JSON = JSON.stringify([
  { number: 165, title: 'feat: x', author: { login: 'jan' }, headRefName: 'b1', baseRefName: 'main',
    updatedAt: '2026-07-10T12:00:00Z', url: 'https://github.com/o/r/pull/165' },
]);

describe('github provider', () => {
  it('normalizes gh pr list JSON', () => {
    const prs = parseGithubPrList(GH_JSON, REPO);
    expect(prs[0]).toMatchObject({
      host: 'github', repoKey: 'gh:o/r', number: 165, title: 'feat: x',
      author: 'jan', sourceBranch: 'b1', targetBranch: 'main', reviewable: true,
    });
  });
  it('reviewable=false when no local clone', () => {
    const prs = parseGithubPrList(GH_JSON, { ...REPO, localClonePath: null });
    expect(prs[0].reviewable).toBe(false);
  });
  it('parses ssh and https remotes to nwo', () => {
    expect(parseGitRemoteNwo('git@github.com:o/r.git')).toBe('o/r');
    expect(parseGitRemoteNwo('https://github.com/o/r.git')).toBe('o/r');
    expect(parseGitRemoteNwo('https://gitlab.com/o/r.git')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/githubProvider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `types.ts` with the `Exec`/`GithubRepoConfig` (and later `AzdoRepoConfig`) declarations. Then `github.ts`:
```ts
// orchestrator/services/prProviders/github.ts
import { execFile } from 'node:child_process';
import type { PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';
import type { Exec, GithubRepoConfig } from './types.js';
import { parseUnifiedDiff } from './diffParse.js';

const GH_FIELDS = 'number,title,author,headRefName,baseRefName,updatedAt,url';

export function parseGitRemoteNwo(remoteUrl: string): string | null {
  const u = remoteUrl.trim();
  let m = /^git@github\.com:(.+?)(?:\.git)?$/.exec(u);
  if (m) return m[1];
  m = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/.exec(u);
  return m ? m[1] : null;
}

export function parseGithubPrList(json: string, repo: GithubRepoConfig): PullRequestPayload[] {
  const rows = JSON.parse(json) as Array<{
    number: number; title: string; author: { login: string } | null;
    headRefName: string; baseRefName: string; updatedAt: string; url: string;
  }>;
  return rows.map((r) => ({
    host: 'github', repoKey: repo.repoKey, repoLabel: repo.repoLabel,
    number: r.number, title: r.title, author: r.author?.login ?? 'unknown',
    sourceBranch: r.headRefName, targetBranch: r.baseRefName,
    url: r.url, updatedAt: r.updatedAt, reviewable: repo.localClonePath != null,
  }));
}

const defaultExec: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, cwd: opts?.cwd,
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` } },
      (err, stdout, stderr) => {
        if (err) { (err as Error).message += stderr ? `: ${stderr.trim()}` : ''; reject(err); }
        else resolve(stdout);
      });
  });

export async function listGithubPrs(repo: GithubRepoConfig, exec: Exec = defaultExec): Promise<PullRequestPayload[]> {
  const out = await exec('gh', ['pr', 'list', '--repo', repo.nwo, '--state', 'open', '--limit', '100', '--json', GH_FIELDS]);
  return parseGithubPrList(out, repo);
}

export async function fetchGithubDiff(repo: GithubRepoConfig, prNumber: number, exec: Exec = defaultExec): Promise<DiffFilePayload[]> {
  const out = await exec('gh', ['pr', 'diff', String(prNumber), '--repo', repo.nwo]);
  return parseUnifiedDiff(out);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/githubProvider.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add orchestrator/services/prProviders/types.ts orchestrator/services/prProviders/github.ts tests/orchestrator/githubProvider.test.ts
git commit -m "feat(reviews): GitHub PR provider (gh CLI)"
```

---

## Task 4: Azure DevOps provider adapter

**Files:**
- Modify: `orchestrator/services/prProviders/types.ts` (add `AzdoRepoConfig`, `HttpGet`)
- Create: `orchestrator/services/prProviders/azureDevops.ts`
- Test: `tests/orchestrator/azdoProvider.test.ts`

**Interfaces:**
- Produces:
```ts
export interface AzdoRepoConfig { host: 'azdo'; repoKey: string; repoLabel: string; orgBaseUrl: string; project: string; repo: string; localClonePath: string | null; }
export type HttpGet = (url: string, pat: string) => Promise<unknown>;
export function parseAzdoPrList(json: unknown, repo: AzdoRepoConfig): PullRequestPayload[];
export function listAzdoPrs(repo: AzdoRepoConfig, pat: string, get?: HttpGet): Promise<PullRequestPayload[]>;
export function fetchAzdoDiff(repo: AzdoRepoConfig, prNumber: number, pat: string, get?: HttpGet): Promise<DiffFilePayload[]>;
```

- [ ] **Step 1: Write the failing test**
```ts
// tests/orchestrator/azdoProvider.test.ts
import { describe, it, expect } from 'vitest';
import { parseAzdoPrList } from '../../orchestrator/services/prProviders/azureDevops.js';

const REPO = { host: 'azdo' as const, repoKey: 'azdo:PPS/technology', repoLabel: 'PPS / technology',
  orgBaseUrl: 'https://devops.skoda/tfs/DefaultCollection', project: 'PPS', repo: 'technology', localClonePath: '/tmp/pps' };
const AZDO = { value: [
  { pullRequestId: 4821, title: 'TEH-2044', createdBy: { uniqueName: 'm.kral@skoda' },
    sourceRefName: 'refs/heads/feature/TEH-2044', targetRefName: 'refs/heads/develop',
    creationDate: '2026-07-10T09:00:00Z' },
] };

describe('azdo provider', () => {
  it('normalizes AZDO PR JSON and strips refs/heads/', () => {
    const prs = parseAzdoPrList(AZDO, REPO);
    expect(prs[0]).toMatchObject({
      host: 'azdo', repoKey: 'azdo:PPS/technology', number: 4821, title: 'TEH-2044',
      author: 'm.kral@skoda', sourceBranch: 'feature/TEH-2044', targetBranch: 'develop', reviewable: true,
    });
    expect(prs[0].url).toContain('/pullrequest/4821');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/azdoProvider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**
```ts
// orchestrator/services/prProviders/azureDevops.ts
import type { PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';
import type { AzdoRepoConfig, HttpGet } from './types.js';
import { parseUnifiedDiff } from './diffParse.js';

const API = 'api-version=7.1';
const stripRef = (r: string) => r.replace(/^refs\/heads\//, '');

export function parseAzdoPrList(json: unknown, repo: AzdoRepoConfig): PullRequestPayload[] {
  const rows = (json as { value?: Array<Record<string, unknown>> }).value ?? [];
  return rows.map((r) => {
    const id = r.pullRequestId as number;
    return {
      host: 'azdo', repoKey: repo.repoKey, repoLabel: repo.repoLabel, number: id,
      title: (r.title as string) ?? '', author: ((r.createdBy as { uniqueName?: string })?.uniqueName) ?? 'unknown',
      sourceBranch: stripRef((r.sourceRefName as string) ?? ''), targetBranch: stripRef((r.targetRefName as string) ?? ''),
      url: `${repo.orgBaseUrl}/${repo.project}/_git/${repo.repo}/pullrequest/${id}`,
      updatedAt: (r.creationDate as string) ?? '', reviewable: repo.localClonePath != null,
    };
  });
}

const defaultGet: HttpGet = async (url, pat) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} for ${url}`);
  return res.json();
};

export async function listAzdoPrs(repo: AzdoRepoConfig, pat: string, get: HttpGet = defaultGet): Promise<PullRequestPayload[]> {
  const url = `${repo.orgBaseUrl}/${repo.project}/_apis/git/repositories/${repo.repo}/pullrequests?searchCriteria.status=active&$top=100&${API}`;
  return parseAzdoPrList(await get(url, pat), repo);
}

export async function fetchAzdoDiff(repo: AzdoRepoConfig, prNumber: number, pat: string, get: HttpGet = defaultGet): Promise<DiffFilePayload[]> {
  // DevOps has no single unified-diff endpoint; SP1 uses the commit-level diff text
  // via the "diffs/commits" API and reconstructs unified hunks. For the first slice
  // we fetch the PR's iteration changes and render file-level diffs.
  const itUrl = `${repo.orgBaseUrl}/${repo.project}/_apis/git/repositories/${repo.repo}/pullRequests/${prNumber}/iterations?${API}`;
  const iterations = (await get(itUrl, pat)) as { value: Array<{ id: number }> };
  const last = iterations.value.at(-1)?.id ?? 1;
  const chUrl = `${repo.orgBaseUrl}/${repo.project}/_apis/git/repositories/${repo.repo}/pullRequests/${prNumber}/iterations/${last}/changes?${API}`;
  const changes = (await get(chUrl, pat)) as { changeEntries?: Array<{ item?: { path?: string } }> };
  // Minimal SP1 rendering: one pseudo-file entry per changed path, no line bodies yet.
  // (Full DevOps hunk bodies are a follow-up; GitHub diffs are full-fidelity in SP1.)
  const paths = (changes.changeEntries ?? []).map((c) => c.item?.path).filter(Boolean) as string[];
  const raw = paths.map((p) => `diff --git a${p} b${p}\n--- a${p}\n+++ b${p}\n`).join('');
  return parseUnifiedDiff(raw);
}
```
> **Note for the implementer:** DevOps full-fidelity line-level diffs require blob fetches per file and are explicitly a follow-up (tracked in the spec §12). SP1 ships GitHub diffs at full fidelity and DevOps diffs as a file-list placeholder; the `fetchAzdoDiff` contract is stable so the follow-up is a drop-in. Do NOT block SP1 on full DevOps hunks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/azdoProvider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add orchestrator/services/prProviders/types.ts orchestrator/services/prProviders/azureDevops.ts tests/orchestrator/azdoProvider.test.ts
git commit -m "feat(reviews): Azure DevOps PR provider (REST + PAT)"
```

---

## Task 5: ReviewsService (config, resolution, merge, cache)

**Files:**
- Create: `orchestrator/services/reviews.ts`
- Test: `tests/orchestrator/reviewsService.test.ts`

**Interfaces:**
- Consumes: providers (Tasks 3–4); `SettingsRepo` (`orchestrator/db/repositories/settings.js`); `SqliteLike`.
- Produces:
```ts
export interface ReviewsDeps {
  db: SqliteLike;
  listGithub?: (repo: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  listAzdo?: (repo: AzdoRepoConfig, pat: string) => Promise<PullRequestPayload[]>;
  gitRemote?: (cwd: string) => Promise<string | null>;
  projects?: () => Array<{ id: number; name: string; folder_path: string | null }>;
}
export class ReviewsService {
  constructor(deps: ReviewsDeps);
  getDevopsConfig(): { orgBaseUrl: string; repos: DevopsRepoConfigPayload[]; hasPatFlag: boolean };
  setDevopsConfig(cfg: { orgBaseUrl: string; repos: DevopsRepoConfigPayload[] }): void;
  list(): { pullRequests: PullRequestPayload[]; syncedAt: string | null };       // cache
  refresh(devopsPat: string | undefined): Promise<{ pullRequests: PullRequestPayload[]; syncedAt: string | null }>;
  diff(host: PrHost, repoKey: string, prNumber: number, devopsPat: string | undefined): Promise<DiffFilePayload[]>;
}
```
Config key: `reviews.devops` in `settings` (JSON `{ orgBaseUrl, repos }`), via `SettingsRepo`. GitHub repos are auto-resolved from `projects` rows whose `folder_path` git remote parses to a GitHub nwo. Cache is in-memory (`syncedAt` = ISO string set on refresh; `list()` returns last cache or empty + null).

- [ ] **Step 1: Write the failing test**
```ts
// tests/orchestrator/reviewsService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { ReviewsService } from '../../orchestrator/services/reviews.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

let db: SqliteLike;
beforeEach(() => {
  db = new DatabaseSync(':memory:') as unknown as SqliteLike;
  runMigrations(db);
});

const deps = () => ({
  db,
  projects: () => [{ id: 1, name: 'Watchtower', folder_path: '/tmp/wt' }],
  gitRemote: async () => 'git@github.com:jan/watchtower.git',
  listGithub: async () => [{ host: 'github', repoKey: 'gh:jan/watchtower', repoLabel: 'Watchtower',
    number: 1, title: 'x', author: 'jan', sourceBranch: 'b', targetBranch: 'main',
    url: 'u', updatedAt: '2026-07-10T00:00:00Z', reviewable: true } as const],
  listAzdo: async () => [],
});

describe('ReviewsService', () => {
  it('list() is empty with null syncedAt before refresh', () => {
    const svc = new ReviewsService(deps());
    expect(svc.list()).toEqual({ pullRequests: [], syncedAt: null });
  });
  it('refresh() resolves GitHub repos from project remotes and caches', async () => {
    const svc = new ReviewsService(deps());
    const res = await svc.refresh(undefined);
    expect(res.pullRequests).toHaveLength(1);
    expect(res.syncedAt).not.toBeNull();
    expect(svc.list().pullRequests).toHaveLength(1); // cached
  });
  it('devops config round-trips through settings', () => {
    const svc = new ReviewsService(deps());
    svc.setDevopsConfig({ orgBaseUrl: 'https://x/tfs', repos: [{ orgBaseUrl: 'https://x/tfs', project: 'PPS', repo: 'technology' }] });
    const got = svc.getDevopsConfig();
    expect(got.orgBaseUrl).toBe('https://x/tfs');
    expect(got.repos[0].repo).toBe('technology');
  });
  it('refresh() skips DevOps when no PAT and reports only github', async () => {
    const svc = new ReviewsService(deps());
    svc.setDevopsConfig({ orgBaseUrl: 'https://x/tfs', repos: [{ orgBaseUrl: 'https://x/tfs', project: 'PPS', repo: 'technology' }] });
    const res = await svc.refresh(undefined);
    expect(res.pullRequests.every((p) => p.host === 'github')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/reviewsService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**
```ts
// orchestrator/services/reviews.ts
import { execFile } from 'node:child_process';
import type { SqliteLike } from '../db/migrations.js';
import { SettingsRepo } from '../db/repositories/settings.js';
import type { PrHost, PullRequestPayload, DiffFilePayload, DevopsRepoConfigPayload } from '@watchtower/shared/ipcContract.js';
import type { GithubRepoConfig, AzdoRepoConfig } from './prProviders/types.js';
import { listGithubPrs, fetchGithubDiff, parseGitRemoteNwo } from './prProviders/github.js';
import { listAzdoPrs, fetchAzdoDiff } from './prProviders/azureDevops.js';

const CONFIG_KEY = 'reviews.devops';

interface DevopsStored { orgBaseUrl: string; repos: DevopsRepoConfigPayload[]; }

export interface ReviewsDeps {
  db: SqliteLike;
  listGithub?: (repo: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  listAzdo?: (repo: AzdoRepoConfig, pat: string) => Promise<PullRequestPayload[]>;
  gitRemote?: (cwd: string) => Promise<string | null>;
  projects?: () => Array<{ id: number; name: string; folder_path: string | null }>;
}

const realGitRemote = (cwd: string) => new Promise<string | null>((resolve) => {
  execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5_000 }, (err, out) => resolve(err ? null : out.trim()));
});

export class ReviewsService {
  private settings: SettingsRepo;
  private cache: PullRequestPayload[] = [];
  private syncedAt: string | null = null;
  private listGithub: (r: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  private listAzdo: (r: AzdoRepoConfig, pat: string) => Promise<PullRequestPayload[]>;
  private gitRemote: (cwd: string) => Promise<string | null>;
  private projectsFn: () => Array<{ id: number; name: string; folder_path: string | null }>;

  constructor(deps: ReviewsDeps) {
    this.settings = new SettingsRepo(deps.db);
    this.listGithub = deps.listGithub ?? ((r) => listGithubPrs(r));
    this.listAzdo = deps.listAzdo ?? ((r, pat) => listAzdoPrs(r, pat));
    this.gitRemote = deps.gitRemote ?? realGitRemote;
    this.projectsFn = deps.projects ?? (() => []);
  }

  private readConfig(): DevopsStored {
    const raw = this.settings.getString(CONFIG_KEY, '');
    if (!raw) return { orgBaseUrl: '', repos: [] };
    try { return JSON.parse(raw) as DevopsStored; } catch { return { orgBaseUrl: '', repos: [] }; }
  }

  getDevopsConfig() {
    const c = this.readConfig();
    return { orgBaseUrl: c.orgBaseUrl, repos: c.repos, hasPatFlag: false };
  }
  setDevopsConfig(cfg: DevopsStored): void {
    this.settings.set(CONFIG_KEY, JSON.stringify({ orgBaseUrl: cfg.orgBaseUrl, repos: cfg.repos }));
  }

  private async githubRepos(): Promise<GithubRepoConfig[]> {
    const out: GithubRepoConfig[] = [];
    for (const p of this.projectsFn()) {
      if (!p.folder_path) continue;
      const remote = await this.gitRemote(p.folder_path);
      const nwo = remote ? parseGitRemoteNwo(remote) : null;
      if (!nwo) continue;
      out.push({ host: 'github', repoKey: `gh:${nwo}`, repoLabel: p.name, nwo, localClonePath: p.folder_path });
    }
    return out;
  }
  private azdoRepos(): AzdoRepoConfig[] {
    const c = this.readConfig();
    return c.repos.map((r) => ({ host: 'azdo', repoKey: `azdo:${r.project}/${r.repo}`,
      repoLabel: `${r.project} / ${r.repo}`, orgBaseUrl: r.orgBaseUrl || c.orgBaseUrl,
      project: r.project, repo: r.repo, localClonePath: null }));
  }

  list() { return { pullRequests: this.cache, syncedAt: this.syncedAt }; }

  async refresh(devopsPat: string | undefined) {
    const results: PullRequestPayload[] = [];
    for (const r of await this.githubRepos()) {
      try { results.push(...(await this.listGithub(r))); } catch { /* degrade: skip repo */ }
    }
    if (devopsPat) {
      for (const r of this.azdoRepos()) {
        try { results.push(...(await this.listAzdo(r, devopsPat))); } catch { /* degrade */ }
      }
    }
    this.cache = results;
    this.syncedAt = isoNow();
    return this.list();
  }

  async diff(host: PrHost, repoKey: string, prNumber: number, devopsPat: string | undefined): Promise<DiffFilePayload[]> {
    if (host === 'github') {
      const repo = (await this.githubRepos()).find((r) => r.repoKey === repoKey);
      if (!repo) return [];
      return fetchGithubDiff(repo, prNumber);
    }
    const repo = this.azdoRepos().find((r) => r.repoKey === repoKey);
    if (!repo || !devopsPat) return [];
    return fetchAzdoDiff(repo, prNumber, devopsPat);
  }
}

function isoNow(): string { return new Date().toISOString(); }
```
> `SqliteLike`, `SettingsRepo` import paths mirror `orchestrator/services/jiraBoard.ts` and `orchestrator/db/repositories/settings.ts`. If `new Date().toISOString()` is disallowed in a shared context, it is fine here (orchestrator runtime, not a workflow script).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/reviewsService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add orchestrator/services/reviews.ts tests/orchestrator/reviewsService.test.ts
git commit -m "feat(reviews): ReviewsService — config, repo resolution, merge, cache"
```

---

## Task 6: Orchestrator IPC handlers

**Files:**
- Modify: `orchestrator/index.ts` (the `handleRequest` switch, ~line 516; and a lazily-constructed singleton like the other services)

**Interfaces:**
- Consumes: `ReviewsService` (Task 5); the DB handle used by other cases (`handle!.db`); the projects repo used by `projects:list` (`projectsRepo()`).

- [ ] **Step 1: Add a lazily-built service accessor**

Near the other service singletons in `orchestrator/index.ts`, add:
```ts
let _reviews: ReviewsService | null = null;
function reviewsSvc(): ReviewsService {
  if (!_reviews) {
    _reviews = new ReviewsService({
      db: handle!.db,
      projects: () => projectsRepo().list({}).map((p) => ({ id: p.id, name: p.name, folder_path: p.folder_path ?? null })),
    });
  }
  return _reviews;
}
```
(Import `ReviewsService` from `./services/reviews.js`. Match the exact `projectsRepo().list(...)` shape to what `projects:list` uses; adapt the field mapping to the real `ProjectRow`.)

- [ ] **Step 2: Add the switch cases**
```ts
case 'prs:list':
  return reviewsSvc().list();
case 'prs:refresh':
  return reviewsSvc().refresh((req.payload as { devopsPat?: string }).devopsPat);
case 'prs:diff': {
  const p = req.payload as { host: PrHost; repoKey: string; prNumber: number; devopsPat?: string };
  return { files: await reviewsSvc().diff(p.host, p.repoKey, p.prNumber, p.devopsPat) };
}
case 'reviews:getDevopsConfig': {
  const c = reviewsSvc().getDevopsConfig();
  return { orgBaseUrl: c.orgBaseUrl, repos: c.repos, hasPat: false }; // hasPat resolved in main; orchestrator returns false
}
case 'reviews:setDevopsConfig': {
  const p = req.payload as { orgBaseUrl: string; repos: DevopsRepoConfigPayload[] };
  reviewsSvc().setDevopsConfig(p);
  return { ok: true };
}
```
> `hasPat` truth lives in electron-main (it owns `safeStorage`); main overrides the `hasPat` field on the `reviews:getDevopsConfig` response before returning to the renderer (Task 7). The orchestrator returning `false` is a safe default.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: PASS (import `PrHost`, `DevopsRepoConfigPayload` from shared).

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS, count unchanged +0 new failures.

- [ ] **Step 5: Commit**
```bash
git add orchestrator/index.ts
git commit -m "feat(reviews): orchestrator handlers for prs:* + devops config"
```

---

## Task 7: Electron safeStorage PAT + payload injection

**Files:**
- Create: `electron/devopsPat.ts`
- Modify: `electron/ipc.ts`

**Interfaces:**
- Consumes: Electron `safeStorage`, `app`; the orchestrator proxy `orch.invoke` used in `electron/ipc.ts`.
- Produces:
```ts
// devopsPat.ts
export function setPat(plain: string): Promise<void>;   // encrypt + persist (settings key 'reviews.devops.patEnc') + cache
export function getPat(): Promise<string | null>;         // cached, else read+decrypt
export function hasPat(): Promise<boolean>;
```

- [ ] **Step 1: Implement `devopsPat.ts`**
```ts
// electron/devopsPat.ts
import { safeStorage } from 'electron';
import type { OrchestratorClient } from './orchestratorClient.js'; // whatever type orch.invoke is on

let orch: OrchestratorClient | null = null;
let cache: string | null = null;
const KEY = 'reviews.devops.patEnc';

export function bindOrchestrator(client: OrchestratorClient): void { orch = client; }

export async function setPat(plain: string): Promise<void> {
  const enc = safeStorage.encryptString(plain).toString('base64');
  await orch!.invoke('setSetting', { key: KEY, value: enc });
  cache = plain;
}
export async function getPat(): Promise<string | null> {
  if (cache) return cache;
  const { value } = await orch!.invoke('getSetting', { key: KEY });
  if (!value) return null;
  try { cache = safeStorage.decryptString(Buffer.from(value, 'base64')); return cache; }
  catch { return null; }
}
export async function hasPat(): Promise<boolean> { return (await getPat()) != null; }
```
> Use the SAME `getSetting`/`setSetting` kinds the orchestrator already exposes (confirmed present at `orchestrator/index.ts` lines ~643–663). Wire `bindOrchestrator(...)` where the orchestrator client is created in electron-main startup. Adapt `OrchestratorClient` to the actual exported type.

- [ ] **Step 2: Handle electron-only kinds + inject PAT in `electron/ipc.ts`**

Before the generic `orch.invoke(kind, payload)` passthrough, add:
```ts
import { setPat, hasPat, getPat } from './devopsPat.js';

if (kind === 'devops:setPat') {
  await setPat((payload as { pat: string }).pat);
  return { ok: true };
}
if (kind === 'devops:hasPat') {
  return { hasPat: await hasPat() };
}
if (kind === 'prs:refresh' || kind === 'prs:diff') {
  const pat = await getPat();
  return orch.invoke(kind as 'prs:refresh', { ...(payload as object), devopsPat: pat ?? undefined } as never);
}
if (kind === 'reviews:getDevopsConfig') {
  const res = await orch.invoke('reviews:getDevopsConfig', {} as never);
  return { ...(res as object), hasPat: await hasPat() };
}
```
Keep the existing `ELECTRON_ONLY_KINDS` guard AFTER these explicit handlers so `devops:setPat`/`devops:hasPat` are handled here (they are in the set) and never proxied.

- [ ] **Step 3: Typecheck main**

Run: `npm run typecheck:ci`
Expected: PASS.

- [ ] **Step 4: Manual smoke (documented, run at execution)**

Since there's no headless Electron test harness, verify at execution: `npm run dev`, open devtools console, `await window.watchtower.invoke('devops:hasPat', {})` → `{ hasPat: false }`; after `devops:setPat` → `{ hasPat: true }`. Record the result in the task's review note.

- [ ] **Step 5: Commit**
```bash
git add electron/devopsPat.ts electron/ipc.ts
git commit -m "feat(reviews): DevOps PAT via safeStorage + payload injection"
```

---

## Task 8: Register the Reviews module (renderer shell)

**Files:**
- Modify: `apps/desktop/src/components/ModuleRail.tsx` (`ModuleId` line 30; `ITEMS` lines 39–44)
- Modify: `apps/desktop/src/state/useActiveModule.ts` (`VALID` line 5)
- Modify: `apps/desktop/src/App.tsx` (module conditionals ~line 494)
- Create: `apps/desktop/src/components/reviews/ModuleReviews.tsx` (skeleton)

- [ ] **Step 1: Extend `ModuleId` + nav item**

`ModuleRail.tsx:30`:
```ts
export type ModuleId = 'dashboard' | 'instances' | 'billing' | 'reviews' | 'settings';
```
Add to `ITEMS` (import `RateReviewIcon from '@mui/icons-material/RateReview'`):
```tsx
{ id: 'reviews', label: 'Reviews', icon: <RateReviewIcon fontSize="small" />, enabled: true },
```

- [ ] **Step 2: Whitelist in `useActiveModule.ts:5`**
```ts
const VALID: ReadonlySet<ModuleId> = new Set(['dashboard', 'instances', 'billing', 'reviews', 'settings']);
```

- [ ] **Step 3: Skeleton component**
```tsx
// apps/desktop/src/components/reviews/ModuleReviews.tsx
import { Box, Typography } from '@mui/material';

export function ModuleReviews(): JSX.Element {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5">Reviews</Typography>
    </Box>
  );
}
```

- [ ] **Step 4: Render in `App.tsx`**

Add `import { ModuleReviews } from './components/reviews/ModuleReviews.js';` and next to the other module conditionals:
```tsx
{activeModule === 'reviews' && <ModuleReviews />}
```

- [ ] **Step 5: Typecheck + run**

Run: `npm run typecheck:ci` (PASS). Then at execution `npm run dev` → confirm the Reviews rail item appears and switches to the skeleton.

- [ ] **Step 6: Commit**
```bash
git add apps/desktop/src/components/ModuleRail.tsx apps/desktop/src/state/useActiveModule.ts apps/desktop/src/App.tsx apps/desktop/src/components/reviews/ModuleReviews.tsx
git commit -m "feat(reviews): register Reviews module shell"
```

---

## Task 9: useReviews hook + pure helpers

**Files:**
- Create: `apps/desktop/src/state/useReviews.ts`
- Test: `tests/client/useReviews.test.ts`

**Interfaces:**
- Consumes: `PullRequestPayload`, `DiffFilePayload` (Task 1); `window.watchtower.invoke`/`on`.
- Produces:
```ts
export type HostFilter = 'all' | 'github' | 'azdo';
export function groupPrsByHost(prs: PullRequestPayload[]): Array<{ host: PrHost; label: string; prs: PullRequestPayload[] }>;
export function sortByUpdatedDesc(prs: PullRequestPayload[]): PullRequestPayload[];
export function applyPrFilter(prs: PullRequestPayload[], host: HostFilter, query: string): PullRequestPayload[];
export function relativeAge(iso: string, nowMs: number): string; // "3h", "1d", "just now"
export function useReviews(): {
  pullRequests: PullRequestPayload[]; syncedAt: string | null;
  loading: boolean; error: string | null;
  refresh(): Promise<void>; loadDiff(pr: PullRequestPayload): Promise<DiffFilePayload[]>;
};
```

- [ ] **Step 1: Write the failing test (pure helpers only)**
```ts
// tests/client/useReviews.test.ts
import { describe, it, expect } from 'vitest';
import { groupPrsByHost, sortByUpdatedDesc, applyPrFilter, relativeAge } from '../../apps/desktop/src/state/useReviews.js';

const pr = (o: Partial<any> = {}) => ({ host: 'github', repoKey: 'gh:o/r', repoLabel: 'r', number: 1,
  title: 'Add widget', author: 'jan', sourceBranch: 'b', targetBranch: 'main', url: 'u',
  updatedAt: '2026-07-10T10:00:00Z', reviewable: true, ...o });

describe('useReviews helpers', () => {
  it('groups by host with labels, github first', () => {
    const g = groupPrsByHost([pr(), pr({ host: 'azdo', repoKey: 'azdo:P/r' })]);
    expect(g.map((x) => x.host)).toEqual(['github', 'azdo']);
  });
  it('sorts by updatedAt desc', () => {
    const s = sortByUpdatedDesc([pr({ updatedAt: '2026-07-01T00:00:00Z', number: 1 }), pr({ updatedAt: '2026-07-09T00:00:00Z', number: 2 })]);
    expect(s[0].number).toBe(2);
  });
  it('filters by host and case-insensitive query on title/repo', () => {
    const list = [pr({ number: 1, title: 'Add widget' }), pr({ number: 2, title: 'Fix bug', host: 'azdo', repoKey: 'azdo:P/r' })];
    expect(applyPrFilter(list, 'github', '').map((p) => p.number)).toEqual([1]);
    expect(applyPrFilter(list, 'all', 'WIDGET').map((p) => p.number)).toEqual([1]);
  });
  it('relativeAge renders coarse buckets', () => {
    const now = Date.parse('2026-07-10T12:00:00Z');
    expect(relativeAge('2026-07-10T09:00:00Z', now)).toBe('3h');
    expect(relativeAge('2026-07-08T12:00:00Z', now)).toBe('2d');
    expect(relativeAge('2026-07-10T11:59:30Z', now)).toBe('just now');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/useReviews.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**
```ts
// apps/desktop/src/state/useReviews.ts
import { useCallback, useEffect, useState } from 'react';
import type { PullRequestPayload, DiffFilePayload, PrHost } from '@watchtower/shared/ipcContract.js';

export type HostFilter = 'all' | 'github' | 'azdo';
const HOST_LABEL: Record<PrHost, string> = { github: 'GitHub', azdo: 'Azure DevOps · Škoda' };

export function sortByUpdatedDesc(prs: PullRequestPayload[]): PullRequestPayload[] {
  return [...prs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
export function groupPrsByHost(prs: PullRequestPayload[]) {
  const order: PrHost[] = ['github', 'azdo'];
  return order.map((host) => ({ host, label: HOST_LABEL[host],
    prs: sortByUpdatedDesc(prs.filter((p) => p.host === host)) })).filter((g) => g.prs.length > 0);
}
export function applyPrFilter(prs: PullRequestPayload[], host: HostFilter, query: string): PullRequestPayload[] {
  const q = query.trim().toLowerCase();
  return prs.filter((p) => (host === 'all' || p.host === host)
    && (q === '' || p.title.toLowerCase().includes(q) || p.repoLabel.toLowerCase().includes(q)
      || String(p.number).includes(q)));
}
export function relativeAge(iso: string, nowMs: number): string {
  const diff = nowMs - Date.parse(iso);
  if (diff < 60_000) return 'just now';
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.floor(diff / 60_000)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function useReviews() {
  const [pullRequests, setPullRequests] = useState<PullRequestPayload[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (kind: 'prs:list' | 'prs:refresh') => {
    setLoading(true); setError(null);
    try {
      const res = await window.watchtower.invoke(kind, {});
      setPullRequests(res.pullRequests); setSyncedAt(res.syncedAt);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load('prs:list').then(() => { /* auto-refresh on first open */ }); }, [load]);

  const refresh = useCallback(() => load('prs:refresh'), [load]);
  const loadDiff = useCallback(async (pr: PullRequestPayload): Promise<DiffFilePayload[]> => {
    const res = await window.watchtower.invoke('prs:diff', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.files;
  }, []);

  return { pullRequests, syncedAt, loading, error, refresh, loadDiff };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/useReviews.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add apps/desktop/src/state/useReviews.ts tests/client/useReviews.test.ts
git commit -m "feat(reviews): useReviews hook + pure list helpers"
```

---

## Task 10: PR list UI

**Files:**
- Modify: `apps/desktop/src/components/reviews/ModuleReviews.tsx`
- Create: `apps/desktop/src/components/reviews/PrRow.tsx`

**Interfaces:**
- Consumes: `useReviews`, `groupPrsByHost`, `applyPrFilter`, `relativeAge` (Task 9).

- [ ] **Step 1: `PrRow.tsx`** (Box-grid row, theme tokens, host badge, age)
```tsx
// apps/desktop/src/components/reviews/PrRow.tsx
import { Box, Typography, Chip } from '@mui/material';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';
import { relativeAge } from '../../state/useReviews.js';

export function PrRow({ pr, nowMs, onOpen }: { pr: PullRequestPayload; nowMs: number; onOpen(pr: PullRequestPayload): void }): JSX.Element {
  const num = pr.host === 'github' ? `#${pr.number}` : `!${pr.number}`;
  return (
    <Box onClick={() => onOpen(pr)}
      sx={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 90px auto', gap: 1.5, alignItems: 'center',
        px: 1.25, py: 1, borderRadius: 1, cursor: 'pointer',
        '&:hover': { backgroundColor: 'action.hover' } }}>
      <Chip size="small" label={pr.host === 'github' ? 'GH' : 'AZ'}
        sx={{ fontWeight: 700, fontSize: 10, bgcolor: pr.host === 'github' ? 'action.selected' : 'primary.main',
          color: pr.host === 'github' ? 'text.primary' : 'primary.contrastText' }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 13 }}>
          <Box component="span" sx={{ color: 'text.secondary', mr: 0.75, fontVariantNumeric: 'tabular-nums' }}>{num}</Box>
          {pr.title}
        </Typography>
        <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary' }}>
          {pr.repoLabel} · {pr.author} · {pr.sourceBranch}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'right' }}>{relativeAge(pr.updatedAt, nowMs)}</Typography>
      <Typography sx={{ fontSize: 11, color: 'primary.main', textAlign: 'right' }}>{pr.reviewable ? 'Open ▸' : 'Diff ▸'}</Typography>
    </Box>
  );
}
```

- [ ] **Step 2: `ModuleReviews.tsx`** (header, filter chips, search, host groups, error Alert, empty/loading, Connect-DevOps entry)
```tsx
// apps/desktop/src/components/reviews/ModuleReviews.tsx
import { useMemo, useState } from 'react';
import { Box, Typography, Alert, Chip, TextField, Button, Stack, CircularProgress } from '@mui/material';
import { useReviews, applyPrFilter, groupPrsByHost, type HostFilter } from '../../state/useReviews.js';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';
import { PrRow } from './PrRow.js';
import { PrInspectorDrawer } from './PrInspectorDrawer.js';
import { ConnectDevopsDrawer } from './ConnectDevopsDrawer.js';

export function ModuleReviews(): JSX.Element {
  const { pullRequests, syncedAt, loading, error, refresh, loadDiff } = useReviews();
  const [host, setHost] = useState<HostFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PullRequestPayload | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const nowMs = Date.now();
  const groups = useMemo(() => groupPrsByHost(applyPrFilter(pullRequests, host, query)), [pullRequests, host, query]);

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Typography variant="h5">Reviews</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {pullRequests.length} open{syncedAt ? ` · synced ${new Date(syncedAt).toLocaleTimeString('cs-CZ')}` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={() => setCfgOpen(true)}>Azure DevOps…</Button>
        <Button size="small" variant="outlined" disabled={loading} onClick={() => void refresh()}>↻ Obnovit</Button>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} alignItems="center">
        {(['all', 'github', 'azdo'] as HostFilter[]).map((h) => (
          <Chip key={h} size="small" label={h === 'all' ? 'Vše' : h === 'github' ? 'GitHub' : 'Azure DevOps'}
            color={host === h ? 'primary' : 'default'} variant={host === h ? 'filled' : 'outlined'}
            onClick={() => setHost(h)} />
        ))}
        <Box sx={{ flex: 1 }} />
        <TextField size="small" placeholder="Hledat PR…" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ width: 220 }} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {loading && pullRequests.length === 0 && <CircularProgress size={20} />}
      {!loading && pullRequests.length === 0 && !error && (
        <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>Žádné otevřené PR. Zkuste Obnovit nebo připojit Azure DevOps.</Typography>
      )}

      {groups.map((g) => (
        <Box key={g.host} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>{g.label}</Typography>
          <Stack spacing={0.25}>{g.prs.map((pr) => <PrRow key={pr.repoKey + pr.number} pr={pr} nowMs={nowMs} onOpen={setOpen} />)}</Stack>
        </Box>
      ))}

      <PrInspectorDrawer pr={open} onClose={() => setOpen(null)} loadDiff={loadDiff} />
      <ConnectDevopsDrawer open={cfgOpen} onClose={() => setCfgOpen(false)} onSaved={() => void refresh()} />
    </Box>
  );
}
```
(`PrInspectorDrawer`/`ConnectDevopsDrawer` are created in Tasks 11–12; add the imports now and stub the two files as empty default-closed drawers so this compiles, then flesh out. To keep the task independently testable, create minimal stubs of both in this task.)

- [ ] **Step 3: Minimal stubs so it compiles**

Create `PrInspectorDrawer.tsx` and `ConnectDevopsDrawer.tsx` as `Drawer anchor="right" open={...}` returning an empty box; real bodies land in Tasks 11–12.

- [ ] **Step 4: Typecheck + run**

Run: `npm run typecheck:ci` (PASS). At execution `npm run dev`: confirm GitHub PRs list (requires `gh` logged in + at least one project with a GitHub remote), filter chips + search work, refresh works, error Alert shows if `gh` is missing.

- [ ] **Step 5: Commit**
```bash
git add apps/desktop/src/components/reviews/ModuleReviews.tsx apps/desktop/src/components/reviews/PrRow.tsx apps/desktop/src/components/reviews/PrInspectorDrawer.tsx apps/desktop/src/components/reviews/ConnectDevopsDrawer.tsx
git commit -m "feat(reviews): PR list UI (host groups, filter, search, refresh)"
```

---

## Task 11: Connect Azure DevOps drawer

**Files:**
- Modify: `apps/desktop/src/components/reviews/ConnectDevopsDrawer.tsx`

**Interfaces:**
- Consumes: `reviews:getDevopsConfig`, `reviews:setDevopsConfig`, `devops:setPat`, `devops:hasPat`.

- [ ] **Step 1: Implement the drawer**
```tsx
// apps/desktop/src/components/reviews/ConnectDevopsDrawer.tsx
import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, TextField, Button, Stack, Alert, Chip } from '@mui/material';
import type { DevopsRepoConfigPayload } from '@watchtower/shared/ipcContract.js';

export function ConnectDevopsDrawer({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved(): void }): JSX.Element {
  const [orgBaseUrl, setOrgBaseUrl] = useState('');
  const [reposText, setReposText] = useState(''); // "PPS/technology" per line
  const [pat, setPat] = useState('');
  const [hasPat, setHasPat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setPat('');
    void (async () => {
      const cfg = await window.watchtower.invoke('reviews:getDevopsConfig', {});
      setOrgBaseUrl(cfg.orgBaseUrl);
      setReposText(cfg.repos.map((r) => `${r.project}/${r.repo}`).join('\n'));
      setHasPat(cfg.hasPat);
    })();
  }, [open]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const repos: DevopsRepoConfigPayload[] = reposText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [project, repo] = l.split('/');
        return { orgBaseUrl, project, repo };
      });
      await window.watchtower.invoke('reviews:setDevopsConfig', { orgBaseUrl, repos });
      if (pat.trim()) await window.watchtower.invoke('devops:setPat', { pat: pat.trim() });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 460 } }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Připojit Azure DevOps</Typography>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        <Stack spacing={2}>
          <TextField label="Collection / org URL" value={orgBaseUrl} onChange={(e) => setOrgBaseUrl(e.target.value)}
            placeholder="https://devops.skoda/tfs/DefaultCollection" fullWidth size="small" />
          <TextField label="Repozitáře (project/repo na řádek)" value={reposText} onChange={(e) => setReposText(e.target.value)}
            placeholder={'PPS/technology\nSpot/spot'} fullWidth multiline minRows={3} size="small" />
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
              Personal Access Token {hasPat && <Chip size="small" label="uloženo" color="success" sx={{ ml: 1 }} />}
            </Typography>
            <TextField type="password" value={pat} onChange={(e) => setPat(e.target.value)}
              placeholder={hasPat ? '•••••• (ponechat beze změny)' : 'vložit PAT'} fullWidth size="small" />
          </Box>
          <Button variant="contained" disabled={saving} onClick={() => void save()}>Uložit</Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
```

- [ ] **Step 2: Typecheck + smoke**

Run: `npm run typecheck:ci` (PASS). At execution: open the drawer, save org URL + `PPS/technology` + a PAT, confirm `devops:hasPat` flips to true and Refresh now includes DevOps PRs.

- [ ] **Step 3: Commit**
```bash
git add apps/desktop/src/components/reviews/ConnectDevopsDrawer.tsx
git commit -m "feat(reviews): Connect Azure DevOps drawer (PAT + repos)"
```

---

## Task 12: PR inspector drawer + Diff tab + diff view

**Files:**
- Modify: `apps/desktop/src/components/reviews/PrInspectorDrawer.tsx`
- Create: `apps/desktop/src/components/reviews/DiffView.tsx`

**Interfaces:**
- Consumes: `loadDiff` from `useReviews`; `DiffFilePayload` (Task 1).

- [ ] **Step 1: `DiffView.tsx`** (file tree + hand-rolled unified diff)
```tsx
// apps/desktop/src/components/reviews/DiffView.tsx
import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import type { DiffFilePayload } from '@watchtower/shared/ipcContract.js';

export function DiffView({ files }: { files: DiffFilePayload[] }): JSX.Element {
  const [active, setActive] = useState(0);
  if (files.length === 0) return <Typography sx={{ p: 2, color: 'text.secondary', fontSize: 13 }}>Žádné změny k zobrazení.</Typography>;
  const file = files[Math.min(active, files.length - 1)];
  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Box sx={{ width: 176, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflow: 'auto', py: 1 }}>
        <Typography sx={{ px: 1.5, py: 0.5, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
          {files.length} souborů
        </Typography>
        {files.map((f, i) => (
          <Box key={f.path} onClick={() => setActive(i)}
            sx={{ px: 1.5, py: 0.5, fontSize: 11, cursor: 'pointer', display: 'flex', gap: 0.75,
              bgcolor: i === active ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
            <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path.split('/').pop()}</Box>
            <Box component="span" sx={{ color: 'success.main', fontSize: 10 }}>+{f.additions}</Box>
            <Box component="span" sx={{ color: 'error.main', fontSize: 10 }}>−{f.deletions}</Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>
        <Typography sx={{ position: 'sticky', top: 0, px: 1.5, py: 1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', fontFamily: 'inherit', fontSize: 11 }}>{file.path}</Typography>
        {file.lines.map((l, i) => (
          <Box key={i} sx={{ display: 'flex', px: 1.5, lineHeight: 1.6,
            bgcolor: l.kind === 'add' ? 'success.main' : l.kind === 'del' ? 'error.main' : l.kind === 'hunk' ? 'action.hover' : 'transparent',
            ...(l.kind === 'add' || l.kind === 'del' ? { bgcolor: (t) => `${t.palette[l.kind === 'add' ? 'success' : 'error'].main}22` } : {}) }}>
            <Box component="span" sx={{ width: 40, color: 'text.secondary', textAlign: 'right', pr: 1.5, userSelect: 'none', flexShrink: 0 }}>{l.newNo ?? l.oldNo ?? ''}</Box>
            <Box component="span" sx={{ whiteSpace: 'pre', color: l.kind === 'hunk' ? 'primary.main' : 'text.primary' }}>{l.text}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: `PrInspectorDrawer.tsx`** (header + Diff/Report tabs; Report tab shows "no review yet" in SP1)
```tsx
// apps/desktop/src/components/reviews/PrInspectorDrawer.tsx
import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, Tabs, Tab, Alert, CircularProgress } from '@mui/material';
import type { PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';
import { DiffView } from './DiffView.js';

export function PrInspectorDrawer({ pr, onClose, loadDiff }: {
  pr: PullRequestPayload | null; onClose(): void;
  loadDiff(pr: PullRequestPayload): Promise<DiffFilePayload[]>;
}): JSX.Element {
  const [tab, setTab] = useState(0);
  const [files, setFiles] = useState<DiffFilePayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pr) return;
    setTab(0); setFiles([]); setError(null); setLoading(true);
    void loadDiff(pr).then(setFiles).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  }, [pr, loadDiff]);

  return (
    <Drawer anchor="right" open={pr != null} onClose={onClose} PaperProps={{ sx: { width: 620, display: 'flex', flexDirection: 'column' } }}>
      {pr && (
        <>
          <Box sx={{ p: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              {(pr.host === 'github' ? '#' : '!') + pr.number} · {pr.title}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
              {pr.repoLabel} · {pr.sourceBranch} → {pr.targetBranch} · {pr.author}
            </Typography>
          </Box>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 1, minHeight: 40 }}>
            <Tab label={`Diff${files.length ? ` (${files.length})` : ''}`} sx={{ minHeight: 40 }} />
            <Tab label="Report" sx={{ minHeight: 40 }} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {tab === 0 && (
              <>
                {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
                {loading && <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>}
                {!loading && !error && <DiffView files={files} />}
              </>
            )}
            {tab === 1 && (
              <Typography sx={{ p: 2, color: 'text.secondary', fontSize: 13 }}>
                Zatím bez recenze. Spuštění review agenta přijde v dalším kroku (SP2).
              </Typography>
            )}
          </Box>
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 3: Typecheck + full suite + smoke**

Run: `npm run typecheck:ci` (PASS), `npm test` (PASS, all green). At execution `npm run dev`: open a GitHub PR → Diff tab renders the file tree + unified diff; Report tab shows the SP2 placeholder; a DevOps PR shows the file-list placeholder diff.

- [ ] **Step 4: Commit**
```bash
git add apps/desktop/src/components/reviews/PrInspectorDrawer.tsx apps/desktop/src/components/reviews/DiffView.tsx
git commit -m "feat(reviews): PR inspector drawer + Diff tab"
```

---

## Self-review (completed by plan author)

**Spec coverage:** SP1 scope from the design (§7 Sub-project 1) — both provider adapters (T3/T4), normalized model (T1), repo config resolution (T5), `prs:list`/`prs:refresh`/`prs:diff` IPC (T1/T6), DevOps PAT via `safeStorage` (T7), Reviews sidebar + list UI (T8/T10), filter/search/refresh (T10), and the Diff tab (T12). Config editing (§8 `reviews.repos`) → T5 + T11. Graceful host-degradation + error Alert (§9) → T5 (`try/catch` per repo) + T10. Testing (§10) → T2/T3/T4/T5/T9. **Gaps intentionally deferred:** full-fidelity DevOps line-level diffs (spec §12 follow-up; T4 ships a stable file-list placeholder and says so); `pr_reviews` table + migration v20 (SP2, not SP1).

**Placeholder scan:** No "TBD/TODO" left as work items; the one placeholder (DevOps diff bodies) is a deliberate, documented scope boundary with a stable interface, not an unfinished step.

**Type consistency:** `PullRequestPayload`/`DiffFilePayload`/`DevopsRepoConfigPayload` defined in T1 and used verbatim in T3–T12. `Exec`/`HttpGet`/`GithubRepoConfig`/`AzdoRepoConfig` defined in T3/T4 `types.ts`. Hook helper names (`groupPrsByHost`, `applyPrFilter`, `sortByUpdatedDesc`, `relativeAge`) defined in T9 and consumed in T10. IPC kind strings match between T1 (contract), T6 (orchestrator), T7 (electron injection), and T9/T11 (renderer).
