import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { useChartColors } from './chartTheme';
import ChartTooltip from './ChartTooltip';
import { formatDateCz, formatHours, formatMd, formatMonthCz } from '../../../util/format';

export interface TrendDatum {
  bucket: string;
  minutes: number;
  mds: number;
  earned_by_currency: Record<string, number>;
}

export interface RateChangeMarker {
  bucket: string;       // pre-computed to match a TrendDatum.bucket
  label: string;        // short text shown on the marker
  project_color: string;
}

interface Props {
  data: TrendDatum[];
  granularity: 'day' | 'week' | 'month';
  rateChanges?: RateChangeMarker[];
}

function formatBucketAxis(bucket: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') {
    const d = dayjs(bucket);
    return d.isValid() ? d.format('D. M.') : bucket;
  }
  if (granularity === 'week') {
    // Server format: "YYYY-Www" — display as "týden ww".
    const m = bucket.match(/^\d{4}-W(\d{1,2})$/);
    return m ? `${parseInt(m[1]!, 10)}. týden` : bucket;
  }
  // month: "YYYY-MM"
  const d = dayjs(bucket + '-01');
  return d.isValid() ? d.format('MMM YYYY') : bucket;
}

function formatBucketTooltip(bucket: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') return formatDateCz(bucket);
  if (granularity === 'week') {
    const m = bucket.match(/^(\d{4})-W(\d{1,2})$/);
    return m ? `${parseInt(m[2]!, 10)}. týden ${m[1]}` : bucket;
  }
  return formatMonthCz(bucket + '-01');
}

export default function TrendChart({ data, granularity, rateChanges }: Props) {
  const c = useChartColors();
  // Only render markers whose bucket is present in the data, otherwise
  // recharts would draw a line off-axis.
  const bucketSet = new Set(data.map((d) => d.bucket));
  const visibleMarkers = (rateChanges ?? []).filter((m) => bucketSet.has(m.bucket));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          stroke={c.textMuted}
          tickFormatter={(v) => formatBucketAxis(v, granularity)}
          fontSize={12}
        />
        <YAxis
          stroke={c.textMuted}
          tickFormatter={(v) => formatHours(v, 0)}
          fontSize={12}
          width={40}
        />
        <Tooltip
          cursor={{ fill: c.primarySoft, opacity: 0.2 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]!.payload as TrendDatum;
            const rows: { label: string; value: string }[] = [
              { label: 'Hours', value: formatHours(d.minutes, 2) },
              { label: 'MD', value: formatMd(d.mds) },
            ];
            for (const [cur, amt] of Object.entries(d.earned_by_currency)) {
              rows.push({ label: cur, value: amt.toFixed(2) });
            }
            return <ChartTooltip title={formatBucketTooltip(String(label), granularity)} rows={rows} />;
          }}
        />
        <Bar dataKey="minutes" fill={c.primary} radius={[4, 4, 0, 0]} />
        {visibleMarkers.map((m, i) => (
          <ReferenceLine
            key={`${m.bucket}-${i}`}
            x={m.bucket}
            stroke={m.project_color}
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{
              value: m.label,
              position: 'top',
              fontSize: 10,
              fill: m.project_color,
            }}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
