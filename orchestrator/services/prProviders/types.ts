export type Exec = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<string>;

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
  orgBaseUrl: string;
  project: string;
  repo: string;
  localClonePath: string | null;
}

export type HttpGet = (url: string, pat: string) => Promise<unknown>;
