import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, Tabs, Tab, CircularProgress, Stack, Button } from '@mui/material';
import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload, PrReviewPayload } from '@watchtower/shared/ipcContract.js';
import { DiffView } from './DiffView.js';
import { CommentThread, newestThreadId } from './CommentThread.js';
import { ReviewReport } from './ReviewReport.js';
import { MergeButton } from './MergeButton.js';
import { useToast } from '../../state/useToast.js';
import { countImplementableComments, type PrReviewState } from '../../state/useReviews.js';

export function PrInspectorDrawer({ pr, onClose, loadDiff, loadComments, review, reviewRunning, openReviewFor, runReview, cancelReview, postComments, mergePr, closePr, fetchReviewState, approvePr, implementComments, onImplementLaunched, focusComments = false }: {
  pr: PullRequestPayload | null; onClose(): void;
  /** Opened from a notification — jump to the Comments tab and highlight the newest thread. */
  focusComments?: boolean;
  loadDiff(pr: PullRequestPayload): Promise<DiffFilePayload[]>;
  loadComments(pr: PullRequestPayload): Promise<PrCommentThreadPayload[]>;
  review: PrReviewPayload | null;
  reviewRunning: boolean;
  openReviewFor(pr: PullRequestPayload): Promise<void>;
  runReview(pr: PullRequestPayload): Promise<number>;
  cancelReview(pr: PullRequestPayload): Promise<void>;
  postComments(reviewId: number, findingIndexes: number[]): Promise<{ posted: number; skipped: number; errors: string[] }>;
  mergePr(host: PullRequestPayload['host'], repoKey: string, prNumber: number, deleteBranch: boolean): Promise<void>;
  closePr(host: PullRequestPayload['host'], repoKey: string, prNumber: number): Promise<void>;
  fetchReviewState(host: PullRequestPayload['host'], repoKey: string, number: number): Promise<PrReviewState>;
  approvePr(host: PullRequestPayload['host'], repoKey: string, number: number): Promise<void>;
  implementComments(pr: PullRequestPayload): Promise<{ instanceId: string | null; worktreePath: string | null }>;
  onImplementLaunched(instanceId: string): void;
}): JSX.Element {
  const [tab, setTab] = useState(0);
  const [files, setFiles] = useState<DiffFilePayload[]>([]);
  const [threads, setThreads] = useState<PrCommentThreadPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewState, setReviewState] = useState<PrReviewState | null>(null);
  const [reviewStateLoading, setReviewStateLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  // Two-step confirm for the destructive close/abandon: first click arms,
  // second executes; arming auto-reverts after 3s if not confirmed.
  const [closeArmed, setCloseArmed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [implementing, setImplementing] = useState(false);
  const { showError } = useToast();
  const implementCount = countImplementableComments(threads);

  useEffect(() => {
    if (!closeArmed) return;
    const t = setTimeout(() => setCloseArmed(false), 3000);
    return () => clearTimeout(t);
  }, [closeArmed]);

  // A fast PR switch can let a slow fetch resolve into the newer PR's state (same
  // uncancelled-set race as loadDiff→setFiles below); acceptable and out of scope.
  const loadReviewState = (target: PullRequestPayload): void => {
    setReviewStateLoading(true);
    void fetchReviewState(target.host, target.repoKey, target.number)
      .then(setReviewState)
      .catch((e) => showError(e instanceof Error ? e.message : String(e)))
      .finally(() => setReviewStateLoading(false));
  };

  useEffect(() => {
    if (!pr) return;
    setTab(focusComments ? 1 : 0); setFiles([]); setThreads([]); setLoading(true);
    setReviewState(null); setCloseArmed(false);
    void Promise.all([
      loadDiff(pr).then(setFiles).catch(() => { /* surfaced via the global error toast */ }),
      // A comments-fetch failure must not blank the diff — degrade to 0 threads.
      loadComments(pr).then(setThreads).catch(() => setThreads([])),
    ]).finally(() => setLoading(false));
    // The report tab needs the latest review as soon as the drawer opens, so its tab
    // label can show a finding count without waiting for the user to click it. Runs
    // independently of the diff/comments load so a slow review lookup can't stall them.
    void openReviewFor(pr).catch((e) => showError(e instanceof Error ? e.message : String(e)));
    // Fresh approve/mergeable state for the action row — independent of the loads
    // above so a failure here can't blank the diff (or vice versa).
    loadReviewState(pr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr, loadDiff, loadComments, openReviewFor, focusComments]);

  const handleRun = (): void => {
    if (!pr) return;
    runReview(pr).catch((e) => showError(e instanceof Error ? e.message : String(e)));
  };

  const handleCancel = (): void => {
    if (!pr) return;
    cancelReview(pr).catch((e) => showError(e instanceof Error ? e.message : String(e)));
  };

  const handleMerge = async (deleteBranch: boolean): Promise<void> => {
    if (!pr) return;
    try {
      await mergePr(pr.host, pr.repoKey, pr.number, deleteBranch);
      // Success: the merged PR is evicted from `pullRequests` by mergePr's
      // refresh, so close the drawer rather than leave it rendering the stale
      // (now-gone) PR. On failure we keep it open and surface the error.
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClose = async (): Promise<void> => {
    if (!pr) return;
    if (!closeArmed) { setCloseArmed(true); return; }
    setClosing(true);
    try {
      await closePr(pr.host, pr.repoKey, pr.number);
      // Success: the closed PR is evicted by closePr's refresh — close the
      // drawer rather than leave it rendering the now-gone PR.
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setClosing(false);
      setCloseArmed(false);
    }
  };

  const handleApprove = async (): Promise<void> => {
    if (!pr) return;
    setApproving(true);
    try {
      await approvePr(pr.host, pr.repoKey, pr.number);
      // Re-fetch so Merge lights up immediately without waiting for the drawer
      // to be reopened.
      loadReviewState(pr);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  };

  const handleImplement = async (): Promise<void> => {
    if (!pr) return;
    setImplementing(true);
    try {
      const { instanceId } = await implementComments(pr);
      if (instanceId) onImplementLaunched(instanceId);
    } catch {
      // invoke() already surfaced the failure via a global error toast (repo
      // CLAUDE.md "Surfacing IPC errors"); the catch exists only so the void'd
      // click promise doesn't reject unhandled — the finally resets the spinner.
    } finally {
      setImplementing(false);
    }
  };

  return (
    <Drawer anchor="right" open={pr != null} onClose={onClose} PaperProps={{ sx: { width: 'min(1200px, 92vw)', maxWidth: '92vw', display: 'flex', flexDirection: 'column' } }}>
      {pr && (
        <>
          <Box sx={{ p: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              {(pr.host === 'github' ? '#' : '!') + pr.number} · {pr.title}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
              {pr.repoLabel} · {pr.sourceBranch} → {pr.targetBranch} · {pr.author}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', px: 1 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flex: 1, minHeight: 40 }}>
              <Tab label={`Diff${files.length ? ` (${files.length})` : ''}`} sx={{ minHeight: 40 }} />
              <Tab label={`Comments (${threads.length})`} sx={{ minHeight: 40 }} />
              <Tab label={`Report${review?.status === 'done' ? ` (${review.findings.length})` : ''}`} sx={{ minHeight: 40 }} />
            </Tabs>
            {reviewStateLoading && !reviewState && <CircularProgress size={16} sx={{ mr: 1 }} />}
            {/* Close-without-merge, author-only (closing someone else's PR is
                rare and error-prone). Worded per host; two-step inline confirm. */}
            {reviewState?.amIAuthor && (
              <Button variant="outlined" size="small" color="error" disabled={closing}
                onClick={() => void handleClose()} sx={{ mr: 1 }}>
                {closeArmed ? 'Confirm close?' : pr.host === 'github' ? 'Close PR' : 'Abandon PR'}
              </Button>
            )}
            {/* Launches the implement-comments agent — author-only, and only when
                there's at least one implementable review comment to act on. */}
            {reviewState?.amIAuthor && implementCount > 0 && (
              <Button variant="outlined" size="small" disabled={implementing}
                onClick={() => void handleImplement()} sx={{ mr: 1 }}>
                Fix with agent ({implementCount})
              </Button>
            )}
            {/* Hidden on my own PRs — GitHub rejects self-approval and ADO's is
                pointless. Shown for anyone else's PR regardless of my role. */}
            {reviewState && !reviewState.amIAuthor && (
              <Button variant="outlined" size="small" disabled={approving} onClick={() => void handleApprove()} sx={{ mr: 1 }}>
                Approve
              </Button>
            )}
            {/* Merge is available for any approved + mergeable PR, regardless of
                who authored it — state comes live from prs:reviewState, not the
                (potentially stale) background watch-inbox item. */}
            <MergeButton
              approved={reviewState?.approved ?? false}
              mergeable={reviewState?.mergeable ?? false}
              mergeBlockedReason={reviewState?.mergeBlockedReason ?? null}
              onMerge={handleMerge}
            />
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {tab === 0 && (
              <>
                {loading && <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>}
                {!loading && <DiffView files={files} threads={threads} findings={review?.status === 'done' ? review.findings : []} />}
              </>
            )}
            {tab === 1 && (
              <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
                {loading && <CircularProgress size={20} />}
                {!loading && threads.length === 0 && (
                  <Typography color="text.secondary">No comments.</Typography>
                )}
                {!loading && threads.length > 0 && (() => {
                  const general = threads.filter((t) => t.file == null);
                  const anchored = threads.filter((t) => t.file != null);
                  // Highlight the newest thread only when opened from a notification.
                  const highlightId = focusComments ? newestThreadId(threads) : null;
                  return (
                    <Stack spacing={1}>
                      {general.length > 0 && (
                        <>
                          <Typography sx={{ fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'text.secondary' }}>
                            General
                          </Typography>
                          {general.map((t) => <CommentThread key={t.id} thread={t} highlight={t.id === highlightId} />)}
                        </>
                      )}
                      {anchored.map((t) => <CommentThread key={t.id} thread={t} highlight={t.id === highlightId} />)}
                    </Stack>
                  );
                })()}
              </Box>
            )}
            {tab === 2 && (
              <Box sx={{ height: '100%', overflow: 'auto' }}>
                <ReviewReport pr={pr} review={review} running={reviewRunning} onRun={handleRun} onCancel={handleCancel} postComments={postComments} />
              </Box>
            )}
          </Box>
        </>
      )}
    </Drawer>
  );
}
