import { execFile } from 'node:child_process';
import type { SqliteLike } from '../db/migrations.js';
import type { PrHost, PullRequestPayload, DiffFilePayload, PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';
import type { GithubRepoConfig, AzdoRepoConfig, Exec } from './prProviders/types.js';
import { listGithubPrs, fetchGithubDiff, fetchGithubComments, parseGitRemoteNwo } from './prProviders/github.js';
import { listAzdoPrs, fetchAzdoDiff, fetchAzdoComments, fetchAzdoPrDetail, parseAzureRemote } from './prProviders/azureDevops.js';
import { defaultExec } from './prProviders/exec.js';

export interface ReviewsDeps {
  db: SqliteLike;
  listGithub?: (repo: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  listAzdo?: (repo: AzdoRepoConfig, pat: string) => Promise<PullRequestPayload[]>;
  azdoPrDetail?: (repo: AzdoRepoConfig, prNumber: number, pat: string) => Promise<{ lastMergeSourceCommitId: string }>;
  gitRemote?: (cwd: string) => Promise<string | null>;
  projects?: () => Array<{ id: number; name: string; folder_path: string | null }>;
  exec?: Exec;
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
  private listGithub: (r: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  private listAzdo: (r: AzdoRepoConfig, pat: string) => Promise<PullRequestPayload[]>;
  private azdoPrDetail: (r: AzdoRepoConfig, prNumber: number, pat: string) => Promise<{ lastMergeSourceCommitId: string }>;
  private gitRemote: (cwd: string) => Promise<string | null>;
  private projectsFn: () => Array<{ id: number; name: string; folder_path: string | null }>;
  private exec: Exec;

  constructor(deps: ReviewsDeps) {
    this.listGithub = deps.listGithub ?? ((r) => listGithubPrs(r));
    this.listAzdo = deps.listAzdo ?? ((r, pat) => listAzdoPrs(r, pat));
    this.azdoPrDetail = deps.azdoPrDetail ?? ((r, prNumber, pat) => fetchAzdoPrDetail(r, prNumber, pat));
    this.gitRemote = deps.gitRemote ?? realGitRemote;
    this.projectsFn = deps.projects ?? (() => []);
    this.exec = deps.exec ?? defaultExec;
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

  list() { return { pullRequests: this.cache, syncedAt: this.syncedAt }; }

  async refresh(devopsPats: Record<string, string> | undefined) {
    const results: PullRequestPayload[] = [];
    const errors: string[] = [];
    const { github, azdo } = await this.resolveRepos();
    for (const r of github) {
      try { results.push(...(await this.listGithub(r))); }
      catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    for (const r of azdo) {
      const pat = devopsPats?.[r.devopsHost];
      if (!pat) { errors.push(`${r.repoLabel}: chybí PAT`); continue; }
      try { results.push(...(await this.listAzdo(r, pat))); }
      catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    this.cache = results;
    this.syncedAt = isoNow();
    if (results.length === 0 && errors.length > 0) {
      throw new Error(`Načtení PR selhalo:\n${errors.join('\n')}`);
    }
    return this.list();
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
