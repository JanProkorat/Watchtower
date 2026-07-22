import { execFile } from 'node:child_process';
import type { SqliteLike } from '../db/migrations.js';
import type { PrHost, PullRequestPayload, DiffFilePayload, PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';
import type { GithubRepoConfig, AzdoRepoConfig, Exec } from './prProviders/types.js';
import {
  listGithubPrs, fetchGithubDiff, fetchGithubComments, parseGitRemoteNwo, githubReviewState, approveGithubPr, closeGithubPr,
  fetchGithubPrState,
  type GithubReviewState,
} from './prProviders/github.js';
import {
  listAzdoPrs, fetchAzdoDiff, fetchAzdoComments, fetchAzdoPrDetail, parseAzureRemote, fetchAzdoReviewState, approveAzdoPr, abandonAzdoPr,
  fetchAzdoPrState,
  type AzdoReviewState,
} from './prProviders/azureDevops.js';
import { defaultExec } from './prProviders/exec.js';
import { resolveGithubLogin, resolveAzdoUser } from './prWatch/identity.js';
import { detectListChange, prKey } from './reviews/detectMerged.js';

/** Same shape from both providers — what the `prs:reviewState` IPC returns. */
export type ReviewStatePayload = GithubReviewState | AzdoReviewState;

export interface ReviewsDeps {
  db: SqliteLike;
  listGithub?: (repo: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  listAzdo?: (repo: AzdoRepoConfig, pat: string, userId: string) => Promise<PullRequestPayload[]>;
  azdoPrDetail?: (repo: AzdoRepoConfig, prNumber: number, pat: string) => Promise<{ lastMergeSourceCommitId: string }>;
  gitRemote?: (cwd: string) => Promise<string | null>;
  projects?: () => Array<{ id: number; name: string; folder_path: string | null }>;
  exec?: Exec;
  githubReviewState?: (repo: GithubRepoConfig, prNumber: number, login: string) => Promise<GithubReviewState>;
  approveGithubPr?: (nwo: string, prNumber: number) => Promise<void>;
  azdoReviewState?: (repo: AzdoRepoConfig, prNumber: number, pat: string, myId: string) => Promise<AzdoReviewState>;
  approveAzdoPr?: (apiBase: string, repo: string, prNumber: number, myId: string, pat: string) => Promise<void>;
  closeGithubPr?: (nwo: string, prNumber: number) => Promise<void>;
  abandonAzdoPr?: (apiBase: string, repo: string, prNumber: number, pat: string) => Promise<void>;
  resolveGithubLogin?: () => Promise<string>;
  resolveAzdoUser?: (apiBase: string, pat: string) => Promise<{ id: string; displayName: string }>;
  githubPrState?: (nwo: string, prNumber: number) => Promise<{ merged: boolean }>;
  azdoPrState?: (repo: AzdoRepoConfig, prNumber: number, pat: string) => Promise<{ merged: boolean }>;
}

/** Everything mergeAzdoPr needs, resolved from the repo config + a fresh PR GET. */
export interface AzdoMergeTarget {
  apiBase: string;
  repo: string;
  devopsHost: string;
  lastMergeSourceCommitId: string;
}

const realGitRemote = (cwd: string) => new Promise<string | null>((resolve) => {
  execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5_000 }, (err, out) => resolve(err ? null : out.trim()));
});

/** Resolved target for the review runner: a local clone + the src/tgt refs fetched into it. */
export interface ResolvedReviewTarget {
  clonePath: string;
  baseRef: string;
  headSha: string;
  pr: { title: string; sourceBranch: string; targetBranch: string };
}

export class ReviewsService {
  private cache: PullRequestPayload[] = [];
  private syncedAt: string | null = null;
  /** Per-repo errors from the last refresh that did NOT abort the whole list
   *  (e.g. one DevOps repo failed while GitHub repos succeeded). Surfaced to the
   *  UI so a partial failure is visible instead of silently swallowed. */
  private warnings: string[] = [];
  private listGithub: (r: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  private listAzdo: (r: AzdoRepoConfig, pat: string, userId: string) => Promise<PullRequestPayload[]>;
  private azdoPrDetail: (r: AzdoRepoConfig, prNumber: number, pat: string) => Promise<{ lastMergeSourceCommitId: string }>;
  private gitRemote: (cwd: string) => Promise<string | null>;
  private projectsFn: () => Array<{ id: number; name: string; folder_path: string | null }>;
  private exec: Exec;
  private githubReviewStateFn: (repo: GithubRepoConfig, prNumber: number, login: string) => Promise<GithubReviewState>;
  private approveGithubPrFn: (nwo: string, prNumber: number) => Promise<void>;
  private azdoReviewStateFn: (repo: AzdoRepoConfig, prNumber: number, pat: string, myId: string) => Promise<AzdoReviewState>;
  private approveAzdoPrFn: (apiBase: string, repo: string, prNumber: number, myId: string, pat: string) => Promise<void>;
  private closeGithubPrFn: (nwo: string, prNumber: number) => Promise<void>;
  private abandonAzdoPrFn: (apiBase: string, repo: string, prNumber: number, pat: string) => Promise<void>;
  private resolveGithubLoginFn: () => Promise<string>;
  private resolveAzdoUserFn: (apiBase: string, pat: string) => Promise<{ id: string; displayName: string }>;
  private githubPrStateFn: (nwo: string, prNumber: number) => Promise<{ merged: boolean }>;
  private azdoPrStateFn: (repo: AzdoRepoConfig, prNumber: number, pat: string) => Promise<{ merged: boolean }>;
  /** Memoized per apiBase — `Task 2` (ADO list filter) reuses this cache via `azdoUser()`. */
  private azdoUserCache = new Map<string, { id: string; displayName: string }>();

  constructor(deps: ReviewsDeps) {
    this.listGithub = deps.listGithub ?? ((r) => listGithubPrs(r));
    this.listAzdo = deps.listAzdo ?? ((r, pat, userId) => listAzdoPrs(r, pat, userId));
    this.azdoPrDetail = deps.azdoPrDetail ?? ((r, prNumber, pat) => fetchAzdoPrDetail(r, prNumber, pat));
    this.gitRemote = deps.gitRemote ?? realGitRemote;
    this.projectsFn = deps.projects ?? (() => []);
    this.exec = deps.exec ?? defaultExec;
    this.githubReviewStateFn = deps.githubReviewState ?? ((r, n, login) => githubReviewState(r, n, login));
    this.approveGithubPrFn = deps.approveGithubPr ?? ((nwo, n) => approveGithubPr(nwo, n));
    this.azdoReviewStateFn = deps.azdoReviewState ?? ((r, n, pat, myId) => fetchAzdoReviewState(r, n, pat, myId));
    this.approveAzdoPrFn = deps.approveAzdoPr ?? ((apiBase, repo, n, myId, pat) => approveAzdoPr(apiBase, repo, n, myId, pat));
    this.closeGithubPrFn = deps.closeGithubPr ?? ((nwo, n) => closeGithubPr(nwo, n));
    this.abandonAzdoPrFn = deps.abandonAzdoPr ?? ((apiBase, repo, n, pat) => abandonAzdoPr(apiBase, repo, n, pat));
    this.resolveGithubLoginFn = deps.resolveGithubLogin ?? (() => resolveGithubLogin());
    this.resolveAzdoUserFn = deps.resolveAzdoUser ?? ((apiBase, pat) => resolveAzdoUser(apiBase, pat));
    this.githubPrStateFn = deps.githubPrState ?? ((nwo, n) => fetchGithubPrState(nwo, n));
    this.azdoPrStateFn = deps.azdoPrState ?? ((r, n, pat) => fetchAzdoPrState(r, n, pat));
  }

  /** Memoized ADO user-id resolver, cached per apiBase (an org can host multiple repos). */
  private async azdoUser(apiBase: string, pat: string): Promise<{ id: string; displayName: string }> {
    const cached = this.azdoUserCache.get(apiBase);
    if (cached) return cached;
    const user = await this.resolveAzdoUserFn(apiBase, pat);
    this.azdoUserCache.set(apiBase, user);
    return user;
  }

  async resolveRepos(): Promise<{ github: GithubRepoConfig[]; azdo: AzdoRepoConfig[] }> {
    const github: GithubRepoConfig[] = [];
    const azdo: AzdoRepoConfig[] = [];
    for (const p of this.projectsFn()) {
      if (!p.folder_path) continue;
      const remote = await this.gitRemote(p.folder_path);
      if (!remote) continue;
      const nwo = parseGitRemoteNwo(remote);
      if (nwo) {
        github.push({ host: 'github', repoKey: `gh:${nwo}`, repoLabel: p.name, nwo, localClonePath: p.folder_path });
        continue;
      }
      const azure = parseAzureRemote(remote);
      if (azure) {
        azdo.push({
          host: 'azdo',
          repoKey: `azdo:${azure.devopsHost}/${azure.repo}`,
          repoLabel: p.name,
          devopsHost: azure.devopsHost,
          apiBase: azure.apiBase,
          repo: azure.repo,
          localClonePath: p.folder_path,
        });
      }
    }
    return { github, azdo };
  }

  list() { return { pullRequests: this.cache, syncedAt: this.syncedAt, warnings: this.warnings }; }

  /**
   * Fetches the current open-PR set across every resolved repo, tolerating
   * per-repo failures (collected as `errors`). `succeededRepoKeys` records
   * which repos' list call succeeded this cycle — `backgroundRefresh` uses it
   * to distinguish "PR merged/closed" from "repo transiently failed to fetch"
   * when a PR drops out of the open set.
   */
  private async fetchOpenSet(devopsPats: Record<string, string> | undefined): Promise<{
    results: PullRequestPayload[]; errors: string[]; succeededRepoKeys: Set<string>;
  }> {
    const results: PullRequestPayload[] = [];
    const errors: string[] = [];
    const succeededRepoKeys = new Set<string>();
    const { github, azdo } = await this.resolveRepos();
    for (const r of github) {
      try { results.push(...(await this.listGithub(r))); succeededRepoKeys.add(r.repoKey); }
      catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    for (const r of azdo) {
      const pat = devopsPats?.[r.devopsHost];
      if (!pat) { errors.push(`${r.repoLabel}: Azure DevOps PAT not set or unreadable — re-enter it in Reviews settings`); continue; }
      try {
        const user = await this.azdoUser(r.apiBase, pat);
        results.push(...(await this.listAzdo(r, pat, user.id)));
        succeededRepoKeys.add(r.repoKey);
      } catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return { results, errors, succeededRepoKeys };
  }

  async refresh(devopsPats: Record<string, string> | undefined) {
    const { results, errors } = await this.fetchOpenSet(devopsPats);
    this.cache = results;
    this.syncedAt = isoNow();
    // A total failure (nothing to show) is a hard error; a partial failure keeps
    // the good results but exposes the rest as warnings rather than dropping them.
    if (results.length === 0 && errors.length > 0) {
      this.warnings = [];
      throw new Error(`Failed to load PRs:\n${errors.join('\n')}`);
    }
    this.warnings = errors;
    return this.list();
  }

  /** Resolves whether a PR that dropped off the open list was merged (vs closed). */
  private async classifyMerged(pr: PullRequestPayload, devopsPats: Record<string, string> | undefined): Promise<boolean> {
    const { github, azdo } = await this.resolveRepos();
    if (pr.host === 'github') {
      const repo = github.find((r) => r.repoKey === pr.repoKey);
      if (!repo) return false;
      return (await this.githubPrStateFn(repo.nwo, pr.number)).merged;
    }
    const repo = azdo.find((r) => r.repoKey === pr.repoKey);
    const pat = repo ? devopsPats?.[repo.devopsHost] : undefined;
    if (!repo || !pat) return false;
    return (await this.azdoPrStateFn(repo, pr.number, pat)).merged;
  }

  /**
   * Silent poll cycle for the PR-watch tick: refetches the open set, diffs it
   * against the cache to find PRs that disappeared (via `detectListChange`),
   * classifies each as merged/closed, and fires `hooks.notifyMerged` for the
   * merged ones. Always updates the cache (merged/closed PRs removed) and
   * calls `hooks.onListChanged()` — except on a total fetch failure, where the
   * list is left untouched and nothing is classified.
   */
  async backgroundRefresh(
    devopsPats: Record<string, string> | undefined,
    hooks: { notifyMerged(pr: PullRequestPayload): void; onListChanged(): void },
  ): Promise<void> {
    const prev = this.cache;
    const { results, errors, succeededRepoKeys } = await this.fetchOpenSet(devopsPats);
    // Total failure (nothing fetched, all errored) → leave the list untouched, notify nothing.
    if (results.length === 0 && errors.length > 0 && succeededRepoKeys.size === 0) return;
    const { nextCache, candidates } = detectListChange(prev, results, succeededRepoKeys);
    for (const pr of candidates) {
      try {
        if (await this.classifyMerged(pr, devopsPats)) hooks.notifyMerged(pr);
      } catch (e) {
        // Classification failed (transient) — the PR is still removed from the list
        // (it left the open set of a succeeded repo); we simply skip the notification.
        console.error('[reviews] classifyMerged failed', prKey(pr), e);
      }
    }
    this.cache = nextCache;
    this.syncedAt = isoNow();
    this.warnings = errors;
    hooks.onListChanged();
  }

  async diff(host: PrHost, repoKey: string, prNumber: number, _devopsPats: Record<string, string> | undefined): Promise<DiffFilePayload[]> {
    const { github, azdo } = await this.resolveRepos();
    if (host === 'github') {
      const repo = github.find((r) => r.repoKey === repoKey);
      return repo ? fetchGithubDiff(repo, prNumber) : [];
    }
    const repo = azdo.find((r) => r.repoKey === repoKey);
    if (!repo) return [];
    const pr = this.cache.find((p) => p.host === 'azdo' && p.repoKey === repoKey && p.number === prNumber);
    if (!pr) return [];
    return fetchAzdoDiff(repo, pr.sourceBranch, pr.targetBranch);
  }

  async comments(host: PrHost, repoKey: string, prNumber: number, devopsPats: Record<string, string> | undefined): Promise<PrCommentThreadPayload[]> {
    const { github, azdo } = await this.resolveRepos();
    if (host === 'github') {
      const repo = github.find((r) => r.repoKey === repoKey);
      return repo ? fetchGithubComments(repo, prNumber) : [];
    }
    const repo = azdo.find((r) => r.repoKey === repoKey);
    const pat = repo ? devopsPats?.[repo.devopsHost] : undefined;
    return repo && pat ? fetchAzdoComments(repo, prNumber, pat) : [];
  }

  /**
   * Resolve a (host, repoKey, prNumber) into everything the review runner needs:
   * the local clone path, the fetched base ref, and the head sha to check out.
   * Fetches both the PR's source and target branches from `origin` into a
   * private ref namespace (`refs/wt-review/{src,tgt}`) — same mechanism the
   * azdo diff fetch already uses, generalized to also cover github (whose
   * branches live on `origin` too since `localClonePath` is the user's own
   * clone). Returns null if the repo, the PR, or the local clone is missing,
   * or if the git fetch/rev-parse fails.
   */
  async resolveRepoAndPr(host: PrHost, repoKey: string, prNumber: number): Promise<ResolvedReviewTarget | null> {
    const { github, azdo } = await this.resolveRepos();
    const repo = host === 'github'
      ? github.find((r) => r.repoKey === repoKey)
      : azdo.find((r) => r.repoKey === repoKey);
    if (!repo || !repo.localClonePath) return null;
    const pr = this.cache.find((p) => p.host === host && p.repoKey === repoKey && p.number === prNumber);
    if (!pr || !pr.sourceBranch || !pr.targetBranch) return null;
    const clonePath = repo.localClonePath;
    try {
      await this.exec('git', ['-C', clonePath, 'fetch', '--no-tags', '--force', 'origin',
        `+${pr.sourceBranch}:refs/wt-review/src`, `+${pr.targetBranch}:refs/wt-review/tgt`]);
      const headSha = (await this.exec('git', ['-C', clonePath, 'rev-parse', 'refs/wt-review/src'])).trim();
      return {
        clonePath,
        baseRef: 'refs/wt-review/tgt',
        headSha,
        pr: { title: pr.title, sourceBranch: pr.sourceBranch, targetBranch: pr.targetBranch },
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve everything `mergeAzdoPr` needs to complete a DevOps PR: the repo's
   * apiBase/repo/devopsHost (from the resolved config) plus a *fresh*
   * `lastMergeSourceCommit.commitId` (Azure rejects a completion PATCH whose
   * source commit is stale). Looks up the PAT by the resolved devopsHost and
   * throws a clear error if one isn't provided.
   */
  async azdoMergeTarget(repoKey: string, prNumber: number, devopsPats: Record<string, string> | undefined): Promise<AzdoMergeTarget> {
    const { azdo } = await this.resolveRepos();
    const repo = azdo.find((r) => r.repoKey === repoKey);
    if (!repo) throw new Error(`Cannot resolve DevOps repo for ${repoKey}`);
    const pat = devopsPats?.[repo.devopsHost];
    if (!pat) throw new Error(`Missing DevOps PAT for ${repo.devopsHost}`);
    const { lastMergeSourceCommitId } = await this.azdoPrDetail(repo, prNumber, pat);
    return { apiBase: repo.apiBase, repo: repo.repo, devopsHost: repo.devopsHost, lastMergeSourceCommitId };
  }

  /** Live approval/merge state for the Reviews drawer's "reviewState" IPC. */
  async reviewState(
    host: PrHost, repoKey: string, prNumber: number, devopsPats: Record<string, string> | undefined,
  ): Promise<ReviewStatePayload> {
    const { github, azdo } = await this.resolveRepos();
    if (host === 'github') {
      const repo = github.find((r) => r.repoKey === repoKey);
      if (!repo) throw new Error(`Cannot resolve GitHub repo for ${repoKey}`);
      const login = await this.resolveGithubLoginFn();
      return this.githubReviewStateFn(repo, prNumber, login);
    }
    const repo = azdo.find((r) => r.repoKey === repoKey);
    if (!repo) throw new Error(`Cannot resolve DevOps repo for ${repoKey}`);
    const pat = devopsPats?.[repo.devopsHost];
    if (!pat) throw new Error(`Missing DevOps PAT for ${repo.devopsHost}`);
    const user = await this.azdoUser(repo.apiBase, pat);
    return this.azdoReviewStateFn(repo, prNumber, pat, user.id);
  }

  /** Approves a PR (GitHub review approval / DevOps vote:10). */
  async approve(
    host: PrHost, repoKey: string, prNumber: number, devopsPats: Record<string, string> | undefined,
  ): Promise<{ ok: true }> {
    const { github, azdo } = await this.resolveRepos();
    if (host === 'github') {
      const repo = github.find((r) => r.repoKey === repoKey);
      if (!repo) throw new Error(`Cannot resolve GitHub repo for ${repoKey}`);
      await this.approveGithubPrFn(repo.nwo, prNumber);
      return { ok: true };
    }
    const repo = azdo.find((r) => r.repoKey === repoKey);
    if (!repo) throw new Error(`Cannot resolve DevOps repo for ${repoKey}`);
    const pat = devopsPats?.[repo.devopsHost];
    if (!pat) throw new Error(`Missing DevOps PAT for ${repo.devopsHost}`);
    const user = await this.azdoUser(repo.apiBase, pat);
    await this.approveAzdoPrFn(repo.apiBase, repo.repo, prNumber, user.id, pat);
    return { ok: true };
  }

  /** Closes a PR without merging (GitHub `gh pr close` / DevOps abandon). */
  async close(
    host: PrHost, repoKey: string, prNumber: number, devopsPats: Record<string, string> | undefined,
  ): Promise<{ ok: true }> {
    const { github, azdo } = await this.resolveRepos();
    if (host === 'github') {
      const repo = github.find((r) => r.repoKey === repoKey);
      if (!repo) throw new Error(`Cannot resolve GitHub repo for ${repoKey}`);
      await this.closeGithubPrFn(repo.nwo, prNumber);
      return { ok: true };
    }
    const repo = azdo.find((r) => r.repoKey === repoKey);
    if (!repo) throw new Error(`Cannot resolve DevOps repo for ${repoKey}`);
    const pat = devopsPats?.[repo.devopsHost];
    if (!pat) throw new Error(`Missing DevOps PAT for ${repo.devopsHost}`);
    await this.abandonAzdoPrFn(repo.apiBase, repo.repo, prNumber, pat);
    return { ok: true };
  }

  async projectRepo(projectId: number): Promise<{ host: 'github' | 'azdo' | null; devopsHost: string | null; repoLabel: string | null }> {
    const p = this.projectsFn().find((proj) => proj.id === projectId);
    if (!p || !p.folder_path) return { host: null, devopsHost: null, repoLabel: null };
    const remote = await this.gitRemote(p.folder_path);
    if (!remote) return { host: null, devopsHost: null, repoLabel: null };
    const nwo = parseGitRemoteNwo(remote);
    if (nwo) return { host: 'github', devopsHost: null, repoLabel: nwo };
    const azure = parseAzureRemote(remote);
    if (azure) return { host: 'azdo', devopsHost: azure.devopsHost, repoLabel: `${p.name} (${azure.repo})` };
    return { host: null, devopsHost: null, repoLabel: null };
  }
}

function isoNow(): string { return new Date().toISOString(); }
