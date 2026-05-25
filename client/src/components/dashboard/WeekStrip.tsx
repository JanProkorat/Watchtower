import { useState } from 'react';
import { Box, Chip, IconButton, Paper, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TodayIcon from '@mui/icons-material/Today';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import 'dayjs/locale/cs';
import type { DashboardWeekDayPayload } from '../../../../shared/ipcContract.js';
import { formatDateLongCz, formatMinutes } from '../../util/format.js';
import { WeekDayCell } from './WeekDayCell.js';

dayjs.extend(isoWeek);

export interface WeekStripProps {
  week: {
    fromDate: string;
    toDate: string;
    totalMinutes: number;
    days: DashboardWeekDayPayload[];
  };
  /** Today's ISO date (YYYY-MM-DD), used to highlight one column. */
  todayDate: string;
  /** Caller updates the week anchor; the strip never derives it itself. */
  onAnchorChange(nextAnchor: string): void;
}

function mondayOf(iso: string): string {
  return dayjs(iso).isoWeekday(1).format('YYYY-MM-DD');
}

export function WeekStrip({ week, todayDate, onAnchorChange }: WeekStripProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>This week</Typography>
            <Chip
              size="small"
              label={formatMinutes(week.totalMinutes)}
              sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
              color="primary"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {formatDateLongCz(week.fromDate)} — {formatDateLongCz(week.toDate)}
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Jump to today">
            <IconButton size="small" onClick={() => onAnchorChange(todayDate)}>
              <TodayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Previous week">
            <IconButton
              size="small"
              onClick={() => onAnchorChange(dayjs(week.fromDate).subtract(7, 'day').format('YYYY-MM-DD'))}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Pick a week">
            <IconButton size="small" onClick={(e) => setPickerAnchor(e.currentTarget)}>
              <CalendarMonthIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Next week">
            <IconButton
              size="small"
              onClick={() => onAnchorChange(dayjs(week.fromDate).add(7, 'day').format('YYYY-MM-DD'))}
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
            value={dayjs(week.fromDate)}
            onChange={(v: Dayjs | null) => {
              if (!v) return;
              onAnchorChange(mondayOf(v.format('YYYY-MM-DD')));
              setPickerAnchor(null);
            }}
          />
        </Box>
      </Popover>

      <Stack direction="row" spacing={1.25} sx={{ width: '100%' }}>
        {week.days.map((d, i) => (
          <WeekDayCell key={d.date} day={d} index={i} isToday={d.date === todayDate} />
        ))}
      </Stack>
    </Paper>
  );
}
