import { Box, Grid, Paper, Stack, Typography } from '@mui/material';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ChartTooltip from './ChartTooltip';
import { useChartColors } from './chartTheme';
import { formatEarnings, formatHours, formatMd } from '../../../util/format';

export interface EarningsData {
  billable_minutes: number;
  unbillable_minutes: number;
  billable_mds: number;
  unbillable_mds: number;
  /** Total CZK earned across all billable projects in the range. */
  total_earned: number;
  /** Average CZK/h across billable projects (0 when no billable minutes). */
  avg_effective_hourly_rate: number;
  by_project: {
    project_id: number;
    project_name: string;
    project_color: string;
    earned_amount: number;
    minutes: number;
    mds: number;
  }[];
}

function MetricTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="h6"
        className="tt-num"
        sx={{ fontWeight: 600, mt: 0.25, lineHeight: 1.2 }}
      >
        {value}
      </Typography>
      {helper && (
        <Typography variant="caption" color="text.secondary" className="tt-num">
          {helper}
        </Typography>
      )}
    </Paper>
  );
}

interface Props {
  data: EarningsData;
}

export default function EarningsSummary({ data }: Props) {
  const c = useChartColors();
  const totalBillable = data.billable_minutes;
  const totalUnbillable = data.unbillable_minutes;
  const totalAll = totalBillable + totalUnbillable;
  const billablePct = totalAll > 0 ? (totalBillable / totalAll) * 100 : 0;

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <Grid container spacing={1}>
        <Grid item xs={6} sm={3}>
          <MetricTile
            label="Total earned"
            value={formatEarnings(data.total_earned)}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <MetricTile
            label="Billable hours"
            value={formatHours(totalBillable, 1)}
            helper={`${formatMd(data.billable_mds)} MD · ${billablePct.toFixed(0)}% of total`}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <MetricTile
            label="Unbillable hours"
            value={formatHours(totalUnbillable, 1)}
            helper={
              totalAll > 0
                ? `${formatMd(data.unbillable_mds)} MD · ${(100 - billablePct).toFixed(0)}% of total`
                : undefined
            }
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <MetricTile
            label="Avg rate"
            value={
              data.avg_effective_hourly_rate > 0
                ? `${data.avg_effective_hourly_rate.toFixed(2)} Kč/h`
                : '—'
            }
          />
        </Grid>
      </Grid>

      <Box sx={{ flexGrow: 1, minHeight: 180 }}>
        {data.by_project.length === 0 ? (
          <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
            <Typography variant="body2" color="text.secondary">
              No billable time logged in this range.
            </Typography>
          </Stack>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.by_project}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 16, bottom: 0 }}
            >
              <XAxis type="number" stroke={c.textMuted} fontSize={12} />
              <YAxis
                type="category"
                dataKey="project_name"
                stroke={c.textMuted}
                fontSize={12}
                width={120}
              />
              <Tooltip
                cursor={{ fill: c.primarySoft, opacity: 0.15 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]!.payload as EarningsData['by_project'][number];
                  return (
                    <ChartTooltip
                      title={d.project_name}
                      rows={[
                        {
                          label: 'Earned',
                          value: formatEarnings(d.earned_amount),
                          color: d.project_color,
                        },
                        { label: 'Hours', value: formatHours(d.minutes, 2) },
                        { label: 'MD', value: formatMd(d.mds) },
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="earned_amount" radius={[0, 4, 4, 0]}>
                {data.by_project.map((d) => (
                  <Cell key={d.project_id} fill={d.project_color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Box>
    </Stack>
  );
}
