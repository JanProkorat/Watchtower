import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import TerminalIcon from '@mui/icons-material/Terminal';
import { useProjects } from '../../state/useProjects.js';
import { useInstanceLauncher } from '../../state/useInstanceLauncher.js';
import { ProjectDrawer } from './ProjectDrawer.js';
import { InstancesLaunchModal } from './InstancesLaunchModal.js';
import type { ProjectViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  onOpenProject(projectId: number): void;
  onActivateInstance(id: string): void;
  onOpenNewInstanceForCwd(cwd: string): void;
}

function formatTotal(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function ProjectsList({
  onOpenProject,
  onActivateInstance,
  onOpenNewInstanceForCwd,
}: Props) {
  const state = useProjects();
  const launcher = useInstanceLauncher({
    onActivateInstance,
    onSpawnNew: onOpenNewInstanceForCwd,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectViewPayload | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (project: ProjectViewPayload) => {
    setEditing(project);
    setDrawerOpen(true);
  };

  const totalMinutes = state.projects.reduce((acc, p) => acc + p.totalMinutes, 0);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <TextField
          size="small"
          placeholder="Search projects…"
          value={state.filter.search}
          onChange={(e) => state.setSearch(e.target.value)}
          sx={{ minWidth: 220 }}
        />
        <TextField
          select
          size="small"
          value={state.filter.kind}
          onChange={(e) => state.setKindFilter(e.target.value as 'work' | 'time_off' | 'all')}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="all">All kinds</MenuItem>
          <MenuItem value="work">Work</MenuItem>
          <MenuItem value="time_off">Time off</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          value={state.filter.archive}
          onChange={(e) => state.setArchiveFilter(e.target.value as 'active' | 'archived')}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="archived">Archived</MenuItem>
        </TextField>

        <Box sx={{ flex: 1 }} />

        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {state.projects.length} {state.projects.length === 1 ? 'project' : 'projects'}
          {totalMinutes > 0 ? ` · ${formatTotal(totalMinutes)} logged` : ''}
        </Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
          New project
        </Button>
      </Stack>

      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {state.error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {state.error}
          </Alert>
        )}

        {!state.loading && state.projects.length === 0 ? (
          <EmptyHint
            archive={state.filter.archive}
            search={state.filter.search}
            onCreate={openCreate}
          />
        ) : (
          <Stack spacing={0.75}>
            {state.projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                onOpen={() => onOpenProject(p.id)}
                onEdit={() => openEdit(p)}
                onArchive={() => void state.archive(p.id, !p.archived)}
                onLaunch={
                  p.folderPath ? () => void launcher.launch(p.name, p.folderPath!) : null
                }
              />
            ))}
          </Stack>
        )}
      </Box>

      <ProjectDrawer
        open={drawerOpen}
        project={editing}
        onClose={() => setDrawerOpen(false)}
        onSubmit={async (input) => {
          if (editing) {
            await state.update(editing.id, input);
          } else {
            await state.create(input);
          }
        }}
      />
      <InstancesLaunchModal
        open={launcher.pending !== null}
        projectName={launcher.pending?.projectName ?? ''}
        cwd={launcher.pending?.cwd ?? ''}
        runningInstances={launcher.pending?.runningInstances ?? []}
        onClose={launcher.dismiss}
        onActivateInstance={onActivateInstance}
        onSpawnNew={onOpenNewInstanceForCwd}
      />
    </Box>
  );
}

function ProjectRow({
  project,
  onOpen,
  onEdit,
  onArchive,
  onLaunch,
}: {
  project: ProjectViewPayload;
  onOpen(): void;
  onEdit(): void;
  onArchive(): void;
  /** Null when the project has no folder_path — the Open button is hidden. */
  onLaunch: (() => void) | null;
}) {
  return (
    <Box
      onClick={onOpen}
      sx={{
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr) 110px 160px 100px auto',
        gap: 2,
        alignItems: 'center',
        px: 1.5,
        py: 1.25,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        cursor: 'pointer',
        transition: 'background-color 80ms ease, border-color 80ms ease',
        ':hover': {
          backgroundColor: 'action.hover',
          borderColor: 'primary.main',
        },
      }}
    >
      <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: project.color }} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }} noWrap>
            {project.name}
          </Typography>
          {project.isDefault && (
            <Chip label="default" size="small" sx={{ height: 18, fontSize: 10 }} />
          )}
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
          {project.kind === 'work' ? 'work · billable' : 'time off · non-billable'}
          {project.folderPath ? ` · ${project.folderPath}` : ''}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
        {formatTotal(project.totalMinutes)}
      </Typography>
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', fontFamily: 'Menlo, monospace', fontSize: 11 }}
        noWrap
      >
        {project.jiraGlobs.length > 0 ? project.jiraGlobs.join(', ') : '—'}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {project.epicCount} {project.epicCount === 1 ? 'epic' : 'epics'}
      </Typography>
      <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
        {onLaunch ? (
          <Tooltip title="Open in Instances">
            <IconButton size="small" onClick={onLaunch}>
              <TerminalIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="No folder configured — set 'Location on disk' to enable">
            <span>
              <IconButton size="small" disabled>
                <TerminalIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title="Edit">
          <IconButton size="small" onClick={onEdit}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={project.archived ? 'Unarchive' : 'Archive'}>
          <IconButton size="small" onClick={onArchive}>
            {project.archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

function EmptyHint({
  archive,
  search,
  onCreate,
}: {
  archive: 'active' | 'archived';
  search: string;
  onCreate(): void;
}) {
  const isSearchEmpty = search.trim().length > 0;
  if (isSearchEmpty) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
        <Typography variant="body2">No projects match your search.</Typography>
      </Box>
    );
  }
  if (archive === 'archived') {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
        <Typography variant="body2">No archived projects.</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
      <Typography variant="body2" sx={{ mb: 1.5 }}>
        No projects yet.
      </Typography>
      <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onCreate}>
        Create your first project
      </Button>
    </Box>
  );
}
