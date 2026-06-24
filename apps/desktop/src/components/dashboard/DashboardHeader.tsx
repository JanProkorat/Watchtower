import { Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ProjectViewPayload } from '@watchtower/shared/ipcContract.js';
import { formatWeekdayDateLongCz } from '../../util/format.js';

export interface DashboardHeaderProps {
  projects: ProjectViewPayload[];
  projectId: number | null;
  onProjectChange(next: number | null): void;
  todayDate: string;
}

export function DashboardHeader({ projects, projectId, onProjectChange, todayDate }: DashboardHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', md: 'center' }}
      justifyContent="space-between"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        backgroundColor: 'background.default',
        py: 0.5,
        mb: 1.5,
      }}
    >
      <Typography variant="h5" sx={{ fontWeight: 600 }}>Dashboard</Typography>
      <Stack direction="row" spacing={3} alignItems="center">
        <TextField
          select
          size="small"
          label="Project"
          value={projectId ?? ''}
          onChange={(e) => onProjectChange(e.target.value === '' ? null : Number(e.target.value))}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All projects</MenuItem>
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: p.color }} />
                <span>{p.name}</span>
              </Stack>
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {formatWeekdayDateLongCz(todayDate)}
        </Typography>
      </Stack>
    </Stack>
  );
}
