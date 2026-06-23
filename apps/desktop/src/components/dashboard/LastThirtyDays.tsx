import { Box, Grid, Paper, Stack, Typography } from '@mui/material';
import Heatmap from '../timetracker/charts/Heatmap.js';
import type { DashboardHeatmapStatsPayload } from '@watchtower/shared/ipcContract.js';
import { formatDateShortCz, formatHours } from '../../util/format.js';

export interface LastThirtyDaysProps {
  fromDate: string;
  toDate: string;
  days: { date: string; minutes: number }[];
  stats: DashboardHeatmapStatsPayload;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography sx={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Stack>
  );
}

export function LastThirtyDays({ fromDate, toDate, days, stats }: LastThirtyDaysProps) {
  const busiest = stats.busiestDay
    ? `${formatDateShortCz(stats.busiestDay.date)} (${formatHours(stats.busiestDay.minutes, 1)}h)`
    : '—';

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>Last 30 days</Typography>
      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} md={7}>
          <Box sx={{ minHeight: 140 }}>
            <Heatmap data={days} from={fromDate} to={toDate} showStats={false} />
          </Box>
        </Grid>
        <Grid item xs={12} md={5}>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Stat label="Current streak" value={`${stats.currentStreak}d`} />
            <Stat label="Longest streak" value={`${stats.longestStreak}d`} />
            <Stat label="Active days" value={String(stats.activeDays)} />
            <Stat label="Weekly avg" value={`${formatHours(stats.weeklyAvgMinutes, 1)}h`} />
            <Stat label="Busiest day" value={busiest} />
          </Stack>
        </Grid>
      </Grid>
    </Paper>
  );
}
