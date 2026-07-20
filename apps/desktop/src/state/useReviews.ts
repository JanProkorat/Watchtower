import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload, PrHost, PrReviewPayload, PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import { invoke } from './ipc';
import { toast } from './useToast';

export type PrReviewState = { amIAuthor: boolean; approved: boolean; mergeable: boolean; mergeBlockedReason: string | null };

export type HostFilter = 'all' | 'github' | 'azdo';

const SEVERITY_ORDER: Record<PrFindingPayload['severity'], number> = { error: 0, warn: 1, info: 2 };

export function sortFindings(findings: PrFindingPayload[]): PrFindingPayload[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// Same ordering as sortFindings, but keeps each finding's index into the original
// (unsorted, as-stored) array — that's the index prReview:postComments expects, so
// the UI must track selection by original index, not sorted position.
export function sortFindingsWithIndex(findings: PrFindingPayload[]): { finding: PrFindingPayload; index: number }[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity]);
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

// Group PRs by the Watchtower project they belong to. Every list PR carries its
// project name in `repoLabel` (stamped by the Reviews service from the project
// that owns the repo); a PR without one falls into the 'Default' bucket. Groups
// are ordered most-recently-active first, with 'Default' pinned last.
export function groupPrsByProject(prs: PullRequestPayload[]) {
  const byProject = new Map<string, PullRequestPayload[]>();
  for (const p of prs) {
    const label = p.repoLabel?.trim() ? p.repoLabel : 'Default';
    const list = byProject.get(label);
    if (list) list.push(p); else byProject.set(label, [p]);
  }
  const groups = [...byProject.entries()].map(([label, list]) => ({ label, prs: sortByUpdatedDesc(list) }));
  groups.sort((a, b) => {
    if (a.label === 'Default') return 1;
    if (b.label === 'Default') return -1;
    return Date.parse(b.prs[0]!.updatedAt) - Date.parse(a.prs[0]!.updatedAt);
  });
  return groups;
}

export function applyPrFilter(prs: PullRequestPayload[], host: HostFilter, query: string): PullRequestPayload[] {
  const q = query.trim().toLowerCase();
  return prs.filter((p) => (host === 'all' || p.host === host)
    && (q === '' || p.title.toLowerCase().includes(q) || p.repoLabel.toLowerCase().includes(q)
      || String(p.number).includes(q)));
}

const RESOLVED_STATUSES = new Set(['fixed', 'closed']);
// Client-side count for the drawer button badge: code-anchored + unresolved.
// The authorship ("from others") filter runs server-side, where the login is
// known — so this may slightly over-count on GitHub; that is acceptable for a
// badge and the server refuses launches with zero qualifying comments.
export function countImplementableComments(threads: PrCommentThreadPayload[]): number {
  return threads.filter((t) => t.file != null && t.line != null && !(t.status != null && RESOLVED_STATUSES.has(t.status))).length;
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
      const res = await invoke(kind, {});
      setPullRequests(res.pullRequests); setSyncedAt(res.syncedAt);
      // Per-repo failures that didn't abort the whole list (e.g. one DevOps repo
      // failed while GitHub loaded) surface as non-blocking warning toasts.
      for (const w of res.warnings ?? []) toast.showWarning(w);
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

  // ─── Live updates (no manual Refresh needed) ───
  // Two triggers keep the list current on their own:
  //   1. prWatchEvent — pushed by the orchestrator's PR-watch poller the moment
  //      it detects a new comment / review / approval / changes-requested on a
  //      watched PR (orchestrator/index.ts `startPrWatch`). Same push the
  //      notification badge rides (usePrWatch).
  //   2. an adaptive interval (60s focused / 300s unfocused, mirroring the
  //      poller) — a backstop that also catches what prWatchEvent does NOT emit:
  //      brand-new PRs appearing and PRs merged/closed by someone else.
  // Both go through backgroundRefresh: it re-fetches like the Refresh button but
  // WITHOUT flipping `loading` (which would disable the button and flash the
  // empty-state spinner every cycle) and WITHOUT toasting on a transient failure
  // (a background poll must stay quiet; the next cycle retries). Concurrent
  // triggers are coalesced — a burst of pushes from one poll cycle does a single
  // extra fetch, never one per event.
  const bgBusyRef = useRef(false);
  const bgQueuedRef = useRef(false);
  const backgroundRefresh = useCallback(async (): Promise<void> => {
    if (bgBusyRef.current) { bgQueuedRef.current = true; return; }
    bgBusyRef.current = true;
    try {
      const res = await invoke('prs:refresh', {}, { silent: true });
      setPullRequests(res.pullRequests);
      setSyncedAt(res.syncedAt);
    } catch {
      // Background poll: swallow. A manual Refresh still surfaces errors loudly.
    } finally {
      bgBusyRef.current = false;
      if (bgQueuedRef.current) { bgQueuedRef.current = false; void backgroundRefresh(); }
    }
  }, []);

  useEffect(() => {
    const off = window.watchtower.on('prWatchEvent', () => { void backgroundRefresh(); });
    return () => { off(); };
  }, [backgroundRefresh]);

  useEffect(() => {
    const FOCUSED_MS = 60_000;
    const UNFOCUSED_MS = 300_000;
    const isFocused = () =>
      typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Self-rescheduling so the cadence re-evaluates focus each tick. First fire
    // is after the interval (mount already loaded above), not immediately.
    function tick(): void {
      void backgroundRefresh();
      timer = setTimeout(tick, isFocused() ? FOCUSED_MS : UNFOCUSED_MS);
    }
    timer = setTimeout(tick, isFocused() ? FOCUSED_MS : UNFOCUSED_MS);
    return () => { if (timer) clearTimeout(timer); };
  }, [backgroundRefresh]);
  // Squash-merge a PR (Task 11's Merge button). electron-main injects any
  // devopsPats needed for Azure DevOps — the renderer never sends them.
  const mergePr = useCallback(async (host: PrHost, repoKey: string, prNumber: number, deleteBranch: boolean): Promise<void> => {
    await invoke('prs:merge', { host, repoKey, prNumber, deleteBranch });
    await refresh();
  }, [refresh]);

  // Close without merging (GitHub close / DevOps abandon). Refresh evicts the
  // now-inactive PR from the list. electron-main injects devopsPats.
  const closePr = useCallback(async (host: PrHost, repoKey: string, prNumber: number): Promise<void> => {
    await invoke('prs:close', { host, repoKey, prNumber });
    await refresh();
  }, [refresh]);

  // Fresh (not watch-inbox-cached) approve/mergeable state for the drawer's action
  // row. electron-main injects any devopsPats needed for Azure DevOps — the
  // renderer never sends them.
  const fetchReviewState = useCallback(async (host: PrHost, repoKey: string, number: number): Promise<PrReviewState> => {
    return invoke('prs:reviewState', { host, repoKey, number });
  }, []);

  // Approve a PR (GitHub `gh pr review --approve` / ADO reviewer vote). The
  // renderer never sends devopsPats — electron-main injects them for this kind.
  const approvePr = useCallback(async (host: PrHost, repoKey: string, number: number): Promise<void> => {
    await invoke('prs:approve', { host, repoKey, number });
  }, []);

  const loadDiff = useCallback(async (pr: PullRequestPayload): Promise<DiffFilePayload[]> => {
    const res = await invoke('prs:diff', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.files;
  }, []);

  const loadComments = useCallback(async (pr: PullRequestPayload): Promise<PrCommentThreadPayload[]> => {
    const res = await invoke('prs:comments', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.threads;
  }, []);

  // Kick off the "implement review comments" agent: a new instance in a fresh
  // worktree that addresses code-anchored, unresolved review comments. The
  // orchestrator applies the authoritative (authorship + resolved) filter.
  const implementComments = useCallback(async (pr: PullRequestPayload): Promise<{ instanceId: string | null; worktreePath: string | null }> => {
    return invoke('prImplement:start', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
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
    const res = await invoke('prReview:start', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.reviewId;
  }, []);

  const getReview = useCallback(async (reviewId: number): Promise<PrReviewPayload | null> => {
    const res = await invoke('prReview:get', { reviewId });
    return res.review;
  }, []);

  const listReviews = useCallback(async (repoKey?: string): Promise<PrReviewPayload[]> => {
    const res = await invoke('prReview:list', { repoKey });
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
    await invoke('prReview:cancel', { reviewId: found.id });
  }, [latestReviewFor]);

  // Post the selected findings (by original index) as comments on the PR. The
  // renderer never sends devopsPats — electron-main injects them for this kind.
  // The reload of `review` (with `posted` flags flipped) happens via the already-
  // subscribed prReviewDone push, not here.
  const postComments = useCallback(async (reviewId: number, findingIndexes: number[]): Promise<{ posted: number; skipped: number; errors: string[] }> => {
    return invoke('prReview:postComments', { reviewId, findingIndexes });
  }, []);

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
    pullRequests, syncedAt, loading, error, refresh, loadDiff, loadComments, mergePr, closePr,
    fetchReviewState, approvePr, implementComments,
    review, reviewRunning, openReviewFor, runReview, startReview, cancelReview, getReview, listReviews, latestReviewFor,
    reviewStateFor, postComments,
  };
}
