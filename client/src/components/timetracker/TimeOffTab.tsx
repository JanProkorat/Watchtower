import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import BeachAccessIcon from '@mui/icons-material/BeachAccess';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useDaysOff } from '../../state/useDaysOff.js';
import { useToast, toastMessage } from '../../state/useToast.js';
import { ThreeMonthCalendar } from './ThreeMonthCalendar.js';
import type {
  DayOffViewPayload,
  PublicHolidayPayload,
} from '../../../../shared/ipcContract.js';

type MarkingKind = 'vacation' | 'sick' | 'other';

const KIND_COLOR: Record<MarkingKind | 'holiday', string> = {
  vacation: '#1976d2',
  sick: '#d32f2f',
  other: '#616161',
  holiday: '#7b1fa2',
};

const KIND_LABEL: Record<MarkingKind | 'holiday', string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  other: 'Other',
  holiday: 'Public holiday',
};

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtUpcomingDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return `${DOW_SHORT[dt.getDay()]}, ${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

export function TimeOffTab() {
  const today = new Date();
  // The 3-month window is centred on the focus month. Default = previous
  // month + current + next, so "today" is visible by default.
  const [focusYear, setFocusYear] = useState(today.getFullYear());
  const [focusMonth, setFocusMonth] = useState(today.getMonth() + 1); // 1-based, this is the *centre* month
  const [marking, setMarking] = useState<MarkingKind>('vacation');
  const [pageSize, setPageSize] = useState(5);
  const { showError } = useToast();
  const [page, setPage] = useState(0);

  const state = useDaysOff(focusYear);

  // Window start = focusMonth - 1
  const windowStart = useMemo(() => {
    const m = focusMonth - 1;
    return {
      year: focusYear + (m === 0 ? -1 : 0),
      month: m === 0 ? 12 : m,
    };
  }, [focusYear, focusMonth]);

  const stepMonth = (delta: number) => {
    const next = new Date(focusYear, focusMonth - 1 + delta, 1);
    setFocusYear(next.getFullYear());
    setFocusMonth(next.getMonth() + 1);
  };

  const goToday = () => {
    setFocusYear(today.getFullYear());
    setFocusMonth(today.getMonth() + 1);
  };

  const onCellClick = (date: string) => {
    // Czech public holidays are read-only — the user can shadow them with a
    // sick/vacation row (which physically inserts a days_off entry) but a
    // plain click on a holiday-only cell is a no-op. The ThreeMonthCalendar
    // already filters this for clickability, but defending here too.
    const existing = state.byDate.get(date);
    const onErr = (err: unknown) => showError(toastMessage(err));
    if (existing) {
      // Same kind → clear; different kind → switch.
      if (existing.kind === marking) {
        state.remove(date).catch(onErr);
      } else {
        state.upsert({ date, kind: marking }).catch(onErr);
      }
    } else {
      state.upsert({ date, kind: marking }).catch(onErr);
    }
  };

  // Build the upcoming list: future user days_off + future public holidays,
  // deduped by date (user entry wins so a sick/vacation can shadow a holiday).
  const upcoming = useMemo(() => {
    const today = todayStr();
    const items = new Map<
      string,
      {
        date: string;
        kind: MarkingKind | 'holiday';
        note: string | null;
        removable: boolean;
      }
    >();
    for (const h of state.holidays) {
      if (h.date < today) continue;
      items.set(h.date, {
        date: h.date,
        kind: 'holiday',
        note: h.name,
        removable: false,
      });
    }
    for (const d of state.days) {
      if (d.date < today) continue;
      items.set(d.date, {
        date: d.date,
        kind: d.kind === 'holiday' ? 'holiday' : (d.kind as MarkingKind),
        note: d.note,
        removable: true,
      });
    }
    return [...items.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [state.days, state.holidays]);

  const totals = useMemo(() => {
    const t = { vacation: 0, sick: 0, other: 0, holiday: 0 };
    for (const it of upcoming) t[it.kind]++;
    return t;
  }, [upcoming]);

  const totalPages = Math.max(1, Math.ceil(upcoming.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const sliceStart = safePage * pageSize;
  const sliceEnd = Math.min(sliceStart + pageSize, upcoming.length);
  const slice = upcoming.slice(sliceStart, sliceEnd);

  const setPageSizeAndReset = (n: number) => {
    setPageSize(n);
    setPage(0);
  };

  const windowLabel = useMemo(() => {
    const endMonthIdx = windowStart.month - 1 + 2; // 3 months total, 0-based end
    const endYear = windowStart.year + Math.floor(endMonthIdx / 12);
    const endMonth = ((endMonthIdx % 12) + 12) % 12 + 1;
    return `${MONTH_SHORT[windowStart.month - 1]} ${windowStart.year} – ${MONTH_SHORT[endMonth - 1]} ${endYear}`;
  }, [windowStart]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip title="Previous month">
            <IconButton size="small" onClick={() => stepMonth(-1)}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 500, minWidth: 220, textAlign: 'center' }}
          >
            {windowLabel}
          </Typography>
          <Tooltip title="Next month">
            <IconButton size="small" onClick={() => stepMonth(+1)}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Centre on this month">
            <IconButton size="small" onClick={goToday}>
              <TodayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Box sx={{ flex: 1 }} />

        <TextField
          select
          size="small"
          label="Marking as"
          value={marking}
          onChange={(e) => setMarking(e.target.value as MarkingKind)}
          sx={{ minWidth: 160 }}
        >
          {(['vacation', 'sick', 'other'] as const).map((k) => (
            <MenuItem key={k} value={k}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: KIND_COLOR[k],
                  }}
                />
                <span>{KIND_LABEL[k]}</span>
              </Stack>
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            p: 1.5,
            mb: 2,
            backgroundColor: 'action.hover',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <InfoOutlinedIcon
            sx={{ color: 'text.secondary', fontSize: 18, mt: 0.25, flexShrink: 0 }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
            Click a weekday to mark it as the selected kind. Click again to clear, or switch the
            dropdown and click to change the kind. Czech public holidays (dashed outline) are
            counted automatically. Both reduce <strong>expected workdays</strong> on every active
            contract.
          </Typography>
        </Box>

        {state.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {state.error}
          </Alert>
        )}

        <ThreeMonthCalendar
          startYear={windowStart.year}
          startMonth={windowStart.month}
          monthsVisible={3}
          byDate={state.byDate}
          holidaysByDate={state.holidaysByDate}
          onCellClick={onCellClick}
        />

        <Box
          sx={{
            mt: 3,
            p: 2,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            backgroundColor: 'background.paper',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 500, mb: 1.5 }}>
            Upcoming days off
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            {(['vacation', 'sick', 'other', 'holiday'] as const).map((k) => (
              <KindChip key={k} kind={k} count={totals[k]} />
            ))}
          </Stack>

          {upcoming.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No upcoming days off planned.
            </Typography>
          ) : (
            <Stack spacing={0.75}>
              {slice.map((item) => (
                <UpcomingRow
                  key={item.date}
                  item={item}
                  onRemove={() => {
                    state.remove(item.date).catch((err) => showError(toastMessage(err)));
                  }}
                />
              ))}
            </Stack>
          )}

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 1.5, color: 'text.secondary', fontSize: 12 }}
          >
            <IconButton
              size="small"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
            >
              {upcoming.length === 0
                ? 'No entries'
                : `Showing ${sliceStart + 1}–${sliceEnd} of ${upcoming.length}`}
            </Typography>
            <IconButton
              size="small"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
              aria-label="Next page"
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Per page:
            </Typography>
            <TextField
              select
              size="small"
              value={pageSize}
              onChange={(e) => setPageSizeAndReset(Number(e.target.value))}
              sx={{ minWidth: 70 }}
              SelectProps={{ MenuProps: { disableScrollLock: true } }}
            >
              <MenuItem value={5}>5</MenuItem>
              <MenuItem value={10}>10</MenuItem>
              <MenuItem value={20}>20</MenuItem>
            </TextField>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}

function KindChip({ kind, count }: { kind: MarkingKind | 'holiday'; count: number }) {
  const color = KIND_COLOR[kind];
  const active = count > 0;
  return (
    <Chip
      size="small"
      variant={active ? 'filled' : 'outlined'}
      label={`${count} ${kind === 'holiday' ? 'public holiday' : kind}`}
      sx={{
        backgroundColor: active ? alpha(color, 0.16) : 'transparent',
        color: active ? color : 'text.secondary',
        borderColor: color,
        textTransform: 'capitalize',
      }}
    />
  );
}

function UpcomingRow({
  item,
  onRemove,
}: {
  item: {
    date: string;
    kind: MarkingKind | 'holiday';
    note: string | null;
    removable: boolean;
  };
  onRemove(): void;
}) {
  const color = KIND_COLOR[item.kind];
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
      }}
    >
      <BeachAccessIcon sx={{ color, fontSize: 18, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
          {fmtUpcomingDate(item.date)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
          {KIND_LABEL[item.kind]}
          {item.note ? ` — ${item.note}` : ''}
        </Typography>
      </Box>
      {item.removable ? (
        <Tooltip title="Remove">
          <IconButton size="small" onClick={onRemove}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.disabled', pr: 1 }}>
          auto
        </Typography>
      )}
    </Stack>
  );
}

// Re-export PublicHolidayPayload to keep import paths short for ThreeMonthCalendar callers.
export type { PublicHolidayPayload, DayOffViewPayload };
