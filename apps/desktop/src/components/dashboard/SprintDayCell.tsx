import { Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { DashboardSprintDayPayload } from '@watchtower/shared/ipcContract.js';
import { formatMinutes } from '../../util/format.js';

export interface SprintDayCellProps {
  day: DashboardSprintDayPayload;
  isToday: boolean;
  /** Fixed cell height in px (full cell, header + scrollable body). */
  cellHeight?: number;
}

function shortDate(iso: string): string {
  // iso "2026-05-25" → "25. 5."
  const [, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

function czechWeekdayShort(iso: string): string {
  // Returns e.g. "MO", "TU" via UTC day index to avoid TZ shifts
  const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return DOW[dow] ?? '';
}

function isWeekend(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}

export function SprintDayCell({ day, isToday, cellHeight = 330 }: SprintDayCellProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';

  const bg = isToday
    ? alpha(theme.palette.error.main, dark ? 0.18 : 0.10)
    : isWeekend(day.date)
    ? alpha(theme.palette.primary.main, dark ? 0.06 : 0.04)
    : 'transparent';

  return (
    <Box
      sx={{
        flex: '0 0 180px',
        width: 180,
        height: cellHeight,
        borderRadius: 1.5,
        border: 1,
        borderColor: 'divider',
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box>
          <Typography
            variant="caption"
            sx={{
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'text.secondary',
              display: 'block',
            }}
          >
            {czechWeekdayShort(day.date)}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: isToday ? 'error.main' : 'text.primary',
            }}
          >
            {shortDate(day.date)}
          </Typography>
        </Box>
        {day.minutes > 0 && (
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatMinutes(day.minutes)}
          </Typography>
        )}
      </Stack>

      {/* Body */}
      <Box sx={{ p: 0.75, overflowY: 'auto', flexGrow: 1 }}>
        {day.worklogs.length === 0 ? (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: 'block', textAlign: 'center', mt: 2 }}
          >
            —
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {day.worklogs.map((w) => (
              <Box
                key={w.id}
                // TODO: wire onClick to task detail when Watchtower has a task detail page
                sx={{
                  cursor: 'pointer',
                  borderRadius: 0.75,
                  px: 0.75,
                  py: 0.5,
                  borderLeft: 3,
                  borderColor: w.projectColor ?? 'primary.main',
                  background: alpha(
                    theme.palette.primary.main,
                    dark ? 0.04 : 0.03,
                  ),
                  '&:hover': {
                    background: alpha(
                      theme.palette.primary.main,
                      dark ? 0.10 : 0.06,
                    ),
                  },
                }}
              >
                <Stack direction="row" spacing={0.5} alignItems="baseline">
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, fontFamily: 'monospace' }}
                  >
                    {w.taskNumber ?? w.projectName}
                  </Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, fontFamily: 'monospace' }}
                  >
                    {formatMinutes(w.minutes)}
                  </Typography>
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {w.taskTitle}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
