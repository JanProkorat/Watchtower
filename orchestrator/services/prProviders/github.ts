import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';
import type { Exec, GithubRepoConfig } from './types.js';
import { parseUnifiedDiff } from './diffParse.js';
import { defaultExec } from './exec.js';

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

export async function listGithubPrs(repo: GithubRepoConfig, exec: Exec = defaultExec): Promise<PullRequestPayload[]> {
  const out = await exec('gh', ['pr', 'list', '--repo', repo.nwo, '--state', 'open', '--limit', '100', '--json', GH_FIELDS]);
  return parseGithubPrList(out, repo);
}

export async function fetchGithubDiff(repo: GithubRepoConfig, prNumber: number, exec: Exec = defaultExec): Promise<DiffFilePayload[]> {
  const out = await exec('gh', ['pr', 'diff', String(prNumber), '--repo', repo.nwo]);
  return parseUnifiedDiff(out);
}

export function parseGithubComments(reviewJson: string, convoJson: string): PrCommentThreadPayload[] {
  const threads: PrCommentThreadPayload[] = [];
  // inline review comments: path + line
  const review = JSON.parse(reviewJson) as Array<{ id: number; path?: string; line?: number | null; original_line?: number | null; body: string; user?: { login?: string }; created_at?: string }>;
  for (const c of review) {
    threads.push({ id: `r${c.id}`, file: c.path ?? null, line: c.line ?? c.original_line ?? null, status: null,
      comments: [{ author: c.user?.login ?? 'unknown', date: c.created_at ?? '', body: c.body ?? '' }] });
  }
  // conversation (issue) comments: no file/line
  const convo = (JSON.parse(convoJson) as { comments?: Array<{ author?: { login?: string }; body?: string; createdAt?: string }> }).comments ?? [];
  for (const c of convo) {
    threads.push({ id: `c${threads.length}`, file: null, line: null, status: null,
      comments: [{ author: c.author?.login ?? 'unknown', date: c.createdAt ?? '', body: c.body ?? '' }] });
  }
  return threads;
}

export async function fetchGithubComments(repo: GithubRepoConfig, prNumber: number, exec: Exec = defaultExec): Promise<PrCommentThreadPayload[]> {
  const reviewJson = await exec('gh', ['api', `repos/${repo.nwo}/pulls/${prNumber}/comments`, '--paginate']).catch(() => '[]');
  const convoJson = await exec('gh', ['pr', 'view', String(prNumber), '--repo', repo.nwo, '--json', 'comments']).catch(() => '{"comments":[]}');
  return parseGithubComments(reviewJson, convoJson);
}
