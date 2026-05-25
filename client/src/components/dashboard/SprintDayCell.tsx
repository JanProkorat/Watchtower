import { Box, Stack, Typography } from '@mui/material';
import type { DashboardSprintDayPayload } from '../../../../shared/ipcContract.js';
import { formatMinutes } from '../../util/format.js';

const CZECH_DOW_BY_JS_DAY = ['NE', 'PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO'] as const;

function czechWeekdayOf(iso: string): string {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sun, always 0..6
  return CZECH_DOW_BY_JS_DAY[dow] ?? '';
}

export interface SprintDayCellProps {
  day: DashboardSprintDayPayload;
  /** True for today's column. */
  isToday: boolean;
  /** Fixed cell width in px. */
  cellWidth?: number;
  /** Fixed cell height in px. */
  cellHeight?: number;
}

function shortDate(iso: string): string {
  // iso "2026-05-25" → "25. 5."
  const [, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

export function SprintDayCell({ day, isToday, cellWidth = 168, cellHeight = 220 }: SprintDayCellProps) {
  return (
    <Box
      sx={{
        width: cellWidth,
        flexShrink: 0,
        height: cellHeight,
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
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ flexShrink: 0 }}>
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

      {day.tasks.length === 0 ? (
        <Stack flex={1} alignItems="center" justifyContent="center">
          <Typography sx={{ color: 'text.disabled', fontSize: 14 }}>—</Typography>
        </Stack>
      ) : (
        <Stack
          spacing={0.75}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {day.tasks.map((t, i) => (
            <Box
              key={`${t.taskNumber ?? t.projectName}-${i}`}
              sx={{
                pl: 1,
                py: 0.75,
                pr: 0.75,
                borderRadius: 0.75,
                backgroundColor: 'background.paper',
                borderLeft: 3,
                borderColor: t.projectColor ?? 'primary.main',
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
                  {t.taskNumber ?? t.projectName}
                  {t.worklogCount > 1 && (
                    <Typography
                      component="span"
                      sx={{ ml: 0.5, fontSize: 10, color: 'text.disabled' }}
                    >
                      ×{t.worklogCount}
                    </Typography>
                  )}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>
                  {formatMinutes(t.minutes)}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
