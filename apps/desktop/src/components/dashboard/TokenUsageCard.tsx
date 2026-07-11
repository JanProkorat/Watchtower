import { useEffect, useState } from 'react';
import { Alert, Box, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';
import dayjs from 'dayjs';
import type { TokenUsageState } from '../../state/useTokenUsage.js';
import {
  formatPercent,
  formatRemaining,
  formatTokenCount,
} from '@watchtower/shared/tokenUsageFormat.js';

export interface TokenUsageCardProps {
  usage: TokenUsageState;
}

/** Bar/accent color from ccusage status, falling back to % thresholds. */
function severityColor(status: string | null, pct: number | null): string {
  if (status === 'exceeds') return 'error.main';
  if (status === 'warning') return 'warning.main';
  if (status === 'ok') return 'success.main';
  if (pct != null) {
    if (pct >= 90) return 'error.main';
    if (pct >= 75) return 'warning.main';
  }
  return 'primary.main';
}

function Title() {
  return (
    <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>
      Token usage · 5h block
    </Typography>
  );
}

export function TokenUsageCard({ usage }: TokenUsageCardProps) {
  const { data, loading, error } = usage;

  // Tick every 30s so the reset countdown stays roughly current between the
  // 5-minute ccusage refreshes.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (error) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Title />
        <Alert severity="error">Failed to load token usage: {error}</Alert>
      </Paper>
    );
  }

  if (loading && !data) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Title />
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      </Paper>
    );
  }

  if (data && !data.available) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Title />
        <Typography variant="body2" color="text.secondary">
          {data.error ?? 'Token usage is not available.'}
        </Typography>
      </Paper>
    );
  }

  const block = data?.block ?? null;
  if (!block) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Title />
        <Typography variant="body2" color="text.secondary">
          No active 5h block — start a Claude Code session.
        </Typography>
      </Paper>
    );
  }

  const remaining = formatRemaining(block.endTime, now);
  const resetTime = dayjs(block.endTime).format('H:mm');
  const pct = block.currentPercentUsed;
  const barValue = pct != null ? Math.min(100, Math.max(0, pct)) : 0;
  const color = severityColor(block.status, pct);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Title />

      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {remaining != null ? `resets in ${remaining}` : 'reset —'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          at {resetTime}
        </Typography>
      </Stack>

      {pct != null && (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color }}>
              {formatPercent(pct)}
            </Typography>
            <Typography
              sx={{ fontSize: 13, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatTokenCount(block.totalTokens)}
              {block.limit != null ? ` / ${formatTokenCount(block.limit)}` : ''} tokens
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={barValue}
            sx={{
              height: 8,
              borderRadius: 1,
              backgroundColor: 'background.default',
              '& .MuiLinearProgress-bar': { backgroundColor: color },
            }}
          />
        </>
      )}

      {pct == null && (
        <Typography
          sx={{ fontSize: 13, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatTokenCount(block.totalTokens)} tokens
        </Typography>
      )}

      <Stack direction="row" spacing={2} sx={{ mt: 1.25 }} flexWrap="wrap">
        {block.burnRateTokensPerMinute != null && (
          <Tooltip title="Current consumption rate">
            <Typography
              sx={{ fontSize: 12.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
            >
              rate {formatTokenCount(block.burnRateTokensPerMinute)}/min
            </Typography>
          </Tooltip>
        )}
        {block.projectedPercentUsed != null && (
          <Tooltip title="Estimated usage at end of block at the current rate">
            <Typography
              sx={{ fontSize: 12.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
            >
              projected end-of-block {formatPercent(block.projectedPercentUsed)}
            </Typography>
          </Tooltip>
        )}
      </Stack>
    </Paper>
  );
}
