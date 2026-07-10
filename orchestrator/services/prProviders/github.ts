import { execFile } from 'node:child_process';
import type { PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';
import type { Exec, GithubRepoConfig } from './types.js';
import { parseUnifiedDiff } from './diffParse.js';

const GH_FIELDS = 'number,title,author,headRefName,baseRefName,updatedAt,url';

export function parseGitRemoteNwo(remoteUrl: string): string | null {
  const u = remoteUrl.trim();
  let m = /^git@github\.com:(.+?)(?:\.git)?$/.exec(u);
  if (m) return m[1] ?? null;
  m = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/.exec(u);
  return m ? m[1] ?? null : null;
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
