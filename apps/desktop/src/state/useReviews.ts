import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload, PrHost, PrReviewPayload, PrFindingPayload } from '@watchtower/shared/ipcContract.js';

export type HostFilter = 'all' | 'github' | 'azdo';
const HOST_LABEL: Record<PrHost, string> = { github: 'GitHub', azdo: 'Azure DevOps · Škoda' };

const SEVERITY_ORDER: Record<PrFindingPayload['severity'], number> = { error: 0, warn: 1, info: 2 };

export function sortFindings(findings: PrFindingPayload[]): PrFindingPayload[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// The most severe (error > warn > info) severity present in a list of findings, or null if empty.
export function worstSeverity(findings: PrFindingPayload[]): PrFindingPayload['severity'] | null {
  let worst: PrFindingPayload['severity'] | null = null;
  for (const f of findings) {
    if (worst === null || SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[worst]) worst = f.severity;
  }
  return worst;
}

export function sortByUpdatedDesc(prs: PullRequestPayload[]): PullRequestPayload[] {
  return [...prs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function groupPrsByHost(prs: PullRequestPayload[]) {
  const order: PrHost[] = ['github', 'azdo'];
  return order.map((host) => ({ host, label: HOST_LABEL[host],
    prs: sortByUpdatedDesc(prs.filter((p) => p.host === host)) })).filter((g) => g.prs.length > 0);
}

export function applyPrFilter(prs: PullRequestPayload[], host: HostFilter, query: string): PullRequestPayload[] {
  const q = query.trim().toLowerCase();
  return prs.filter((p) => (host === 'all' || p.host === host)
    && (q === '' || p.title.toLowerCase().includes(q) || p.repoLabel.toLowerCase().includes(q)
      || String(p.number).includes(q)));
}

export function relativeAge(iso: string, nowMs: number): string {
  const diff = nowMs - Date.parse(iso);
  if (diff < 60_000) return 'just now';
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.floor(diff / 60_000)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function useReviews() {
  const [pullRequests, setPullRequests] = useState<PullRequestPayload[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (kind: 'prs:list' | 'prs:refresh') => {
    setLoading(true); setError(null);
    try {
      const res = await window.watchtower.invoke(kind, {});
      setPullRequests(res.pullRequests); setSyncedAt(res.syncedAt);
      return res;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); return null; }
    finally { setLoading(false); }
  }, []);

  const refresh = useCallback(() => load('prs:refresh'), [load]);

  useEffect(() => {
    void (async () => {
      const res = await load('prs:list');
      if (res && res.syncedAt === null) await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadDiff = useCallback(async (pr: PullRequestPayload): Promise<DiffFilePayload[]> => {
    const res = await window.watchtower.invoke('prs:diff', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.files;
  }, []);

  const loadComments = useCallback(async (pr: PullRequestPayload): Promise<PrCommentThreadPayload[]> => {
    const res = await window.watchtower.invoke('prs:comments', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.threads;
  }, []);

  // ─── PR review agent (Report tab) ───
  const [review, setReview] = useState<PrReviewPayload | null>(null);
  const [reviewRunning, setReviewRunning] = useState(false);
  // The review currently shown in the drawer. Pushes for other reviewIds (e.g. a
  // review kicked off for a PR the user has since closed) are ignored.
  const openReviewIdRef = useRef<number | null>(null);
  // Bumped on every openReviewFor call so a slow lookup for a PR the user has since
  // navigated away from can't clobber the (already newer) state with stale data.
  const openReviewTokenRef = useRef(0);

  const startReview = useCallback(async (pr: PullRequestPayload): Promise<number> => {
    const res = await window.watchtower.invoke('prReview:start', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.reviewId;
  }, []);

  const getReview = useCallback(async (reviewId: number): Promise<PrReviewPayload | null> => {
    const res = await window.watchtower.invoke('prReview:get', { reviewId });
    return res.review;
  }, []);

  const listReviews = useCallback(async (repoKey?: string): Promise<PrReviewPayload[]> => {
    const res = await window.watchtower.invoke('prReview:list', { repoKey });
    return res.reviews;
  }, []);

  const latestReviewFor = useCallback(async (pr: PullRequestPayload): Promise<PrReviewPayload | null> => {
    const reviews = await listReviews(pr.repoKey);
    return reviews.find((r) => r.host === pr.host && r.prNumber === pr.number) ?? null;
  }, [listReviews]);

  // Look up the latest review for this PR and, if it's still running, abort it via
  // the orchestrator's runningReviews AbortController map (prReview:cancel).
  const cancelReview = useCallback(async (pr: PullRequestPayload): Promise<void> => {
    const found = await latestReviewFor(pr);
    if (!found || found.status !== 'running') return;
    await window.watchtower.invoke('prReview:cancel', { reviewId: found.id });
  }, [latestReviewFor]);

  // ─── Review state for the PR list (grey/amber/green/red dot + finding count) ───
  const [reviewStates, setReviewStates] = useState<Map<string, PrReviewPayload>>(new Map());

  const loadReviewStates = useCallback(async (): Promise<void> => {
    // No repoKey → all repos, ordered id DESC (newest first), so the first row seen
    // per (host, repoKey, prNumber) key is that PR's latest review.
    try {
      const reviews = await listReviews();
      const map = new Map<string, PrReviewPayload>();
      for (const r of reviews) {
        const key = `${r.host}:${r.repoKey}:${r.prNumber}`;
        if (!map.has(key)) map.set(key, r);
      }
      setReviewStates(map);
    } catch (err) {
      // Surface via the hook's existing `error` state (rendered by ModuleReviews'
      // Alert) — a rejected prReview:list must not silently fail the whole
      // review-state map (grey/amber/green/red dots on the PR list).
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [listReviews]);

  useEffect(() => { void loadReviewStates(); }, [loadReviewStates]);

  const reviewStateFor = useCallback((pr: PullRequestPayload): { status: 'running' | 'done' | 'error'; findingCount: number } | null => {
    const r = reviewStates.get(`${pr.host}:${pr.repoKey}:${pr.number}`);
    if (!r) return null;
    return { status: r.status, findingCount: r.findings.length };
  }, [reviewStates]);

  // Any push about a review's lifecycle can affect a row this list is showing (even
  // one not open in the drawer), so refresh the whole map rather than trying to
  // resolve which PR a bare reviewId push belongs to.
  useEffect(() => {
    const offDone = window.watchtower.on('prReviewDone', () => { void loadReviewStates(); });
    const offProgress = window.watchtower.on('prReviewProgress', () => { void loadReviewStates(); });
    return () => { offDone(); offProgress(); };
  }, [loadReviewStates]);

  // Load (or reload) the review shown for a PR — call when the Report tab / drawer opens.
  const openReviewFor = useCallback(async (pr: PullRequestPayload): Promise<void> => {
    // Clear immediately so switching PRs never flashes the previous PR's review
    // while the (async) lookup for the new one is still in flight.
    const token = ++openReviewTokenRef.current;
    openReviewIdRef.current = null;
    setReview(null);
    setReviewRunning(false);
    const found = await latestReviewFor(pr);
    if (token !== openReviewTokenRef.current) return; // a newer openReviewFor call has since won
    openReviewIdRef.current = found?.id ?? null;
    setReview(found);
    setReviewRunning(found?.status === 'running');
  }, [latestReviewFor]);

  // Kick off a fresh review run for the open PR and start tracking its reviewId.
  const runReview = useCallback(async (pr: PullRequestPayload): Promise<number> => {
    // Capture the token before the await — if the user switches PRs (which bumps
    // openReviewTokenRef via openReviewFor) while startReview is in flight, we must
    // not repoint openReviewIdRef at this (now stale) review: doing so would let
    // PR A's later prReviewProgress/prReviewDone pushes clobber PR B's open review.
    const token = openReviewTokenRef.current;
    setReviewRunning(true);
    const reviewId = await startReview(pr);
    if (token === openReviewTokenRef.current) {
      openReviewIdRef.current = reviewId;
    }
    return reviewId;
  }, [startReview]);

  useEffect(() => {
    const offDone = window.watchtower.on('prReviewDone', (p) => {
      if (p.reviewId !== openReviewIdRef.current) return;
      void getReview(p.reviewId).then((r) => { setReview(r); setReviewRunning(false); });
    });
    const offProgress = window.watchtower.on('prReviewProgress', (p) => {
      if (p.reviewId !== openReviewIdRef.current) return;
      setReviewRunning(p.status === 'running');
      if (p.status === 'error') {
        void getReview(p.reviewId).then((r) => setReview(r));
      }
    });
    return () => { offDone(); offProgress(); };
  }, [getReview]);

  return {
    pullRequests, syncedAt, loading, error, refresh, loadDiff, loadComments,
    review, reviewRunning, openReviewFor, runReview, startReview, cancelReview, getReview, listReviews, latestReviewFor,
    reviewStateFor,
  };
}
