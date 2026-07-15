import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';
import type { AzdoRepoConfig, HttpGet, Exec } from './types.js';
import { parseUnifiedDiff } from './diffParse.js';
import { defaultExec } from './exec.js';
import { deriveAzdoMergeState } from '../prWatch/queries.js';

const API = 'api-version=7.1';
const stripRef = (r: string) => r.replace(/^refs\/heads\//, '');

export interface AzureRemote { devopsHost: string; apiBase: string; repo: string; }

export function parseAzureRemote(remoteUrl: string): AzureRemote | null {
  const u = remoteUrl.trim().replace(/\.git$/, '');
  const marker = '/_git/';
  const idx = u.indexOf(marker);
  if (idx < 0) return null;
  const apiBase = u.slice(0, idx);
  const repo = u.slice(idx + marker.length).replace(/\/.*$/, '');
  if (!repo) return null;
  let devopsHost: string;
  try { devopsHost = new URL(apiBase).host; } catch { return null; }
  return { devopsHost, apiBase, repo };
}

export function parseAzdoPrList(json: unknown, repo: AzdoRepoConfig): PullRequestPayload[] {
  const rows = (json as { value?: Array<Record<string, unknown>> }).value ?? [];
  return rows.map((r) => {
    const id = r.pullRequestId as number;
    return {
      host: 'azdo', repoKey: repo.repoKey, repoLabel: repo.repoLabel, number: id,
      title: (r.title as string) ?? '', author: ((r.createdBy as { uniqueName?: string })?.uniqueName) ?? 'unknown',
      sourceBranch: stripRef((r.sourceRefName as string) ?? ''), targetBranch: stripRef((r.targetRefName as string) ?? ''),
      url: `${repo.apiBase}/_git/${repo.repo}/pullrequest/${id}`,
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

/**
 * Two-query merge (repo-scoped) — PRs I created OR am a reviewer on — mirroring
 * the watcher's `azdoWatched` (prWatch/queries.ts). Dedupes by `pullRequestId`
 * before mapping via `parseAzdoPrList`, so a PR that's both mine and one I'm
 * reviewing on doesn't appear twice.
 */
export async function listAzdoPrs(
  repo: AzdoRepoConfig, pat: string, userId: string, get: HttpGet = defaultGet,
): Promise<PullRequestPayload[]> {
  const base = `${repo.apiBase}/_apis/git/repositories/${repo.repo}/pullrequests`;
  const q = `searchCriteria.status=active&$top=100&${API}`;
  const mine = (await get(`${base}?searchCriteria.creatorId=${userId}&${q}`, pat)) as { value?: Array<Record<string, unknown>> };
  const toReview = (await get(`${base}?searchCriteria.reviewerId=${userId}&${q}`, pat)) as { value?: Array<Record<string, unknown>> };
  const byId = new Map<number, Record<string, unknown>>();
  for (const p of [...(mine.value ?? []), ...(toReview.value ?? [])]) {
    byId.set(p.pullRequestId as number, p);
  }
  return parseAzdoPrList({ value: Array.from(byId.values()) }, repo);
}

/**
 * Fresh GET of a single PR to read its current `lastMergeSourceCommit.commitId`.
 * Azure rejects a completion PATCH carrying a stale source commit, so this must
 * be fetched at merge time rather than reused from the list cache. Uses the same
 * Basic-auth GET helper as the rest of the DevOps provider.
 */
export async function fetchAzdoPrDetail(
  repo: AzdoRepoConfig, prNumber: number, pat: string, get: HttpGet = defaultGet,
): Promise<{ lastMergeSourceCommitId: string }> {
  const url = `${repo.apiBase}/_apis/git/repositories/${repo.repo}/pullRequests/${prNumber}?${API}`;
  const data = (await get(url, pat)) as { lastMergeSourceCommit?: { commitId?: string } };
  const commitId = data.lastMergeSourceCommit?.commitId;
  if (!commitId) throw new Error(`Azure DevOps PR ${prNumber} has no lastMergeSourceCommit`);
  return { lastMergeSourceCommitId: commitId };
}

export async function fetchAzdoDiff(
  repo: AzdoRepoConfig, sourceBranch: string, targetBranch: string, exec: Exec = defaultExec,
): Promise<DiffFilePayload[]> {
  const clone = repo.localClonePath;
  if (!clone || !sourceBranch || !targetBranch) return [];
  // Fetch both PR branches into a private ref namespace (force, no tags), then three-dot diff.
  // Uses the clone's own git auth (SSH key / credential helper already configured for `origin`) — no PAT needed.
  await exec('git', ['-C', clone, 'fetch', '--no-tags', '--force', 'origin',
    `+${sourceBranch}:refs/wt-review/src`, `+${targetBranch}:refs/wt-review/tgt`]);
  const out = await exec('git', ['-C', clone, 'diff', 'refs/wt-review/tgt...refs/wt-review/src']);
  return parseUnifiedDiff(out);
}

export interface AzdoReviewState { amIAuthor: boolean; approved: boolean; mergeable: boolean; mergeBlockedReason: string | null }

/** Live approval/merge state for the Reviews drawer's "reviewState" IPC. Reuses
 *  `deriveAzdoMergeState` (shared with the PR watcher) so the two agree. */
export async function fetchAzdoReviewState(
  repo: AzdoRepoConfig, prNumber: number, pat: string, myId: string, get: HttpGet = defaultGet,
): Promise<AzdoReviewState> {
  const url = `${repo.apiBase}/_apis/git/repositories/${repo.repo}/pullRequests/${prNumber}?${API}`;
  const data = (await get(url, pat)) as {
    createdBy?: { id?: string };
    reviewers?: { id: string; vote?: number }[];
    mergeStatus?: string;
  };
  return { amIAuthor: data.createdBy?.id === myId, ...deriveAzdoMergeState(data.reviewers, data.mergeStatus) };
}

export type HttpPut = (url: string, pat: string, body: unknown) => Promise<void>;

const defaultPut: HttpPut = async (url, pat, body) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} approving PR: ${await res.text().catch(() => '')}`);
};

/** `vote: 10` is the "approved" value the codebase already reads (see `deriveAzdoMergeState`). */
export async function approveAzdoPr(
  apiBase: string, repo: string, prNumber: number, myId: string, pat: string, put: HttpPut = defaultPut,
): Promise<void> {
  const url = `${apiBase}/_apis/git/repositories/${repo}/pullRequests/${prNumber}/reviewers/${myId}?${API}`;
  await put(url, pat, { vote: 10 });
}

export type HttpPatch = (url: string, pat: string, body: unknown) => Promise<void>;

const defaultPatch: HttpPatch = async (url, pat, body) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} abandoning PR: ${await res.text().catch(() => '')}`);
};

/** DevOps's "close without merging". Unlike completion (see `mergeAzdoPr`), an
 *  abandon PATCH needs no fresh lastMergeSourceCommit — just the status flip. */
export async function abandonAzdoPr(
  apiBase: string, repo: string, prNumber: number, pat: string, patch: HttpPatch = defaultPatch,
): Promise<void> {
  const url = `${apiBase}/_apis/git/repositories/${repo}/pullRequests/${prNumber}?${API}`;
  await patch(url, pat, { status: 'abandoned' });
}

export async function fetchAzdoComments(repo: AzdoRepoConfig, prNumber: number, pat: string, get: HttpGet = defaultGet): Promise<PrCommentThreadPayload[]> {
  const url = `${repo.apiBase}/_apis/git/repositories/${repo.repo}/pullRequests/${prNumber}/threads?${API}`;
  const data = (await get(url, pat)) as { value?: Array<{
    id: number; status?: string; isDeleted?: boolean;
    threadContext?: { filePath?: string; rightFileStart?: { line?: number }; leftFileStart?: { line?: number } };
    comments?: Array<{ author?: { displayName?: string; uniqueName?: string }; content?: string; publishedDate?: string; commentType?: string; isDeleted?: boolean }>;
  }> };
  const threads: PrCommentThreadPayload[] = [];
  for (const t of data.value ?? []) {
    if (t.isDeleted) continue;
    const comments = (t.comments ?? [])
      .filter((c) => !c.isDeleted && c.commentType !== 'system' && (c.content ?? '').trim() !== '')
      .map((c) => ({ author: c.author?.displayName ?? c.author?.uniqueName ?? 'unknown', date: c.publishedDate ?? '', body: c.content ?? '' }));
    if (comments.length === 0) continue;
    const fp = t.threadContext?.filePath ?? null;
    threads.push({
      id: String(t.id),
      file: fp ? fp.replace(/^\//, '') : null,
      line: t.threadContext?.rightFileStart?.line ?? t.threadContext?.leftFileStart?.line ?? null,
      status: t.status ?? null,
      comments,
    });
  }
  return threads;
}
