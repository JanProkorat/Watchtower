import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Alert, Chip, TextField, Button, Stack, CircularProgress, Badge } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useReviews, applyPrFilter, groupPrsByHost, type HostFilter } from '../../state/useReviews.js';
import { usePrWatch } from '../../state/usePrWatch.js';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';
import { PrRow } from './PrRow.js';
import { PrInspectorDrawer } from './PrInspectorDrawer.js';
import { glassSurface } from '../../theme/glass.js';
import { useToast, toastMessage } from '../../state/useToast.js';

export function ModuleReviews(): JSX.Element {
  const { pullRequests, syncedAt, loading, error, refresh, loadDiff, loadComments, mergePr,
    review, reviewRunning, openReviewFor, runReview, cancelReview, reviewStateFor, postComments } = useReviews();
  const { items: watchItems, unread, markSeen } = usePrWatch();
  const { showError } = useToast();
  const theme = useTheme();
  const [host, setHost] = useState<HostFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PullRequestPayload | null>(null);
  const nowMs = Date.now();
  const groups = useMemo(() => groupPrsByHost(applyPrFilter(pullRequests, host, query)), [pullRequests, host, query]);
  // The prWatch inbox item for the currently open PR (Task 11's Merge button reads
  // approved/mergeable/mergeBlockedReason/myRole from it) — reuses the already-loaded
  // watchItems rather than a fresh IPC round-trip.
  const openWatchItem = useMemo(() => {
    if (!open) return null;
    return watchItems.find((w) => w.host === open.host && w.repoKey === open.repoKey && w.prNumber === open.number) ?? null;
  }, [open, watchItems]);

  // Opened via a macOS notification click while the app was already running
  // (see electron/ipc.ts + electron/preload.ts). A cold-start deep-link sent
  // before this hook subscribes is a known, deferred limitation.
  useEffect(() => {
    return window.watchtower.on('deep-link', (d) => {
      if (d.module !== 'reviews') return;
      const pr = pullRequests.find((p) => p.host === d.host && p.repoKey === d.repoKey && p.number === d.prNumber);
      if (!pr) return;
      setOpen(pr);
      void markSeen(d.host, d.repoKey, d.prNumber).catch((e) => showError(toastMessage(e)));
    });
  }, [pullRequests, markSeen, showError]);

  // Manual open (row click, not deep-link): also clear the unread flag when
  // the opened PR is one the watch inbox is tracking.
  const openPr = (pr: PullRequestPayload) => {
    setOpen(pr);
    if (watchItems.some((w) => w.host === pr.host && w.repoKey === pr.repoKey && w.prNumber === pr.number)) {
      void markSeen(pr.host, pr.repoKey, pr.number).catch((e) => showError(toastMessage(e)));
    }
  };

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Badge badgeContent={unread} color="error">
          <Typography variant="h5">Reviews</Typography>
        </Badge>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {pullRequests.length} open{syncedAt ? ` · synced ${new Date(syncedAt).toLocaleTimeString('cs-CZ')}` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" disabled={loading} onClick={() => void refresh()}>↻ Refresh</Button>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} alignItems="center">
        {(['all', 'github', 'azdo'] as HostFilter[]).map((h) => (
          <Chip key={h} size="small" label={h === 'all' ? 'All' : h === 'github' ? 'GitHub' : 'Azure DevOps'}
            color={host === h ? 'primary' : 'default'} variant={host === h ? 'filled' : 'outlined'}
            onClick={() => setHost(h)} />
        ))}
        <Box sx={{ flex: 1 }} />
        <TextField size="small" placeholder="Search PRs…" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ width: 220 }} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {loading && pullRequests.length === 0 && <CircularProgress size={20} />}
      {!loading && pullRequests.length === 0 && !error && (
        <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>No open PRs. Try Refresh. For Azure DevOps, set a PAT in the project editor.</Typography>
      )}

      {groups.map((g) => (
        <Box key={g.host} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>{g.label}</Typography>
          {/* One frosted panel per host group — glassSurface = a single blur pass
              for the whole list; the PrRows inside stay bare (hover only). */}
          <Box sx={{ ...glassSurface(theme, { elevation: 1 }), borderRadius: 2, p: 0.75 }}>
            <Stack spacing={0.25}>{g.prs.map((pr) => (
              <PrRow key={`${pr.repoKey}-${pr.number}`} pr={pr} nowMs={nowMs} onOpen={openPr} reviewState={reviewStateFor(pr)}
                onReview={(p) => { openPr(p); void runReview(p).catch((e) => showError(toastMessage(e))); }}
                onCancel={(p) => void cancelReview(p).catch((e) => showError(toastMessage(e)))} />
            ))}</Stack>
          </Box>
        </Box>
      ))}

      <PrInspectorDrawer pr={open} onClose={() => setOpen(null)} loadDiff={loadDiff} loadComments={loadComments}
        review={review} reviewRunning={reviewRunning} openReviewFor={openReviewFor} runReview={runReview}
        cancelReview={cancelReview} postComments={postComments} watchItem={openWatchItem} mergePr={mergePr} />
    </Box>
  );
}
