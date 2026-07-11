import { Box, Typography, Chip, Checkbox } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import { glassFill } from '../../theme/glass.js';

const SEVERITY_COLOR: Record<PrFindingPayload['severity'], 'error' | 'warning' | 'info'> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
};

export function FindingCard({ finding, selected, onToggle }: {
  finding: PrFindingPayload;
  selected?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
      {onToggle && (
        <Checkbox
          size="small"
          checked={Boolean(selected)}
          disabled={finding.posted === true}
          onChange={onToggle}
          sx={{ mt: 0.25, p: 0.5 }}
        />
      )}
      {/* Dense card in a findings list — glassFill (no per-card backdropFilter);
          the drawer paper already frosts the backdrop. Theme-aware so it reads
          correctly in both light and dark mode. */}
      <Box sx={{ flex: 1, ...glassFill(theme, { elevation: 2 }), borderRadius: 2, p: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
          <Chip label={finding.severity} size="small" color={SEVERITY_COLOR[finding.severity]}
            sx={{ height: 16, fontSize: 9.5, textTransform: 'uppercase' }} />
          <Typography component="span" sx={{ fontSize: 10.5, color: 'text.secondary' }}>{finding.category}</Typography>
          {finding.posted === true && (
            <Chip label="posted" size="small" color="success" sx={{ height: 16, fontSize: 9.5 }} />
          )}
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
    </Box>
  );
}
