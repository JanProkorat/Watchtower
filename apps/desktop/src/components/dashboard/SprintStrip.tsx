import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TodayIcon from '@mui/icons-material/Today';
import DragHandleIcon from '@mui/icons-material/DragHandle';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/cs';
import type { DashboardSprintDayPayload } from '@watchtower/shared/ipcContract.js';
import { formatDateLongCz, formatMinutes } from '../../util/format.js';
import { SprintDayCell } from './SprintDayCell.js';

const DAY_HEIGHT_DEFAULT = 330;
const DAY_HEIGHT_MIN = 140;
const DAY_HEIGHT_MAX = 900;
// Old keys: 'watchtower.dashboard.weekCellHeight',
// 'watchtower.dashboard.sprintCalendar.dayHeight',
// 'watchtower.dashboard.sprintCalendar.dayHeight.v2',
// 'watchtower.dashboard.sprintCalendar.dayHeight.v3' — silently ignored so the
// taller default applies for everyone on first load.
const STORAGE_KEY = 'watchtower.dashboard.sprintCalendar.dayHeight.v4';

function loadDayHeight(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return DAY_HEIGHT_DEFAULT;
    return Math.min(DAY_HEIGHT_MAX, Math.max(DAY_HEIGHT_MIN, n));
  } catch {
    return DAY_HEIGHT_DEFAULT;
  }
}

export interface SprintStripProps {
  sprint: {
    fromDate: string;
    toDate: string;
    lengthDays: number;
    totalMinutes: number;
    days: DashboardSprintDayPayload[];
  };
  /** Today's ISO date (YYYY-MM-DD), used to highlight one column. */
  todayDate: string;
  /** Caller updates the sprint anchor; the strip never derives it itself. */
  onAnchorChange(nextAnchor: string): void;
}

export function SprintStrip({
  sprint,
  todayDate,
  onAnchorChange,
}: SprintStripProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [dayHeight, setDayHeight] = useState<number>(loadDayHeight);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(dayHeight));
    } catch {
      /* ignore */
    }
  }, [dayHeight]);

  useEffect(() => {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }
  }, []); // only first paint

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragStateRef.current = { startY: e.clientY, startHeight: dayHeight };
    },
    [dayHeight],
  );

  const handleResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    const delta = e.clientY - state.startY;
    const next = Math.min(
      DAY_HEIGHT_MAX,
      Math.max(DAY_HEIGHT_MIN, state.startHeight + delta),
    );
    setDayHeight(next);
  }, []);

  const handleResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
  }, []);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Sprint</Typography>
            <Chip
              size="small"
              label={formatMinutes(sprint.totalMinutes)}
              sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
              color="primary"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {formatDateLongCz(sprint.fromDate)} — {formatDateLongCz(sprint.toDate)}
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Jump to today">
            <IconButton size="small" onClick={() => onAnchorChange(todayDate)}>
              <TodayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Previous sprint">
            <IconButton
              size="small"
              onClick={() =>
                onAnchorChange(
                  dayjs(sprint.fromDate)
                    .subtract(sprint.lengthDays, 'day')
                    .format('YYYY-MM-DD'),
                )
              }
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Pick a date in the sprint">
            <IconButton size="small" onClick={(e) => setPickerAnchor(e.currentTarget)}>
              <CalendarMonthIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Next sprint">
            <IconButton
              size="small"
              onClick={() =>
                onAnchorChange(
                  dayjs(sprint.fromDate)
                    .add(sprint.lengthDays, 'day')
                    .format('YYYY-MM-DD'),
                )
              }
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Popover
        open={Boolean(pickerAnchor)}
        anchorEl={pickerAnchor}
        onClose={() => setPickerAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 1 }}>
          <DatePicker
            value={dayjs(sprint.fromDate)}
            onChange={(v: Dayjs | null) => {
              if (!v) return;
              onAnchorChange(v.format('YYYY-MM-DD'));
              setPickerAnchor(null);
            }}
          />
        </Box>
      </Popover>

      <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
        <Stack direction="row" gap={1} sx={{ width: 'max-content' }}>
          {sprint.days.map((d) => {
            const isToday = d.date === todayDate;
            return (
              <Box key={d.date} ref={isToday ? todayRef : undefined}>
                <SprintDayCell day={d} isToday={isToday} cellHeight={dayHeight} />
              </Box>
            );
          })}
        </Stack>
      </Box>

      <Tooltip title="Drag to resize">
        <Box
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onDoubleClick={() => setDayHeight(DAY_HEIGHT_DEFAULT)}
          role="separator"
          sx={{
            mt: 1,
            mx: -2,
            mb: -2,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'ns-resize',
            color: 'text.disabled',
            borderTop: 1,
            borderColor: 'divider',
            touchAction: 'none',
            userSelect: 'none',
            '&:hover': {
              color: 'text.secondary',
              backgroundColor: 'action.hover',
            },
          }}
        >
          <DragHandleIcon fontSize="small" />
        </Box>
      </Tooltip>
    </Paper>
  );
}
