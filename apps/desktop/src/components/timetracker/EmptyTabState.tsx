import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface Props {
  title: string;
  hint: string;
  /** Optional CTA — Phase 14+ replaces these placeholders with real list/grid views. */
  action?: ReactNode;
}

export function EmptyTabState({ title, hint, action }: Props) {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        textAlign: 'center',
        px: 4,
        py: 8,
        color: 'text.secondary',
      }}
    >
      <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 500 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 520, lineHeight: 1.5 }}>
        {hint}
      </Typography>
      {action ? <Box sx={{ mt: 1 }}>{action}</Box> : null}
    </Box>
  );
}
