import { useMemo } from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import dayjs from 'dayjs';
import { formatDateCz, formatHours, formatMd } from '../../../util/format';

export interface HeatmapDatum {
  date: string;
  minutes: number;
  /** Optional — the Reports heatmap supplies it; the Dashboard one omits it. */
  mds?: number;
}

export interface HeatmapStats {
  current_streak: number;
  longest_streak: number;
  active_days: number;
  weekly_avg_minutes: number;
  weekly_avg_mds: number;
  busiest_dow: { day: string; minutes: number; mds: number } | null;
}

interface Props {
  data: HeatmapDatum[];
  from: string;
  to: string;
  cellSize?: number;
  cellGap?: number;
  showStats?: boolean;
  onStats?: (s: HeatmapStats) => void;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function computeHeatmapStats(data: HeatmapDatum[]): HeatmapStats {
  const map = new Map(data.map((d) => [d.date, d.minutes]));
  const sortedDates = Array.from(map.keys()).sort();
  const today = dayjs().format('YYYY-MM-DD');

  // current streak — counting back from today (skip today if no log, count from yesterday)
  let current = 0;
  let cursor = dayjs(today);
  if (!map.has(cursor.format('YYYY-MM-DD'))) cursor = cursor.subtract(1, 'day');
  while (map.get(cursor.format('YYYY-MM-DD'))) {
    current += 1;
    cursor = cursor.subtract(1, 'day');
  }

  // longest streak — scan all logged dates
  let longest = 0;
  let run = 0;
  let prev: dayjs.Dayjs | null = null;
  for (const d of sortedDates) {
    const day = dayjs(d);
    if (prev && day.diff(prev, 'day') === 1) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = day;
  }

  const totalMinutes = data.reduce((acc, d) => acc + d.minutes, 0);
  const totalMds = data.reduce((acc, d) => acc + (d.mds ?? 0), 0);
  const weeks = Math.max(1, dayjs(sortedDates[sortedDates.length - 1] ?? today).diff(
    dayjs(sortedDates[0] ?? today),
    'week'
  ) + 1);
  const weeklyAvg = totalMinutes / weeks;
  const weeklyAvgMds = totalMds / weeks;

  const byDow = new Map<number, { minutes: number; mds: number }>();
  for (const d of data) {
    const dow = dayjs(d.date).day();
    const acc = byDow.get(dow) ?? { minutes: 0, mds: 0 };
    acc.minutes += d.minutes;
    acc.mds += d.mds ?? 0;
    byDow.set(dow, acc);
  }
  let busiest: { day: string; minutes: number; mds: number } | null = null;
  for (const [dow, agg] of byDow.entries()) {
    if (!busiest || agg.minutes > busiest.minutes) {
      busiest = { day: DOW_LABELS[dow]!, minutes: agg.minutes, mds: agg.mds };
    }
  }

  return {
    current_streak: current,
    longest_streak: longest,
    active_days: sortedDates.length,
    weekly_avg_minutes: weeklyAvg,
    weekly_avg_mds: weeklyAvgMds,
    busiest_dow: busiest,
  };
}

export default function Heatmap({
  data,
  from,
  to,
  cellSize = 12,
  cellGap = 3,
  showStats = true,
}: Props) {
  const theme = useTheme();
  const map = useMemo(
    () => new Map(data.map((d) => [d.date, { minutes: d.minutes, mds: d.mds }])),
    [data],
  );

  const { weeks, maxMinutes } = useMemo(() => {
    const start = dayjs(from);
    const end = dayjs(to);
    // align grid so each column is Sun..Sat
    const gridStart = start.subtract(start.day(), 'day');
    const gridEnd = end.add(6 - end.day(), 'day');
    const totalDays = gridEnd.diff(gridStart, 'day') + 1;
    const totalWeeks = Math.ceil(totalDays / 7);

    let max = 0;
    const w: { date: string; minutes: number; mds?: number; inRange: boolean }[][] = [];
    for (let weekIdx = 0; weekIdx < totalWeeks; weekIdx++) {
      const col: { date: string; minutes: number; mds?: number; inRange: boolean }[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const d = gridStart.add(weekIdx * 7 + dow, 'day');
        const dStr = d.format('YYYY-MM-DD');
        const inRange = !d.isBefore(start) && !d.isAfter(end);
        const cell = map.get(dStr);
        const minutes = cell?.minutes ?? 0;
        const mds = cell?.mds;
        if (inRange && minutes > max) max = minutes;
        col.push({ date: dStr, minutes, mds, inRange });
      }
      w.push(col);
    }
    return { weeks: w, maxMinutes: max };
  }, [from, to, map]);

  const stats = useMemo(() => computeHeatmapStats(data), [data]);

  function levelFor(minutes: number): number {
    if (minutes === 0 || maxMinutes === 0) return 0;
    const ratio = minutes / maxMinutes;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 0.75) return 3;
    return 4;
  }

  // Phase D: bumped from 0.06/0.08 to 0.12/0.13 so empty cells stay visible
  // over the now-translucent glass background (the old alpha was calibrated
  // for a solid dark/light canvas; vibrancy reduces perceived contrast).
  const baseEmpty = alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.12 : 0.13);
  const colorForLevel = (level: number) => {
    if (level === 0) return baseEmpty;
    const stops = [0.18, 0.36, 0.62, 0.95];
    return alpha(theme.palette.primary.main, stops[level - 1]!);
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ overflowX: 'auto', pb: 1 }}>
        <svg
          width={weeks.length * (cellSize + cellGap)}
          height={7 * (cellSize + cellGap) + 16}
          style={{ display: 'block' }}
        >
          {[1, 3, 5].map((dow) => (
            <text
              key={dow}
              x={0}
              y={dow * (cellSize + cellGap) + cellSize}
              fontSize={9}
              fill={theme.palette.text.secondary}
            >
              {DOW_LABELS[dow]}
            </text>
          ))}
          {weeks.map((col, x) =>
            col.map((cell, y) => {
              if (!cell.inRange) return null;
              const level = levelFor(cell.minutes);
              return (
                <Tooltip
                  key={`${x}-${y}`}
                  title={
                    cell.minutes > 0
                      ? `${formatDateCz(cell.date)} · ${formatHours(cell.minutes, 2)} h${
                          cell.mds != null ? ` · ${formatMd(cell.mds)} MD` : ''
                        }`
                      : `${formatDateCz(cell.date)} · no time`
                  }
                  placement="top"
                  enterDelay={150}
                >
                  <rect
                    x={x * (cellSize + cellGap) + 22}
                    y={y * (cellSize + cellGap)}
                    width={cellSize}
                    height={cellSize}
                    rx={2}
                    fill={colorForLevel(level)}
                  />
                </Tooltip>
              );
            })
          )}
        </svg>
      </Box>
      {showStats && (
        <Stack
          direction="row"
          spacing={3}
          divider={<Box sx={{ width: '1px', bgcolor: 'divider' }} />}
          sx={{ flexWrap: 'wrap', rowGap: 1 }}
        >
          <Stat label="Current streak" value={`${stats.current_streak}d`} />
          <Stat label="Longest streak" value={`${stats.longest_streak}d`} />
          <Stat label="Active days" value={`${stats.active_days}`} />
          <Stat
            label="Weekly avg"
            value={`${formatHours(stats.weekly_avg_minutes, 1)}h · ${formatMd(stats.weekly_avg_mds)} MD`}
          />
          <Stat
            label="Busiest day"
            value={
              stats.busiest_dow
                ? `${stats.busiest_dow.day} (${formatHours(stats.busiest_dow.minutes, 1)}h · ${formatMd(stats.busiest_dow.mds)} MD)`
                : '—'
            }
          />
        </Stack>
      )}
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="subtitle2" className="tt-num" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}
