import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import type { Exec } from './types.js';
import { defaultExec } from './exec.js';

/**
 * Render a single review finding into the comment body posted back to the
 * PR host (GitHub / Azure DevOps). Task 2 adds the host-specific posters
 * that call this; kept here so both providers share one format.
 */
export function formatFindingBody(f: PrFindingPayload): string {
  const head = `**[${f.severity}] ${f.category}** ${f.summary}`;
  return f.detail ? `${head}\n\n${f.detail}` : head;
}

/** Post a single inline review comment onto a GitHub PR via `gh api`. */
export async function postGithubComment(
  nwo: string,
  prNumber: number,
  headSha: string,
  finding: PrFindingPayload,
  exec: Exec = defaultExec,
): Promise<void> {
  await exec('gh', [
    'api', '--method', 'POST', `repos/${nwo}/pulls/${prNumber}/comments`,
    '-f', `body=${formatFindingBody(finding)}`,
    '-f', `commit_id=${headSha}`,
    '-f', `path=${finding.file}`,
    '-F', `line=${finding.line}`,
    '-f', 'side=RIGHT',
  ]);
}

export type HttpPost = (url: string, pat: string, body: unknown) => Promise<void>;

const defaultPost: HttpPost = async (url, pat, body) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status}`);
};

/** Post a single inline review comment onto an Azure DevOps PR as a new thread. */
export async function postAzdoComment(
  apiBase: string,
  repo: string,
  prNumber: number,
  finding: PrFindingPayload,
  pat: string,
  post: HttpPost = defaultPost,
): Promise<void> {
  const url = `${apiBase}/_apis/git/repositories/${repo}/pullRequests/${prNumber}/threads?api-version=7.1`;
  await post(url, pat, {
    comments: [{ parentCommentId: 0, content: formatFindingBody(finding), commentType: 1 }],
    status: 1,
    threadContext: {
      filePath: '/' + finding.file.replace(/^\//, ''),
      rightFileStart: { line: finding.line, offset: 1 },
      rightFileEnd: { line: finding.line, offset: 1 },
    },
  });
}
