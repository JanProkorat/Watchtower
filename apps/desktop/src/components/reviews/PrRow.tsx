import { Box, Typography, Chip, Button } from '@mui/material';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';
import { relativeAge } from '../../state/useReviews.js';

export function initials(author: string): string {
  const parts = author.split(/[.\s_@-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (author.slice(0, 2) || '?').toUpperCase();
}

const AVATAR_COLORS = ['#7c5cff', '#22d3ee', '#22c55e', '#f59e0b', '#ef4444', '#3b8fe0', '#c75b86'];

export function avatarColor(author: string): string {
  let h = 0;
  for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

export function PrRow({ pr, nowMs, onOpen }: { pr: PullRequestPayload; nowMs: number; onOpen(pr: PullRequestPayload): void }): JSX.Element {
  const num = pr.host === 'github' ? `#${pr.number}` : `!${pr.number}`;
  return (
    <Box onClick={() => onOpen(pr)}
      sx={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto auto', gap: 1.5, alignItems: 'center',
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 11, color: 'text.secondary',
          whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{pr.repoLabel}</Box>
          <Box sx={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, fontSize: 9, fontWeight: 700,
            color: '#12131a', display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: avatarColor(pr.author) }}>
            {initials(pr.author)}
          </Box>
          <Box component="span">{pr.author}</Box>
          <Box component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9.5,
            bgcolor: 'action.selected', px: 0.5, borderRadius: 0.5, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis', maxWidth: 180 }}>
            {pr.sourceBranch}
          </Box>
          <Box component="span">{relativeAge(pr.updatedAt, nowMs)}</Box>
        </Box>
      </Box>
      <Box sx={{ width: 116, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.6, fontSize: 10 }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled' }} />
        <Box component="span" sx={{ color: 'text.secondary' }}>not reviewed</Box>
      </Box>
      <Button size="small" variant="text" onClick={() => onOpen(pr)} sx={{ minWidth: 0, fontSize: 11 }}>
        Open ▸
      </Button>
    </Box>
  );
}
