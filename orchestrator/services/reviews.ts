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
    return { orgBaseUrl: c.orgBaseUrl, repos: c.repos };
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
    const errors: string[] = [];
    for (const r of await this.githubRepos()) {
      try { results.push(...(await this.listGithub(r))); }
      catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (devopsPat) {
      for (const r of this.azdoRepos()) {
        try { results.push(...(await this.listAzdo(r, devopsPat))); }
        catch (e) { errors.push(`${r.repoLabel}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    this.cache = results;
    this.syncedAt = isoNow();
    if (results.length === 0 && errors.length > 0) {
      throw new Error(`Načtení PR selhalo:\n${errors.join('\n')}`);
    }
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
