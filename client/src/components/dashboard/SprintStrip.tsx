import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
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
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import TodayIcon from '@mui/icons-material/Today';
import DragHandleIcon from '@mui/icons-material/DragHandle';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/cs';
import type { DashboardSprintDayPayload } from '../../../../shared/ipcContract.js';
import { formatDateLongCz, formatMinutes } from '../../util/format.js';
import { useToast, toastMessage } from '../../state/useToast.js';
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
  /** Optional — called after a successful meetings sync so the dashboard refetches. */
  onSyncComplete?(): void;
}

export function SprintStrip({
  sprint,
  todayDate,
  onAnchorChange,
  onSyncComplete,
}: SprintStripProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [syncAnchor, setSyncAnchor] = useState<HTMLElement | null>(null);
  const [syncFrom, setSyncFrom] = useState<Dayjs | null>(null);
  const [syncTo, setSyncTo] = useState<Dayjs | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dayHeight, setDayHeight] = useState<number>(loadDayHeight);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const { showError, showSuccess } = useToast();

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

  const openSyncPopover = (anchor: HTMLElement) => {
    const sprintStart = dayjs(sprint.fromDate).startOf('day');
    const sprintEnd = dayjs(sprint.toDate).startOf('day');
    const today = dayjs(todayDate).startOf('day');
    // Default: full sprint start → min(today, sprint end). Matches TT.
    const toDefault = today.isAfter(sprintEnd)
      ? sprintEnd
      : today.isBefore(sprintStart)
        ? sprintStart
        : today;
    setSyncFrom(sprintStart);
    setSyncTo(toDefault);
    setSyncAnchor(anchor);
  };

  const sprintStart = dayjs(sprint.fromDate).startOf('day');
  const sprintEnd = dayjs(sprint.toDate).endOf('day');
  const fromValid = !!syncFrom && syncFrom.isValid();
  const toValid = !!syncTo && syncTo.isValid();
  const rangeValid =
    fromValid &&
    toValid &&
    !syncFrom!.startOf('day').isAfter(syncTo!.startOf('day')) &&
    !syncFrom!.isBefore(sprintStart) &&
    !syncTo!.isAfter(sprintEnd);

  const submitSync = async () => {
    if (!rangeValid || !syncFrom || !syncTo || syncing) return;
    setSyncing(true);
    try {
      const result = await window.watchtower.invoke('meetings:sync', {
        from: syncFrom.format('YYYY-MM-DD'),
        to: syncTo.format('YYYY-MM-DD'),
      });
      setSyncAnchor(null);
      if (result.error) {
        showError(`Sync schůzek selhal: ${result.error}`);
      } else {
        const msg = result.summary || 'Sync schůzek dokončen.';
        showSuccess(msg);
        onSyncComplete?.();
      }
    } catch (err) {
      showError(`Sync schůzek selhal: ${toastMessage(err)}`);
    } finally {
      setSyncing(false);
    }
  };

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
          <Tooltip title="Sync meetings">
            <span>
              <IconButton
                size="small"
                onClick={(e) => openSyncPopover(e.currentTarget)}
                disabled={syncing}
              >
                {syncing ? <CircularProgress size={16} /> : <EventRepeatIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
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

      <Popover
        open={Boolean(syncAnchor)}
        anchorEl={syncAnchor}
        onClose={() => (syncing ? undefined : setSyncAnchor(null))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, minWidth: 380 }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Sync meetings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Pick a range within the current sprint ({formatDateLongCz(sprint.fromDate)} —{' '}
            {formatDateLongCz(sprint.toDate)}).
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Tip: run <code>/sync-meetings YYYY-MM-DD YYYY-MM-DD</code> in your
            Claude Code chat first to refresh Outlook events; this button then
            imports them into Watchtower.
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
            <DatePicker
              label="From"
              value={syncFrom}
              onChange={(v) => setSyncFrom(v)}
              minDate={sprintStart}
              maxDate={sprintEnd}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            <DatePicker
              label="To"
              value={syncTo}
              onChange={(v) => setSyncTo(v)}
              minDate={sprintStart}
              maxDate={sprintEnd}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => setSyncAnchor(null)} disabled={syncing}>
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={
                syncing ? <CircularProgress size={14} color="inherit" /> : <EventRepeatIcon />
              }
              disabled={!rangeValid || syncing}
              onClick={() => void submitSync()}
            >
              Sync
            </Button>
          </Stack>
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
