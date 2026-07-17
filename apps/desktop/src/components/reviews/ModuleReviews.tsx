import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Alert, Chip, TextField, Button, Stack, CircularProgress } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useReviews, applyPrFilter, groupPrsByProject, type HostFilter } from '../../state/useReviews.js';
import type { PullRequestPayload, PrHost, PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';
import { PrRow } from './PrRow.js';
import { PrInspectorDrawer } from './PrInspectorDrawer.js';
import { glassSurface } from '../../theme/glass.js';
import { useToast, toastMessage } from '../../state/useToast.js';

export function ModuleReviews({ deepLinkTarget = null, onConsumeDeepLink, watchItems, markSeen, watchError = null }: {
  /** Set when a PR notification (macOS click or in-app popover) deep-linked here (App-level). */
  deepLinkTarget?: { host: PrHost; repoKey: string; prNumber: number; focus?: 'comments' } | null;
  /** Called once the target PR has been opened, so App can clear it. */
  onConsumeDeepLink?: () => void;
  /** PR-watch inbox — owned by App so the rail bell and these row badges share one source. */
  watchItems: PrWatchInboxItem[];
  markSeen: (host: PrHost, repoKey: string, prNumber: number) => Promise<void>;
  watchError?: string | null;
}): JSX.Element {
  const { pullRequests, syncedAt, loading, error, refresh, loadDiff, loadComments, mergePr, closePr,
    review, reviewRunning, openReviewFor, runReview, cancelReview, reviewStateFor, postComments,
    fetchReviewState, approvePr } = useReviews();
  const { showError } = useToast();
  const theme = useTheme();
  const [host, setHost] = useState<HostFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PullRequestPayload | null>(null);
  // Whether the currently-open PR was opened from a notification (→ Comments tab + highlight).
  const [openFocusComments, setOpenFocusComments] = useState(false);
  const nowMs = Date.now();
  const groups = useMemo(() => groupPrsByProject(applyPrFilter(pullRequests, host, query)), [pullRequests, host, query]);
  // PRs with an unread notification — drives the per-row badge in the list.
  const unreadKeys = useMemo(
    () => new Set(watchItems.filter((w) => w.unread).map((w) => `${w.host}:${w.repoKey}:${w.prNumber}`)),
    [watchItems],
  );

  // Open the PR a notification deep-linked to. App owns the subscription (it must
  // switch to the reviews module, which mounts this component) and passes the
  // target down. Re-runs when pullRequests loads, so a target set before the
  // list arrives still opens. `focus: 'comments'` (in-app popover click) opens
  // the drawer straight to the Comments tab with the newest thread highlighted.
  useEffect(() => {
    if (!deepLinkTarget) return;
    const pr = pullRequests.find(
      (p) => p.host === deepLinkTarget.host && p.repoKey === deepLinkTarget.repoKey && p.number === deepLinkTarget.prNumber,
    );
    if (!pr) return; // list not loaded yet (or PR not in a configured repo) — wait
    setOpen(pr);
    setOpenFocusComments(deepLinkTarget.focus === 'comments');
    void markSeen(deepLinkTarget.host, deepLinkTarget.repoKey, deepLinkTarget.prNumber).catch((e) => showError(toastMessage(e)));
    onConsumeDeepLink?.();
  }, [deepLinkTarget, pullRequests, markSeen, showError, onConsumeDeepLink]);

  // Manual open (row click, not a notification): open on the default tab and
  // clear the unread flag when the opened PR is one the watch inbox tracks.
  const openPr = (pr: PullRequestPayload) => {
    setOpen(pr);
    setOpenFocusComments(false);
    if (watchItems.some((w) => w.host === pr.host && w.repoKey === pr.repoKey && w.prNumber === pr.number)) {
      void markSeen(pr.host, pr.repoKey, pr.number).catch((e) => showError(toastMessage(e)));
    }
  };

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Typography variant="h5">Reviews</Typography>
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

      {watchError && <Alert severity="error" sx={{ mb: 1.5 }}>PR watch inbox failed to load: {watchError}</Alert>}
      {loading && pullRequests.length === 0 && <CircularProgress size={20} />}
      {!loading && pullRequests.length === 0 && !error && (
        <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>No open PRs. Try Refresh. For Azure DevOps, set a PAT in the project editor.</Typography>
      )}

      {groups.map((g) => (
        <Box key={g.label} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>{g.label}</Typography>
          {/* One frosted panel per host group — glassSurface = a single blur pass
              for the whole list; the PrRows inside stay bare (hover only). */}
          <Box sx={{ ...glassSurface(theme, { elevation: 1 }), borderRadius: 2, p: 0.75 }}>
            <Stack spacing={0.25}>{g.prs.map((pr) => (
              <PrRow key={`${pr.repoKey}-${pr.number}`} pr={pr} nowMs={nowMs} onOpen={openPr} reviewState={reviewStateFor(pr)}
                unread={unreadKeys.has(`${pr.host}:${pr.repoKey}:${pr.number}`)}
                onReview={(p) => { openPr(p); void runReview(p).catch((e) => showError(toastMessage(e))); }}
                onCancel={(p) => void cancelReview(p).catch((e) => showError(toastMessage(e)))} />
            ))}</Stack>
          </Box>
        </Box>
      ))}

      <PrInspectorDrawer pr={open} focusComments={openFocusComments} onClose={() => setOpen(null)} loadDiff={loadDiff} loadComments={loadComments}
        review={review} reviewRunning={reviewRunning} openReviewFor={openReviewFor} runReview={runReview}
        cancelReview={cancelReview} postComments={postComments} mergePr={mergePr} closePr={closePr}
        fetchReviewState={fetchReviewState} approvePr={approvePr} />
    </Box>
  );
}
