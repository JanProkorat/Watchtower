import { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Alert, CircularProgress, Stack,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { PullRequestPayload, PrReviewPayload } from '@watchtower/shared/ipcContract.js';
import { sortFindingsWithIndex } from '../../state/useReviews.js';
import { FindingCard } from './FindingCard.js';
import { glassFill } from '../../theme/glass.js';
import { useToast } from '../../state/useToast.js';

export function ReviewReport({ pr, review, running, onRun, onCancel, postComments }: {
  pr: PullRequestPayload;
  review: PrReviewPayload | null;
  running: boolean;
  onRun(): void;
  onCancel(): void;
  postComments(reviewId: number, findingIndexes: number[]): Promise<{ posted: number; skipped: number; errors: string[] }>;
}): JSX.Element {
  const theme = useTheme();
  const isRunning = running || review?.status === 'running';
  const { showError, showSuccess } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  // Selection is per-review — switching PRs, or a re-run that mints a new review
  // row with a new id, must not carry stale indices into the new findings array.
  useEffect(() => { setSelected(new Set()); }, [review?.id]);

  if (!review && !isRunning) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 13, mb: 1.5 }}>Not yet reviewed.</Typography>
        <Button variant="contained" onClick={onRun}>Run review ▸</Button>
      </Box>
    );
  }

  if (isRunning) {
    return (
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <CircularProgress size={20} />
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Reviewing… (Opus in a worktree)</Typography>
        <Button size="small" color="error" onClick={onCancel}>Cancel</Button>
      </Box>
    );
  }

  if (review?.status === 'error') {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" sx={{ mb: 1.5 }}>{review.error}</Alert>
        <Button variant="contained" onClick={onRun}>Re-run</Button>
      </Box>
    );
  }

  // status === 'done'
  const indexed = sortFindingsWithIndex(review?.findings ?? []);

  const toggle = (index: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const handlePost = (): void => {
    if (posting) return;
    if (!review) return;
    setConfirmOpen(false);
    const indexes = [...selected];
    setPosting(true);
    postComments(review.id, indexes)
      .then((res) => {
        if (res.errors.length === 0) setSelected(new Set());
        if (res.errors.length > 0) {
          showError(`Posted ${res.posted}${res.skipped ? `, ${res.skipped} skipped` : ''}, ${res.errors.length} failed: ${res.errors.join('; ')}`);
        } else {
          showSuccess(`Posted ${res.posted} comment${res.posted === 1 ? '' : 's'}${res.skipped ? ` (${res.skipped} skipped)` : ''}.`);
        }
      })
      .catch((e) => showError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPosting(false));
  };

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* Review summary — theme-aware glassFill (drawer backdrop is already frosted). */}
        <Box sx={{ ...glassFill(theme, { elevation: 3 }), borderRadius: 2, p: 1.25, mb: 1.5 }}>
          <Typography sx={{ fontSize: 12.5 }}>{review?.summary}</Typography>
        </Box>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
          {indexed.length === 0 ? 'No findings' : `${indexed.length} finding${indexed.length === 1 ? '' : 's'}`}
        </Typography>
        <Stack spacing={1}>
          {indexed.map(({ finding, index }) => (
            <FindingCard
              key={`${finding.file}:${finding.line}:${index}`}
              finding={finding}
              selected={selected.has(index)}
              onToggle={() => toggle(index)}
            />
          ))}
        </Stack>
      </Box>

      {indexed.length > 0 && (
        <Box sx={{ pt: 1.5, mt: 1, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" disabled={selected.size === 0 || posting} onClick={() => setConfirmOpen(true)}>
            Post {selected.size} comment{selected.size === 1 ? '' : 's'}
          </Button>
        </Box>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Post {selected.size} comment{selected.size === 1 ? '' : 's'}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This posts the selected findings as comments on the pull request.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={posting} onClick={handlePost}>Post</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
