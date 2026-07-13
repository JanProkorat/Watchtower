import type { Exec, HttpGet } from '../prProviders/types.js';
import { defaultExec } from '../prProviders/exec.js';
import type { WatchedPr, MyRole } from './types.js';

const API = 'api-version=7.1';
const GH_DETAIL = 'number,title,url,reviewDecision,mergeable,mergeStateStatus,reviews,comments';
const GH_SEARCH = 'number,repository';

const defaultGet: HttpGet = async (url, pat) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} for ${url}`);
  return res.json();
};

// ── GitHub ───────────────────────────────────────────────────────────────

interface GhReview { author?: { login?: string }; state?: string; submittedAt?: string }
interface GhComment { author?: { login?: string }; createdAt?: string }
interface GhDetail {
  number: number; title: string; url: string;
  reviewDecision?: string; mergeable?: string; mergeStateStatus?: string;
  reviews?: GhReview[]; comments?: GhComment[];
}

const GH_REVIEW_STATE: Record<string, 'approved' | 'changes_requested' | 'commented'> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', COMMENTED: 'commented',
};

export function parseGithubDetail(
  raw: GhDetail, repoKey: string, repoLabel: string, me: string, role: MyRole,
): WatchedPr {
  const approved = raw.reviewDecision === 'APPROVED';
  const clean = raw.mergeStateStatus === 'CLEAN' && raw.mergeable === 'MERGEABLE';
  const mergeBlockedReason = clean ? null
    : raw.mergeable === 'CONFLICTING' ? 'Merge conflicts'
    : raw.mergeStateStatus === 'BLOCKED' ? 'Required checks/approvals not satisfied'
    : `Not mergeable (${raw.mergeStateStatus ?? 'unknown'})`;
  return {
    host: 'github', repoKey, repoLabel, prNumber: raw.number, title: raw.title, url: raw.url,
    myRole: role,
    reviewRequestedOfMe: role === 'reviewer',
    comments: (raw.comments ?? [])
      .filter((c) => c.author?.login && c.createdAt)
      .map((c) => ({ author: c.author!.login!, ts: c.createdAt! })),
    reviews: (raw.reviews ?? [])
      .filter((r) => r.author?.login && r.submittedAt && GH_REVIEW_STATE[r.state ?? ''])
      .map((r) => ({ author: r.author!.login!, state: GH_REVIEW_STATE[r.state!]!, ts: r.submittedAt! })),
    approved,
    mergeable: clean,
    mergeBlockedReason,
  };
}

async function ghSearch(filter: string, exec: Exec): Promise<{ number: number; nwo: string }[]> {
  const out = await exec('gh', ['search', 'prs', filter, '--state', 'open', '--limit', '100', '--json', GH_SEARCH]).catch(() => '[]');
  const rows = JSON.parse(out) as { number: number; repository?: { nameWithOwner?: string } }[];
  return rows.filter((r) => r.repository?.nameWithOwner).map((r) => ({ number: r.number, nwo: r.repository!.nameWithOwner! }));
}

export async function githubWatched(login: string, exec: Exec = defaultExec): Promise<WatchedPr[]> {
  const authored = await ghSearch('--author=@me', exec);
  const requested = await ghSearch('--review-requested=@me', exec);
  const seen = new Set<string>();
  const out: WatchedPr[] = [];
  for (const { list, role } of [
    { list: authored, role: 'author' as MyRole },
    { list: requested, role: 'reviewer' as MyRole },
  ]) {
    for (const { number, nwo } of list) {
      const key = `${nwo}#${number}`;
      if (seen.has(key)) continue; // authored takes precedence
      seen.add(key);
      const detailJson = await exec('gh', ['pr', 'view', String(number), '--repo', nwo, '--json', GH_DETAIL]).catch(() => null);
      if (!detailJson) continue;
      // Canonical repoKey must match resolveRepos() in reviews.ts: `gh:${nwo}`.
      out.push(parseGithubDetail(JSON.parse(detailJson) as GhDetail, `gh:${nwo}`, nwo.split('/')[1] ?? nwo, login, role));
    }
  }
  return out;
}

// ── Azure DevOps ─────────────────────────────────────────────────────────

interface AzdoReviewer { id: string; vote?: number }
interface AzdoPrRaw {
  pullRequestId: number; title: string; createdBy?: { id?: string };
  reviewers?: AzdoReviewer[]; repository?: { name?: string }; mergeStatus?: string;
}
interface AzdoThread { comments?: { author?: { uniqueName?: string }; publishedDate?: string }[] }

export function parseAzdoPr(
  raw: AzdoPrRaw, threads: AzdoThread[], userId: string, devopsHost: string, apiBase: string,
): WatchedPr {
  const role: MyRole = raw.createdBy?.id === userId ? 'author' : 'reviewer';
  const repo = raw.repository?.name ?? 'repo';
  const approved = (raw.reviewers ?? []).some((r) => (r.vote ?? 0) >= 10)
    && !(raw.reviewers ?? []).some((r) => (r.vote ?? 0) < 0);
  const mergeable = raw.mergeStatus === 'succeeded';
  const comments = threads.flatMap((t) =>
    (t.comments ?? [])
      .filter((c) => c.author?.uniqueName && c.publishedDate)
      .map((c) => ({ author: c.author!.uniqueName!, ts: c.publishedDate! })),
  );
  // DevOps has no distinct "review submit" event; treat a non-author comment as a review signal,
  // and approving votes as the approval signal (timestamped with the latest thread activity).
  const latestTs = comments.reduce<string | null>((a, c) => (a === null || c.ts > a ? c.ts : a), null);
  const reviews = (raw.reviewers ?? [])
    .filter((r) => r.id !== userId && (r.vote ?? 0) !== 0 && latestTs)
    .map((r) => ({
      author: r.id,
      state: (r.vote ?? 0) >= 10 ? 'approved' as const
        : (r.vote ?? 0) < 0 ? 'changes_requested' as const : 'commented' as const,
      ts: latestTs!,
    }));
  return {
    // Canonical repoKey must match resolveRepos() in reviews.ts: `azdo:${devopsHost}/${repo}`.
    host: 'azdo', repoKey: `azdo:${devopsHost}/${repo}`, repoLabel: repo, prNumber: raw.pullRequestId,
    title: raw.title, url: `${apiBase}/_git/${repo}/pullrequest/${raw.pullRequestId}`,
    myRole: role,
    reviewRequestedOfMe: role === 'reviewer',
    comments, reviews, approved,
    mergeable, mergeBlockedReason: mergeable ? null : `Merge status: ${raw.mergeStatus ?? 'unknown'}`,
  };
}

export async function azdoWatched(
  apiBase: string, devopsHost: string, user: { id: string }, pat: string, get: HttpGet = defaultGet,
): Promise<WatchedPr[]> {
  const base = `${apiBase}/_apis/git/pullrequests`;
  const q = `searchCriteria.status=active&$top=100&${API}`;
  const mine = (await get(`${base}?searchCriteria.creatorId=${user.id}&${q}`, pat).catch(() => ({ value: [] }))) as { value: AzdoPrRaw[] };
  const toReview = (await get(`${base}?searchCriteria.reviewerId=${user.id}&${q}`, pat).catch(() => ({ value: [] }))) as { value: AzdoPrRaw[] };
  const byId = new Map<number, AzdoPrRaw>();
  for (const p of [...mine.value, ...toReview.value]) byId.set(p.pullRequestId, p);
  const out: WatchedPr[] = [];
  for (const raw of byId.values()) {
    const repo = raw.repository?.name ?? '';
    const threadsUrl = `${apiBase}/_apis/git/repositories/${repo}/pullRequests/${raw.pullRequestId}/threads?${API}`;
    const threads = (await get(threadsUrl, pat).catch(() => ({ value: [] }))) as { value: AzdoThread[] };
    out.push(parseAzdoPr(raw, threads.value, user.id, devopsHost, apiBase));
  }
  return out;
}
