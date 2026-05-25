import { Box, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import type { DashboardTopProjectPayload } from '../../../../shared/ipcContract.js';
import { formatHours } from '../../util/format.js';

const ROW_CAP = 8;

export interface TopProjectsCardProps {
  projects: DashboardTopProjectPayload[];
}

export function TopProjectsCard({ projects }: TopProjectsCardProps) {
  const top = projects.slice(0, ROW_CAP);
  const max = top[0]?.minutes ?? 0;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>Top projects this month</Typography>
      {top.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No projects with logged time this month.
        </Typography>
      ) : (
        <Stack spacing={1.25}>
          {top.map((p) => {
            const ratio = max > 0 ? (p.minutes / max) * 100 : 0;
            return (
              <Box key={p.projectId}>
                <Stack direction="row" alignItems="center" spacing={1.25}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: p.projectColor ?? 'primary.main' }} />
                  <Typography
                    sx={{
                      flex: 1, minWidth: 0,
                      fontSize: 13,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {p.projectName}
                  </Typography>
                  <Typography
                    sx={{ fontSize: 13, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatHours(p.minutes, 1)}h
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={ratio}
                  sx={{
                    mt: 0.5,
                    ml: '18px',
                    height: 4,
                    borderRadius: 1,
                    backgroundColor: 'background.default',
                    '& .MuiLinearProgress-bar': { backgroundColor: p.projectColor ?? 'primary.main' },
                  }}
                />
              </Box>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
