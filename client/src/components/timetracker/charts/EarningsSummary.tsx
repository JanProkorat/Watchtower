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
import { formatEarnings, formatHours } from '../../../util/format';

export interface EarningsData {
  billable_minutes: number;
  unbillable_minutes: number;
  total_earned: Record<string, number>;
  avg_effective_hourly_rate: Record<string, number>;
  by_project: {
    project_id: number;
    project_name: string;
    project_color: string;
    currency: string;
    earned_amount: number;
    minutes: number;
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
  const currencies = Object.keys(data.total_earned);
  const primaryCurrency = currencies[0];
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
            value={
              primaryCurrency
                ? formatEarnings(data.total_earned[primaryCurrency]!, primaryCurrency)
                : '—'
            }
            helper={
              currencies.length > 1
                ? currencies
                    .slice(1)
                    .map((cur) => formatEarnings(data.total_earned[cur]!, cur))
                    .join(', ')
                : undefined
            }
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <MetricTile
            label="Billable hours"
            value={formatHours(totalBillable, 1)}
            helper={`${billablePct.toFixed(0)}% of total`}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <MetricTile
            label="Unbillable hours"
            value={formatHours(totalUnbillable, 1)}
            helper={totalAll > 0 ? `${(100 - billablePct).toFixed(0)}% of total` : undefined}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <MetricTile
            label="Avg rate"
            value={
              primaryCurrency && data.avg_effective_hourly_rate[primaryCurrency] != null
                ? `${data.avg_effective_hourly_rate[primaryCurrency]!.toFixed(2)} ${primaryCurrency}/h`
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
                          value: formatEarnings(d.earned_amount, d.currency),
                          color: d.project_color,
                        },
                        { label: 'Hours', value: formatHours(d.minutes, 2) },
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
