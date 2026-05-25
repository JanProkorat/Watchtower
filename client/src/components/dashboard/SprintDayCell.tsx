import { Box, Stack, Typography } from '@mui/material';
import type { DashboardSprintDayPayload } from '../../../../shared/ipcContract.js';
import { formatMinutes } from '../../util/format.js';

const CZECH_DOW_BY_JS_DAY = ['NE', 'PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO'];

function czechWeekdayOf(iso: string): string {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sun
  return CZECH_DOW_BY_JS_DAY[dow];
}

export interface SprintDayCellProps {
  day: DashboardSprintDayPayload;
  /** True for today's column. */
  isToday: boolean;
  /** Override the default 200px minimum height. */
  cellMinHeight?: number;
}

function shortDate(iso: string): string {
  // iso "2026-05-25" → "25. 5."
  const [, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

export function SprintDayCell({ day, isToday, cellMinHeight }: SprintDayCellProps) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: cellMinHeight ?? 200,
        p: 1.25,
        borderRadius: 1.25,
        border: 1,
        borderColor: isToday ? 'error.main' : 'divider',
        backgroundColor: isToday
          ? (t) => (t.palette.mode === 'dark' ? 'rgba(239,83,80,0.10)' : 'rgba(239,83,80,0.06)')
          : 'background.default',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: isToday ? 'error.main' : 'text.secondary',
          }}
        >
          {czechWeekdayOf(day.date)}
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{shortDate(day.date)}</Typography>
      </Stack>

      {day.worklogs.length === 0 ? (
        <Stack flex={1} alignItems="center" justifyContent="center">
          <Typography sx={{ color: 'text.disabled', fontSize: 14 }}>—</Typography>
        </Stack>
      ) : (
        <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {day.worklogs.map((w) => (
            <Box
              key={w.id}
              sx={{
                pl: 1,
                py: 0.75,
                pr: 0.75,
                borderRadius: 0.75,
                backgroundColor: 'background.paper',
                borderLeft: 3,
                borderColor: w.projectColor ?? 'primary.main',
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontFamily: 'Menlo, monospace',
                    fontSize: 10.5,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {w.taskNumber ?? w.projectName}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>
                  {formatMinutes(w.minutes)}
                </Typography>
              </Stack>
              {w.note && (
                <Typography
                  sx={{
                    fontSize: 10.5,
                    color: 'text.disabled',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {w.note}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
