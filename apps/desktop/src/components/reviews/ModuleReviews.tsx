import { useMemo, useState } from 'react';
import { Box, Typography, Alert, Chip, TextField, Button, Stack, CircularProgress } from '@mui/material';
import { useReviews, applyPrFilter, groupPrsByHost, type HostFilter } from '../../state/useReviews.js';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';
import { PrRow } from './PrRow.js';
import { PrInspectorDrawer } from './PrInspectorDrawer.js';

export function ModuleReviews(): JSX.Element {
  const { pullRequests, syncedAt, loading, error, refresh, loadDiff, loadComments } = useReviews();
  const [host, setHost] = useState<HostFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PullRequestPayload | null>(null);
  const nowMs = Date.now();
  const groups = useMemo(() => groupPrsByHost(applyPrFilter(pullRequests, host, query)), [pullRequests, host, query]);

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Typography variant="h5">Reviews</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {pullRequests.length} open{syncedAt ? ` · synced ${new Date(syncedAt).toLocaleTimeString('cs-CZ')}` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" disabled={loading} onClick={() => void refresh()}>↻ Obnovit</Button>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} alignItems="center">
        {(['all', 'github', 'azdo'] as HostFilter[]).map((h) => (
          <Chip key={h} size="small" label={h === 'all' ? 'Vše' : h === 'github' ? 'GitHub' : 'Azure DevOps'}
            color={host === h ? 'primary' : 'default'} variant={host === h ? 'filled' : 'outlined'}
            onClick={() => setHost(h)} />
        ))}
        <Box sx={{ flex: 1 }} />
        <TextField size="small" placeholder="Hledat PR…" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ width: 220 }} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {loading && pullRequests.length === 0 && <CircularProgress size={20} />}
      {!loading && pullRequests.length === 0 && !error && (
        <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>Žádné otevřené PR. Zkuste Obnovit. Pro Azure DevOps nastavte PAT v úpravě projektu.</Typography>
      )}

      {groups.map((g) => (
        <Box key={g.host} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>{g.label}</Typography>
          <Stack spacing={0.25}>{g.prs.map((pr) => <PrRow key={`${pr.repoKey}-${pr.number}`} pr={pr} nowMs={nowMs} onOpen={setOpen} />)}</Stack>
        </Box>
      ))}

      <PrInspectorDrawer pr={open} onClose={() => setOpen(null)} loadDiff={loadDiff} loadComments={loadComments} />
    </Box>
  );
}
