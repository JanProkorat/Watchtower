import { Box, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type {
  DayOffViewPayload,
  PublicHolidayPayload,
} from '../../../../shared/ipcContract.js';

export type DayOffKind = 'vacation' | 'sick' | 'other' | 'holiday';

interface Props {
  /** Year of the first (leftmost) month shown. */
  startYear: number;
  /** 1-based month of the first month shown. */
  startMonth: number;
  /** How many months to render side-by-side. Default = 3. */
  monthsVisible?: number;
  byDate: Map<string, DayOffViewPayload>;
  holidaysByDate: Map<string, PublicHolidayPayload>;
  /**
   * Click handler — only invoked for cells inside the month and only for
   * dates that aren't read-only public holidays without a user override.
   */
  onCellClick(date: string): void;
}

const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function ThreeMonthCalendar({
  startYear,
  startMonth,
  monthsVisible = 3,
  byDate,
  holidaysByDate,
  onCellClick,
}: Props) {
  const months: Array<{ year: number; month: number }> = [];
  for (let i = 0; i < monthsVisible; i++) {
    const idx = startMonth - 1 + i;
    months.push({ year: startYear + Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 + 1 });
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${monthsVisible}, 1fr)`,
        gap: 3,
      }}
    >
      {months.map(({ year, month }) => (
        <MonthGrid
          key={`${year}-${month}`}
          year={year}
          month={month}
          byDate={byDate}
          holidaysByDate={holidaysByDate}
          onCellClick={onCellClick}
        />
      ))}
    </Box>
  );
}

function MonthGrid({
  year,
  month,
  byDate,
  holidaysByDate,
  onCellClick,
}: {
  year: number;
  month: number;
  byDate: Map<string, DayOffViewPayload>;
  holidaysByDate: Map<string, PublicHolidayPayload>;
  onCellClick(date: string): void;
}) {
  const today = new Date();
  const todayYmd = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // Pad to a Monday-first 7-column grid covering the whole month.
  const firstOfMonth = new Date(year, month - 1, 1);
  const startDow = firstOfMonth.getDay(); // 0=Sun..6=Sat
  const startOffset = (startDow + 6) % 7; // 0=Mon
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, month - 1, 1 - startOffset + i);
    cells.push({ date: d, inMonth: d.getMonth() === month - 1 });
  }

  return (
    <Box>
      <Typography
        variant="subtitle2"
        sx={{ fontWeight: 600, textAlign: 'center', mb: 1, textTransform: 'capitalize' }}
      >
        {MONTH_LABELS[month - 1]} {year}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', mb: 0.5 }}>
        {DOW_LABELS.map((d) => (
          <Typography
            key={d}
            variant="caption"
            sx={{ textAlign: 'center', fontWeight: 600, color: 'text.secondary' }}
          >
            {d}
          </Typography>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells.map(({ date, inMonth }) => {
          const cellYmd = ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
          const dayOff = byDate.get(cellYmd);
          const holiday = holidaysByDate.get(cellYmd);
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const isToday = cellYmd === todayYmd;
          const isHolidayOnly = !dayOff && !!holiday;
          return (
            <DayCell
              key={cellYmd}
              ymd={cellYmd}
              dayNumber={date.getDate()}
              inMonth={inMonth}
              isWeekend={isWeekend}
              isToday={isToday}
              dayOff={dayOff}
              holiday={holiday}
              isHolidayOnly={isHolidayOnly}
              clickable={inMonth}
              onClick={() => inMonth && onCellClick(cellYmd)}
            />
          );
        })}
      </Box>
    </Box>
  );
}

const KIND_COLOR: Record<DayOffKind, string> = {
  vacation: '#1976d2',
  sick: '#d32f2f',
  other: '#616161',
  holiday: '#7b1fa2',
};

function DayCell({
  ymd: cellYmd,
  dayNumber,
  inMonth,
  isWeekend,
  isToday,
  dayOff,
  holiday,
  isHolidayOnly,
  clickable,
  onClick,
}: {
  ymd: string;
  dayNumber: number;
  inMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
  dayOff?: DayOffViewPayload;
  holiday?: PublicHolidayPayload;
  isHolidayOnly: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const theme = useTheme();
  // Marked rows win visually over the holiday tint — a "sick on Christmas"
  // row is more informative than the underlying holiday.
  const color = dayOff
    ? KIND_COLOR[dayOff.kind]
    : isHolidayOnly
      ? KIND_COLOR.holiday
      : null;

  const tooltip = dayOff
    ? `${kindLabel(dayOff.kind)}${dayOff.note ? ` — ${dayOff.note}` : ''}`
    : holiday
      ? holiday.name
      : isWeekend
        ? 'Weekend'
        : cellYmd;

  return (
    <Tooltip title={tooltip} placement="top" disableInteractive>
      <Box
        role="button"
        tabIndex={clickable ? 0 : -1}
        onClick={onClick}
        onKeyDown={(e) => {
          if (clickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
        sx={{
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: isToday ? 700 : 500,
          borderRadius: 1,
          cursor: clickable ? 'pointer' : 'default',
          opacity: inMonth ? 1 : 0.25,
          userSelect: 'none',
          color: color
            ? color
            : isWeekend
              ? theme.palette.text.disabled
              : theme.palette.text.primary,
          backgroundColor: color ? alpha(color, isHolidayOnly ? 0.12 : 0.18) : 'transparent',
          border: isToday
            ? `1.5px solid ${theme.palette.primary.main}`
            : isHolidayOnly
              ? `1.5px dashed ${alpha(KIND_COLOR.holiday, 0.55)}`
              : '1.5px solid transparent',
          transition: 'background-color 80ms ease, color 80ms ease',
          ':hover': clickable
            ? {
                backgroundColor: color
                  ? alpha(color, 0.28)
                  : alpha(theme.palette.primary.main, 0.08),
              }
            : undefined,
        }}
      >
        {dayNumber}
      </Box>
    </Tooltip>
  );
}

function kindLabel(k: DayOffKind): string {
  return { vacation: 'Vacation', sick: 'Sick', other: 'Other', holiday: 'Public holiday' }[k];
}
