import { Box, Typography, Chip } from '@mui/material';
import type { PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';

export function formatCommentDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('cs-CZ');
}

export function CommentThread({ thread }: { thread: PrCommentThreadPayload }): JSX.Element {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
      {thread.file && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
          <Typography component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'primary.main' }}>
            {thread.file}
            {thread.line != null ? `:${thread.line}` : ''}
          </Typography>
          {thread.status && (
            <Chip label={thread.status} size="small" sx={{ height: 16, fontSize: 9.5 }} />
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {thread.comments.map((c, i) => (
          <Box key={i}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
              <Typography component="span" sx={{ fontWeight: 700, fontSize: 12 }}>{c.author}</Typography>
              <Typography component="span" sx={{ fontSize: 10, color: 'text.secondary' }}>{formatCommentDate(c.date)}</Typography>
            </Box>
            <Typography sx={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{c.body}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
