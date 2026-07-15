import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Alert, Chip, TextField, Button, Stack, CircularProgress, Badge } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useReviews, applyPrFilter, groupPrsByHost, type HostFilter } from '../../state/useReviews.js';
import { usePrWatch } from '../../state/usePrWatch.js';
import type { PullRequestPayload, PrHost } from '@watchtower/shared/ipcContract.js';
import { PrRow } from './PrRow.js';
import { PrInspectorDrawer } from './PrInspectorDrawer.js';
import { glassSurface } from '../../theme/glass.js';
import { useToast, toastMessage } from '../../state/useToast.js';

export function ModuleReviews(props: {
  /** Set when a macOS PR-notification click deep-linked here (App-level). */
  deepLinkTarget?: { host: PrHost; repoKey: string; prNumber: number } | null;
  /** Called once the target PR has been opened, so App can clear it. */
  onConsumeDeepLink?: () => void;
} = {}): JSX.Element {
  const { deepLinkTarget, onConsumeDeepLink } = props;
  const { pullRequests, syncedAt, loading, error, refresh, loadDiff, loadComments, mergePr,
    review, reviewRunning, openReviewFor, runReview, cancelReview, reviewStateFor, postComments,
    fetchReviewState, approvePr } = useReviews();
  const { items: watchItems, unread, error: watchError, markSeen } = usePrWatch();
  const { showError } = useToast();
  const theme = useTheme();
  const [host, setHost] = useState<HostFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PullRequestPayload | null>(null);
  const nowMs = Date.now();
  const groups = useMemo(() => groupPrsByHost(applyPrFilter(pullRequests, host, query)), [pullRequests, host, query]);

  // Open the PR a macOS notification deep-linked to. App owns the 'deep-link'
  // subscription (it must switch to the reviews module, which mounts this
  // component) and passes the target down. This effect re-runs when
  // pullRequests loads, so a target set before the list arrives still opens.
  useEffect(() => {
    if (!deepLinkTarget) return;
    const pr = pullRequests.find(
      (p) => p.host === deepLinkTarget.host && p.repoKey === deepLinkTarget.repoKey && p.number === deepLinkTarget.prNumber,
    );
    if (!pr) return; // list not loaded yet (or PR not in a configured repo) — wait
    setOpen(pr);
    void markSeen(deepLinkTarget.host, deepLinkTarget.repoKey, deepLinkTarget.prNumber).catch((e) => showError(toastMessage(e)));
    onConsumeDeepLink?.();
  }, [deepLinkTarget, pullRequests, markSeen, showError, onConsumeDeepLink]);

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
      {watchError && <Alert severity="error" sx={{ mb: 1.5 }}>PR watch inbox failed to load: {watchError}</Alert>}
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
        cancelReview={cancelReview} postComments={postComments} mergePr={mergePr}
        fetchReviewState={fetchReviewState} approvePr={approvePr} />
    </Box>
  );
}
