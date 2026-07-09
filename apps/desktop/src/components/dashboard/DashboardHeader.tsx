import { Box, Checkbox, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { ProjectViewPayload } from '@watchtower/shared/ipcContract.js';
import { formatWeekdayDateLongCz } from '../../util/format.js';

export interface DashboardHeaderProps {
  projects: ProjectViewPayload[];
  projectIds: number[];
  onProjectsChange(next: number[]): void;
  todayDate: string;
}

export function DashboardHeader({ projects, projectIds, onProjectsChange, todayDate }: DashboardHeaderProps) {
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
          label="Projects"
          InputLabelProps={{ shrink: true }}
          value={projectIds.map(String)}
          onChange={(e) => {
            const raw = e.target.value as unknown as string[];
            onProjectsChange(raw.map(Number));
          }}
          SelectProps={{
            multiple: true,
            displayEmpty: true,
            renderValue: (selected) => {
              const ids = (selected as string[]).map(Number);
              if (ids.length === 0) return 'All projects';
              const names = ids
                .map((id) => projects.find((p) => p.id === id)?.name)
                .filter((n): n is string => Boolean(n));
              return names.join(', ');
            },
          }}
          sx={{ minWidth: 220, maxWidth: 340 }}
        >
          {projects.map((p) => (
            <MenuItem key={p.id} value={String(p.id)}>
              <Checkbox
                size="small"
                checked={projectIds.includes(p.id)}
                sx={{ ml: -1, mr: 0.5 }}
              />
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
