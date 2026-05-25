import { useEffect, useRef, useState } from 'react';
import { Box, Chip, IconButton, Paper, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TodayIcon from '@mui/icons-material/Today';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/cs';
import type { DashboardSprintDayPayload } from '../../../../shared/ipcContract.js';
import { formatDateLongCz, formatMinutes } from '../../util/format.js';
import { SprintDayCell } from './SprintDayCell.js';

const HANDLE_HEIGHT = 8;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const STORAGE_KEY = 'watchtower.dashboard.weekCellHeight';

function readPersistedHeight(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return 200;
    const n = Number(v);
    return Number.isFinite(n) && n >= MIN_HEIGHT && n <= MAX_HEIGHT ? n : 200;
  } catch {
    return 200;
  }
}

function persistHeight(h: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(h));
  } catch {
    /* ignore */
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

export function SprintStrip({ sprint, todayDate, onAnchorChange }: SprintStripProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [cellHeight, setCellHeight] = useState<number>(readPersistedHeight);
  const cellHeightRef = useRef(cellHeight);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    cellHeightRef.current = cellHeight;
  }, [cellHeight]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: cellHeight };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientY - dragRef.current.startY;
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragRef.current.startH + delta));
      setCellHeight(next);
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistHeight(cellHeightRef.current);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>This sprint</Typography>
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
              onClick={() => onAnchorChange(dayjs(sprint.fromDate).subtract(sprint.lengthDays, 'day').format('YYYY-MM-DD'))}
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
              onClick={() => onAnchorChange(dayjs(sprint.fromDate).add(sprint.lengthDays, 'day').format('YYYY-MM-DD'))}
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

      <Stack direction="row" spacing={1.25} sx={{ width: '100%' }}>
        {sprint.days.map((d) => (
          <SprintDayCell key={d.date} day={d} isToday={d.date === todayDate} cellMinHeight={cellHeight} />
        ))}
      </Stack>

      <Box
        onMouseDown={onDragStart}
        sx={{
          height: HANDLE_HEIGHT,
          mt: 1,
          cursor: 'ns-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.disabled',
          borderRadius: 1,
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Box sx={{ width: 36, height: 3, borderRadius: 999, backgroundColor: 'divider' }} />
      </Box>
    </Paper>
  );
}
