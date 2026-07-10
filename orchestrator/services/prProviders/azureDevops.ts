import type { PullRequestPayload, DiffFilePayload } from '@watchtower/shared/ipcContract.js';
import type { AzdoRepoConfig, HttpGet } from './types.js';
import { parseUnifiedDiff } from './diffParse.js';

const API = 'api-version=7.1';
const stripRef = (r: string) => r.replace(/^refs\/heads\//, '');

export function parseAzdoPrList(json: unknown, repo: AzdoRepoConfig): PullRequestPayload[] {
  const rows = (json as { value?: Array<Record<string, unknown>> }).value ?? [];
  return rows.map((r) => {
    const id = r.pullRequestId as number;
    return {
      host: 'azdo', repoKey: repo.repoKey, repoLabel: repo.repoLabel, number: id,
      title: (r.title as string) ?? '', author: ((r.createdBy as { uniqueName?: string })?.uniqueName) ?? 'unknown',
      sourceBranch: stripRef((r.sourceRefName as string) ?? ''), targetBranch: stripRef((r.targetRefName as string) ?? ''),
      url: `${repo.orgBaseUrl}/${repo.project}/_git/${repo.repo}/pullrequest/${id}`,
      updatedAt: (r.creationDate as string) ?? '', reviewable: repo.localClonePath != null,
    };
  });
}

const defaultGet: HttpGet = async (url, pat) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} for ${url}`);
  return res.json();
};

export async function listAzdoPrs(repo: AzdoRepoConfig, pat: string, get: HttpGet = defaultGet): Promise<PullRequestPayload[]> {
  const url = `${repo.orgBaseUrl}/${repo.project}/_apis/git/repositories/${repo.repo}/pullrequests?searchCriteria.status=active&$top=100&${API}`;
  return parseAzdoPrList(await get(url, pat), repo);
}

export async function fetchAzdoDiff(repo: AzdoRepoConfig, prNumber: number, pat: string, get: HttpGet = defaultGet): Promise<DiffFilePayload[]> {
  // DevOps has no single unified-diff endpoint; SP1 uses the commit-level diff text
  // via the "diffs/commits" API and reconstructs unified hunks. For the first slice
  // we fetch the PR's iteration changes and render file-level diffs.
  const itUrl = `${repo.orgBaseUrl}/${repo.project}/_apis/git/repositories/${repo.repo}/pullRequests/${prNumber}/iterations?${API}`;
  const iterations = (await get(itUrl, pat)) as { value: Array<{ id: number }> };
  const last = iterations.value.at(-1)?.id ?? 1;
  const chUrl = `${repo.orgBaseUrl}/${repo.project}/_apis/git/repositories/${repo.repo}/pullRequests/${prNumber}/iterations/${last}/changes?${API}`;
  const changes = (await get(chUrl, pat)) as { changeEntries?: Array<{ item?: { path?: string } }> };
  // Minimal SP1 rendering: one pseudo-file entry per changed path, no line bodies yet.
  // (Full DevOps hunk bodies are a follow-up; GitHub diffs are full-fidelity in SP1.)
  const paths = (changes.changeEntries ?? []).map((c) => c.item?.path).filter(Boolean) as string[];
  const raw = paths.map((p) => `diff --git a${p} b${p}\n--- a${p}\n+++ b${p}\n`).join('');
  return parseUnifiedDiff(raw);
}
