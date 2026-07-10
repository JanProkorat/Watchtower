export type Exec = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<string>;

export interface GithubRepoConfig {
  host: 'github';
  repoKey: string;
  repoLabel: string;
  nwo: string;
  localClonePath: string | null;
}
