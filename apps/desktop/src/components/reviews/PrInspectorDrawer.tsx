import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, Tabs, Tab, Alert, CircularProgress, Stack } from '@mui/material';
import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload, PrReviewPayload, PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';
import { DiffView } from './DiffView.js';
import { CommentThread } from './CommentThread.js';
import { ReviewReport } from './ReviewReport.js';
import { MergeButton } from './MergeButton.js';
import { useToast } from '../../state/useToast.js';

export function PrInspectorDrawer({ pr, onClose, loadDiff, loadComments, review, reviewRunning, openReviewFor, runReview, cancelReview, postComments, watchItem, mergePr }: {
  pr: PullRequestPayload | null; onClose(): void;
  loadDiff(pr: PullRequestPayload): Promise<DiffFilePayload[]>;
  loadComments(pr: PullRequestPayload): Promise<PrCommentThreadPayload[]>;
  review: PrReviewPayload | null;
  reviewRunning: boolean;
  openReviewFor(pr: PullRequestPayload): Promise<void>;
  runReview(pr: PullRequestPayload): Promise<number>;
  cancelReview(pr: PullRequestPayload): Promise<void>;
  postComments(reviewId: number, findingIndexes: number[]): Promise<{ posted: number; skipped: number; errors: string[] }>;
  // The matching prWatch inbox item for the open PR (looked up by ModuleReviews from
  // the already-loaded watchItems — no extra IPC round-trip). Null when the PR has
  // never been polled by the watch inbox yet.
  watchItem: PrWatchInboxItem | null;
  mergePr(host: PullRequestPayload['host'], repoKey: string, prNumber: number, deleteBranch: boolean): Promise<void>;
}): JSX.Element {
  const [tab, setTab] = useState(0);
  const [files, setFiles] = useState<DiffFilePayload[]>([]);
  const [threads, setThreads] = useState<PrCommentThreadPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showError } = useToast();

  useEffect(() => {
    if (!pr) return;
    setTab(0); setFiles([]); setThreads([]); setError(null); setLoading(true);
    void Promise.all([
      loadDiff(pr).then(setFiles).catch((e) => setError(e instanceof Error ? e.message : String(e))),
      // A comments-fetch failure must not blank the diff — degrade to 0 threads.
      loadComments(pr).then(setThreads).catch(() => setThreads([])),
    ]).finally(() => setLoading(false));
    // The report tab needs the latest review as soon as the drawer opens, so its tab
    // label can show a finding count without waiting for the user to click it. Runs
    // independently of the diff/comments load so a slow review lookup can't stall them.
    void openReviewFor(pr).catch((e) => showError(e instanceof Error ? e.message : String(e)));
  }, [pr, loadDiff, loadComments, openReviewFor]);

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
            {/* Only the PR's own author can merge — a reviewer-role PR (or one the
                watch inbox hasn't polled yet) shows no merge button at all. */}
            {watchItem && watchItem.myRole === 'author' && (
              <MergeButton
                approved={watchItem.approved}
                mergeable={watchItem.mergeable}
                mergeBlockedReason={watchItem.mergeBlockedReason}
                onMerge={handleMerge}
              />
            )}
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {tab === 0 && (
              <>
                {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
                {loading && <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>}
                {!loading && !error && <DiffView files={files} threads={threads} findings={review?.status === 'done' ? review.findings : []} />}
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
                  return (
                    <Stack spacing={1}>
                      {general.length > 0 && (
                        <>
                          <Typography sx={{ fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'text.secondary' }}>
                            General
                          </Typography>
                          {general.map((t) => <CommentThread key={t.id} thread={t} />)}
                        </>
                      )}
                      {anchored.map((t) => <CommentThread key={t.id} thread={t} />)}
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
