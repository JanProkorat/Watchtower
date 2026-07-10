import { Box, Typography, Chip } from '@mui/material';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';
import { relativeAge } from '../../state/useReviews.js';

export function PrRow({ pr, nowMs, onOpen }: { pr: PullRequestPayload; nowMs: number; onOpen(pr: PullRequestPayload): void }): JSX.Element {
  const num = pr.host === 'github' ? `#${pr.number}` : `!${pr.number}`;
  return (
    <Box onClick={() => onOpen(pr)}
      sx={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 90px auto', gap: 1.5, alignItems: 'center',
        px: 1.25, py: 1, borderRadius: 1, cursor: 'pointer',
        '&:hover': { backgroundColor: 'action.hover' } }}>
      <Chip size="small" label={pr.host === 'github' ? 'GH' : 'AZ'}
        sx={{ fontWeight: 700, fontSize: 10, bgcolor: pr.host === 'github' ? 'action.selected' : 'primary.main',
          color: pr.host === 'github' ? 'text.primary' : 'primary.contrastText' }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 13 }}>
          <Box component="span" sx={{ color: 'text.secondary', mr: 0.75, fontVariantNumeric: 'tabular-nums' }}>{num}</Box>
          {pr.title}
        </Typography>
        <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary' }}>
          {pr.repoLabel} · {pr.author} · {pr.sourceBranch}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'right' }}>{relativeAge(pr.updatedAt, nowMs)}</Typography>
      <Typography sx={{ fontSize: 11, color: 'primary.main', textAlign: 'right' }}>{pr.reviewable ? 'Open ▸' : 'Diff ▸'}</Typography>
    </Box>
  );
}
