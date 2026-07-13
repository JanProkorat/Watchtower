import type { Exec } from '../prProviders/types.js';
import { defaultExec } from '../prProviders/exec.js';

const API = 'api-version=7.1';

export async function mergeGithubPr(
  nwo: string, prNumber: number, deleteBranch: boolean, exec: Exec = defaultExec,
): Promise<void> {
  const args = ['pr', 'merge', String(prNumber), '--repo', nwo, '--squash'];
  if (deleteBranch) args.push('--delete-branch');
  await exec('gh', args);
}

export type HttpPatch = (url: string, pat: string, body: unknown) => Promise<void>;

const defaultPatch: HttpPatch = async (url, pat, body) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} completing PR: ${await res.text().catch(() => '')}`);
};

export async function mergeAzdoPr(
  apiBase: string, repo: string, prNumber: number, lastMergeSourceCommitId: string,
  deleteBranch: boolean, pat: string, patch: HttpPatch = defaultPatch,
): Promise<void> {
  const url = `${apiBase}/_apis/git/repositories/${repo}/pullRequests/${prNumber}?${API}`;
  await patch(url, pat, {
    status: 'completed',
    lastMergeSourceCommit: { commitId: lastMergeSourceCommitId },
    completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: deleteBranch },
  });
}
