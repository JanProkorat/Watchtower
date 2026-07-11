import { Box, Typography, Chip } from '@mui/material';
import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';

const SEVERITY_COLOR: Record<PrFindingPayload['severity'], 'error' | 'warning' | 'info'> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
};

export function FindingCard({ finding }: { finding: PrFindingPayload }): JSX.Element {
  return (
    <Box sx={{ bgcolor: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 2, p: 1.25, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Chip label={finding.severity} size="small" color={SEVERITY_COLOR[finding.severity]}
          sx={{ height: 16, fontSize: 9.5, textTransform: 'uppercase' }} />
        <Typography component="span" sx={{ fontSize: 10.5, color: 'text.secondary' }}>{finding.category}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'primary.main' }}>
          {finding.file}:{finding.line}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 12.5 }}>{finding.summary}</Typography>
      {finding.detail && (
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', whiteSpace: 'pre-wrap', mt: 0.5 }}>
          {finding.detail}
        </Typography>
      )}
    </Box>
  );
}
