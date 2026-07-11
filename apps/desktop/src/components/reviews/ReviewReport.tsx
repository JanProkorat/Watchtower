import { Box, Typography, Button, Alert, CircularProgress, Stack } from '@mui/material';
import type { PullRequestPayload, PrReviewPayload } from '@watchtower/shared/ipcContract.js';
import { sortFindings } from '../../state/useReviews.js';
import { FindingCard } from './FindingCard.js';

export function ReviewReport({ pr, review, running, onRun }: {
  pr: PullRequestPayload;
  review: PrReviewPayload | null;
  running: boolean;
  onRun(): void;
}): JSX.Element {
  const isRunning = running || review?.status === 'running';

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
  const findings = sortFindings(review?.findings ?? []);
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ bgcolor: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 2, p: 1.25, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)', mb: 1.5 }}>
        <Typography sx={{ fontSize: 12.5 }}>{review?.summary}</Typography>
      </Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
        {findings.length === 0 ? 'No findings' : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}
      </Typography>
      <Stack spacing={1}>
        {findings.map((f, i) => <FindingCard key={`${f.file}:${f.line}:${i}`} finding={f} />)}
      </Stack>
    </Box>
  );
}
