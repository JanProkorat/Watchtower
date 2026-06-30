import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { glassSurface } from '../../theme/glass.js';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import TerminalIcon from '@mui/icons-material/Terminal';
import CodeIcon from '@mui/icons-material/Code';
import { useProject } from '../../state/useProject.js';
import { useContracts } from '../../state/useContracts.js';
import { useInstanceLauncher } from '../../state/useInstanceLauncher.js';
import { useToast, toastMessage } from '../../state/useToast.js';
import { InstancesLaunchModal } from './InstancesLaunchModal.js';
import { RateHistorySection } from './RateHistorySection.js';
import { EpicsTreeView } from './EpicsTreeView.js';
import type {
  ContractViewPayload,
  ProjectViewPayload,
} from '@watchtower/shared/ipcContract.js';

interface Props {
  projectId: number;
  /**
   * Bumped by the parent after an edit-drawer save so this pane re-fetches
   * its locally-cached project — necessary because the edit goes through
   * `useProjects` (list-level) while the pane reads from `useProject`
   * (per-id), and the two caches are independent.
   */
  refreshTick?: number;
  onEdit(project: ProjectViewPayload): void;
  onDeleted(): void;
  onActivateInstance(id: string): void;
  onOpenNewInstanceForCwd(cwd: string): void;
  onOpenTerminalForCwd?(cwd: string): void;
}

function fmtHoursTotal(minutes: number): string {
  if (minutes <= 0) return '0 h';
  // Use MD when the figure exceeds one full 8h workday — matches the
  // TimeTracker reference style.
  const hours = minutes / 60;
  if (hours >= 8) {
    const md = hours / 8;
    return `${md.toFixed(1)} MD`;
  }
  if (Number.isInteger(hours)) return `${hours} h`;
  return `${hours.toFixed(1)} h`;
}

function formatRate(c: ContractViewPayload): string {
  const amount = c.rateAmount.toLocaleString('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const unit = c.rateType === 'hourly' ? '/ hr' : '/ MD';
  return `${amount} Kč ${unit}`;
}

/**
 * Right pane of the redesigned Projects page. Renders a single, scrollable
 * stack for the selected project: header card (name + favourite + rate +
 * actions), inline rate-history card, and the project's epics list. No
 * sub-tabs — everything is visible at once.
 */
export function ProjectDetailPane({
  projectId,
  refreshTick = 0,
  onEdit,
  onDeleted,
  onActivateInstance,
  onOpenNewInstanceForCwd,
  onOpenTerminalForCwd,
}: Props) {
  const theme = useTheme();
  const state = useProject(projectId);
  useEffect(() => {
    if (refreshTick > 0) void state.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);
  const contracts = useContracts(projectId);
  const { showError } = useToast();
  const launcher = useInstanceLauncher({
    onActivateInstance,
    onSpawnNew: onOpenNewInstanceForCwd,
  });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const activeContract = useMemo(
    () => contracts.contracts.find((c) => c.isActive) ?? null,
    [contracts.contracts],
  );

  if (state.loading && !state.project) {
    return (
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={160} />
          <Skeleton variant="rounded" height={64} />
          <Skeleton variant="rounded" height={64} />
        </Stack>
      </Box>
    );
  }
  if (state.error) {
    return (
      <Box sx={{ flex: 1, p: 3 }}>
        <Alert severity="error">{state.error}</Alert>
      </Box>
    );
  }
  if (!state.project) {
    return null;
  }

  const project = state.project;

  const toggleDefault = async () => {
    try {
      await state.update({ isDefault: !project.isDefault });
    } catch (err) {
      showError(toastMessage(err));
    }
  };

  const archive = async () => {
    try {
      await state.archive(!project.archived);
    } catch (err) {
      showError(toastMessage(err));
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Delete project "${project.name}"? This removes all epics, tasks, worklogs, and contracts. This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await window.watchtower.invoke('projects:delete', { id: projectId });
      onDeleted();
    } catch (err) {
      showError(toastMessage(err));
    }
  };

  const launchInstances = project.folderPath
    ? () => void launcher.launch(project.name, project.folderPath!)
    : null;

  const openInVSCode = project.folderPath
    ? () => {
        window.watchtower
          .invoke('openInVSCode', { path: project.folderPath! })
          .then((r) => {
            if (!r.ok) showError(r.error ?? 'Could not open in VS Code');
          })
          .catch((err) => showError(toastMessage(err)));
      }
    : null;

  return (
    <Box
      sx={{
        flex: 1,
        overflow: 'auto',
        bgcolor: 'background.default',
      }}
    >
      <Stack spacing={2.5} sx={{ p: 3 }}>
        {/* Header card — raw Box, so Phase-A Paper override doesn't apply; use glassSurface. */}
        <Box
          sx={{
            ...glassSurface(theme, { elevation: 1 }),
            borderRadius: 2,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ height: 3, bgcolor: project.color }} />
          <Box sx={{ p: 2.5 }}>
            <Stack direction="row" alignItems="flex-start" spacing={1.5}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                  {project.name}
                  {project.archived && (
                    <Chip
                      label="archived"
                      size="small"
                      color="warning"
                      variant="outlined"
                      sx={{ ml: 1.5, height: 22, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}
                    />
                  )}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  <Chip
                    label={`${project.epicCount} ${project.epicCount === 1 ? 'epic' : 'epics'}`}
                    size="small"
                    sx={{
                      height: 24,
                      fontSize: 12,
                      fontWeight: 500,
                      bgcolor: 'action.hover',
                      color: 'text.primary',
                      borderRadius: 999,
                    }}
                  />
                  <Chip
                    label={fmtHoursTotal(project.totalMinutes)}
                    size="small"
                    sx={{
                      height: 24,
                      fontSize: 12,
                      fontWeight: 600,
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      borderRadius: 999,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                </Stack>
              </Box>

              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                <Tooltip title={project.isDefault ? 'Default project' : 'Make default'}>
                  <IconButton size="small" onClick={() => void toggleDefault()}>
                    {project.isDefault ? (
                      <StarIcon sx={{ color: 'warning.main' }} />
                    ) : (
                      <StarBorderIcon sx={{ color: 'text.disabled' }} />
                    )}
                  </IconButton>
                </Tooltip>
                {activeContract && (
                  <Chip
                    icon={<AttachMoneyIcon sx={{ fontSize: 16 }} />}
                    label={formatRate(activeContract)}
                    size="small"
                    sx={{
                      bgcolor: 'success.dark',
                      color: 'success.contrastText',
                      borderRadius: 999,
                      height: 28,
                      fontSize: 12,
                      fontWeight: 600,
                      px: 1,
                      '& .MuiChip-icon': { color: 'success.contrastText', ml: 0.5 },
                    }}
                  />
                )}
                <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)}>
                  <MoreVertIcon />
                </IconButton>
              </Stack>
            </Stack>
          </Box>
        </Box>

        {/* Rate history */}
        <RateHistorySection projectId={projectId} />

        {/* Epics inline */}
        <EpicsTreeView
          projectId={projectId}
          embedded
          projectName={project.name}
          projectColor={project.color}
          taskUrlTemplate={project.taskUrlTemplate}
        />
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor !== null}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onEdit(project);
          }}
        >
          Edit project
        </MenuItem>
        {launchInstances && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              launchInstances();
            }}
          >
            <TerminalIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />
            Open in Instances
          </MenuItem>
        )}
        {onOpenTerminalForCwd && project.folderPath && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onOpenTerminalForCwd(project.folderPath!);
            }}
          >
            <TerminalIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />
            Open terminal
          </MenuItem>
        )}
        {openInVSCode && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              openInVSCode();
            }}
          >
            <CodeIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />
            Open in VS Code
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void archive();
          }}
        >
          {project.archived ? 'Unarchive' : 'Archive'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void remove();
          }}
          sx={{ color: 'error.main' }}
        >
          Delete project
        </MenuItem>
      </Menu>

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
