import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import type { ProjectViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  project: ProjectViewPayload;
  onEdit(): void;
  onArchive(): void;
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function ProjectDetailHeader({ project, onEdit, onArchive }: Props) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        px: 2,
        py: 2,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          backgroundColor: project.color,
          flexShrink: 0,
        }}
      />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 500 }} noWrap>
            {project.name}
          </Typography>
          {project.isDefault && (
            <Chip label="default" size="small" sx={{ height: 20, fontSize: 11 }} />
          )}
          {project.archived && (
            <Chip
              label="archived"
              size="small"
              color="warning"
              variant="outlined"
              sx={{ height: 20, fontSize: 11 }}
            />
          )}
        </Stack>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}
        >
          {project.kind === 'work' ? 'work · billable' : 'time off · non-billable'}
          {project.jiraGlobs.length > 0 && (
            <>
              {' · Jira '}
              <code style={{ fontFamily: 'Menlo, monospace', fontSize: 11 }}>
                {project.jiraGlobs.join(', ')}
              </code>
            </>
          )}
          {project.folderPath && (
            <>
              {' · '}
              <code style={{ fontFamily: 'Menlo, monospace', fontSize: 11 }}>
                {project.folderPath}
              </code>
            </>
          )}
        </Typography>
      </Box>

      <Stack direction="row" spacing={3} sx={{ flexShrink: 0 }}>
        <Stat label="Total" value={formatHours(project.totalMinutes)} />
        <Stat label="This week" value="—" hint="Phase 16" />
        <Stat
          label="Epics"
          value={String(project.epicCount)}
        />
      </Stack>

      <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditIcon fontSize="small" />}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Tooltip title={project.archived ? 'Unarchive' : 'Archive'}>
          <IconButton size="small" onClick={onArchive}>
            {project.archived ? (
              <UnarchiveIcon fontSize="small" />
            ) : (
              <ArchiveIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box sx={{ textAlign: 'right' }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontSize: 10,
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}
