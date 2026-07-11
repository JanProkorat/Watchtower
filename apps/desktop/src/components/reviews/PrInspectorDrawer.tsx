import { useEffect, useState } from 'react';
import { Drawer, Box, Typography, Tabs, Tab, Alert, CircularProgress, Stack } from '@mui/material';
import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload, PrReviewPayload } from '@watchtower/shared/ipcContract.js';
import { DiffView } from './DiffView.js';
import { CommentThread } from './CommentThread.js';
import { ReviewReport } from './ReviewReport.js';
import { useToast } from '../../state/useToast.js';

export function PrInspectorDrawer({ pr, onClose, loadDiff, loadComments, review, reviewRunning, openReviewFor, runReview }: {
  pr: PullRequestPayload | null; onClose(): void;
  loadDiff(pr: PullRequestPayload): Promise<DiffFilePayload[]>;
  loadComments(pr: PullRequestPayload): Promise<PrCommentThreadPayload[]>;
  review: PrReviewPayload | null;
  reviewRunning: boolean;
  openReviewFor(pr: PullRequestPayload): Promise<void>;
  runReview(pr: PullRequestPayload): Promise<number>;
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
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 1, minHeight: 40 }}>
            <Tab label={`Diff${files.length ? ` (${files.length})` : ''}`} sx={{ minHeight: 40 }} />
            <Tab label={`Comments (${threads.length})`} sx={{ minHeight: 40 }} />
            <Tab label={`Report${review?.status === 'done' ? ` (${review.findings.length})` : ''}`} sx={{ minHeight: 40 }} />
          </Tabs>
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
                <ReviewReport pr={pr} review={review} running={reviewRunning} onRun={handleRun} />
              </Box>
            )}
          </Box>
        </>
      )}
    </Drawer>
  );
}
