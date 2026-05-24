import type { ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

interface Props {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  height?: number | 'auto';
  children: ReactNode;
}

export default function ChartCard({ title, subtitle, toolbar, height = 320, children }: Props) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {toolbar}
      </Stack>
      <Box sx={{ width: '100%', height: height === 'auto' ? 'auto' : height }}>{children}</Box>
    </Paper>
  );
}
