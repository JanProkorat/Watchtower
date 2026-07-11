import { execFile } from 'node:child_process';
import type { SqliteLike } from '../db/migrations.js';
import type { PrHost, PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';
import type { GithubRepoConfig, AzdoRepoConfig } from './prProviders/types.js';
import { listGithubPrs, fetchGithubDiff, parseGitRemoteNwo } from './prProviders/github.js';
import { listAzdoPrs, fetchAzdoDiff, parseAzureRemote } from './prProviders/azureDevops.js';

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
  private cache: PullRequestPayload[] = [];
  private syncedAt: string | null = null;
  private listGithub: (r: GithubRepoConfig) => Promise<PullRequestPayload[]>;
  private listAzdo: (r: AzdoRepoConfig, pat: string) => Promise<PullRequestPayload[]>;
  private gitRemote: (cwd: string) => Promise<string | null>;
  private projectsFn: () => Array<{ id: number; name: string; folder_path: string | null }>;

  constructor(deps: ReviewsDeps) {
    this.listGithub = deps.listGithub ?? ((r) => listGithubPrs(r));
    this.listAzdo = deps.listAzdo ?? ((r, pat) => listAzdoPrs(r, pat));
    this.gitRemote = deps.gitRemote ?? realGitRemote;
    this.projectsFn = deps.projects ?? (() => []);
  }

  private async resolveRepos(): Promise<{ github: GithubRepoConfig[]; azdo: AzdoRepoConfig[] }> {
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

  async diff(host: PrHost, repoKey: string, prNumber: number, devopsPats: Record<string, string> | undefined): Promise<DiffFilePayload[]> {
    const { github, azdo } = await this.resolveRepos();
    if (host === 'github') {
      const repo = github.find((r) => r.repoKey === repoKey);
      if (!repo) return [];
      return fetchGithubDiff(repo, prNumber);
    }
    const repo = azdo.find((r) => r.repoKey === repoKey);
    const pat = repo ? devopsPats?.[repo.devopsHost] : undefined;
    if (!repo || !pat) return [];
    return fetchAzdoDiff(repo, prNumber, pat);
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
