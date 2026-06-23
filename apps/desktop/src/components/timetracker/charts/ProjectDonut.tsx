import { Box, Stack, Typography } from '@mui/material';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip';
import { formatHours, formatMd } from '../../../util/format';

export interface ProjectSlice {
  project_id: number;
  project_name: string;
  project_color: string;
  minutes: number;
  mds: number;
}

interface Props {
  data: ProjectSlice[];
}

export default function ProjectDonut({ data }: Props) {
  const total = data.reduce((acc, d) => acc + d.minutes, 0);
  const totalMds = data.reduce((acc, d) => acc + d.mds, 0);

  if (data.length === 0 || total === 0) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
        <Typography variant="body2" color="text.secondary">
          No time logged in this range.
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ height: '100%' }}>
      <Box sx={{ flex: '1 1 50%', position: 'relative', minHeight: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="minutes"
              nameKey="project_name"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.project_id} fill={d.project_color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as ProjectSlice;
                return (
                  <ChartTooltip
                    title={d.project_name}
                    rows={[
                      { label: 'Hours', value: formatHours(d.minutes, 2), color: d.project_color },
                      { label: 'MD', value: formatMd(d.mds) },
                      {
                        label: 'Share',
                        value: `${((d.minutes / total) * 100).toFixed(1)}%`,
                      },
                    ]}
                  />
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Typography variant="h4" className="tt-num" sx={{ fontWeight: 600, lineHeight: 1 }}>
            {formatHours(total, 1)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            total hours
          </Typography>
          <Typography variant="caption" color="text.secondary" className="tt-num" sx={{ mt: 0.5 }}>
            {formatMd(totalMds)} MD
          </Typography>
        </Box>
      </Box>
      <Stack spacing={0.75} sx={{ flex: '1 1 50%', overflowY: 'auto', minHeight: 0 }}>
        {data.map((d) => {
          const pct = (d.minutes / total) * 100;
          return (
            <Stack
              key={d.project_id}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ minWidth: 0 }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: d.project_color,
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                {d.project_name}
              </Typography>
              <Typography variant="body2" className="tt-num" color="text.secondary">
                {formatHours(d.minutes, 1)}h
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                className="tt-num"
                sx={{ width: 56, textAlign: 'right' }}
              >
                {formatMd(d.mds)} MD
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                className="tt-num"
                sx={{ width: 40, textAlign: 'right' }}
              >
                {pct.toFixed(0)}%
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}
