import { Box, Paper, Stack, Typography } from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { formatEarnings, formatHours } from '../../util/format.js';

export interface KpiTilesProps {
  todayMinutes: number;
  sprintMinutes: number;
  monthMinutes: number;
  todayEarned: number;
  sprintEarned: number;
  monthEarned: number;
}

interface TileProps {
  label: string;
  minutes: number;
  earned: number;
}

function Tile({ label, minutes, earned }: TileProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        flex: 1,
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(179,136,255,0.14)' : 'rgba(98,0,234,0.10)'),
            color: 'primary.main',
          }}
        >
          <CalendarTodayIcon sx={{ fontSize: 16 }} />
        </Box>
        <Typography
          variant="caption"
          sx={{ textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary', fontWeight: 500 }}
        >
          {label}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography sx={{ fontSize: 36, fontWeight: 600, lineHeight: 1 }}>
          {formatHours(minutes, 1)}
        </Typography>
        <Typography variant="body2" color="text.secondary">hours</Typography>
      </Stack>
      {earned > 0 && (
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', mt: 1 }}
        >
          {formatEarnings(earned)}
        </Typography>
      )}
    </Paper>
  );
}

export function KpiTiles({
  todayMinutes,
  sprintMinutes,
  monthMinutes,
  todayEarned,
  sprintEarned,
  monthEarned,
}: KpiTilesProps) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <Tile label="Today" minutes={todayMinutes} earned={todayEarned} />
      <Tile label="This sprint" minutes={sprintMinutes} earned={sprintEarned} />
      <Tile label="This month" minutes={monthMinutes} earned={monthEarned} />
    </Stack>
  );
}
