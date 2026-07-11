export type Exec = (cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }) => Promise<string>;

export interface GithubRepoConfig {
  host: 'github';
  repoKey: string;
  repoLabel: string;
  nwo: string;
  localClonePath: string | null;
}

export interface AzdoRepoConfig {
  host: 'azdo';
  repoKey: string;
  repoLabel: string;
  devopsHost: string;   // PAT scope key, e.g. devops.skoda.vwgroup.com
  apiBase: string;      // everything before /_git/
  repo: string;         // repo name after /_git/
  localClonePath: string | null;
}

export type HttpGet = (url: string, pat: string) => Promise<unknown>;
