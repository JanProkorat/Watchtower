import { useEffect, useState } from 'react';
import { Alert, Box, Skeleton, Stack } from '@mui/material';
import dayjs from 'dayjs';
import { useDashboardOverview } from '../../state/useDashboardOverview.js';
import { useProjects } from '../../state/useProjects.js';
import { useToast } from '../../state/useToast.js';
import type { InstanceView } from '../../state/useInstances.js';
import { DashboardHeader } from './DashboardHeader.js';
import { KpiTiles } from './KpiTiles.js';
import { SprintStrip } from './SprintStrip.js';
import { SessionsCard } from './SessionsCard.js';
import { LastThirtyDays } from './LastThirtyDays.js';
import { TopProjectsCard } from './TopProjectsCard.js';
import { ActiveContractsCard } from './ActiveContractsCard.js';

const FILTER_KEY = 'watchtower.dashboard.projectId';

function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

function readPersistedProject(): number | null {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function persistProject(id: number | null) {
  try {
    if (id == null) localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, String(id));
  } catch { /* best-effort */ }
}

export interface ModuleDashboardProps {
  instances: InstanceView[];
  onActivateInstance(id: string): void;
  onKillInstance(id: string): Promise<void>;
  onStartNewInstance(): void;
  /** Click on an active-contracts card → switch to the TimeTracker module
   *  with the project selected. */
  onOpenProject(projectId: number): void;
}

export function ModuleDashboard({
  instances,
  onActivateInstance,
  onKillInstance,
  onStartNewInstance,
  onOpenProject,
}: ModuleDashboardProps) {
  const [today, setToday] = useState<string>(todayIso);
  const [sprintAnchor, setSprintAnchor] = useState<string>(today);
  const [projectId, setProjectId] = useState<number | null>(readPersistedProject);
  const [defaultSeeded, setDefaultSeeded] = useState(false);
  const projectsState = useProjects();
  const { showError } = useToast();

  // Refresh today's date if the page outlives midnight.
  useEffect(() => {
    const t = setInterval(() => {
      const next = todayIso();
      setToday((curr) => (curr === next ? curr : next));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Seed default project on first load if no persisted selection.
  useEffect(() => {
    if (defaultSeeded) return;
    if (projectId != null) {
      setDefaultSeeded(true);
      return;
    }
    // Only seed if nothing was ever persisted (so we don't override an explicit
    // "All projects" choice the user made).
    let persisted: string | null = null;
    try {
      persisted = localStorage.getItem(FILTER_KEY);
    } catch { /* ignore */ }
    if (persisted !== null) {
      setDefaultSeeded(true);
      return;
    }
    const def = projectsState.projects.find((p) => p.isDefault);
    if (def) setProjectId(def.id);
    setDefaultSeeded(true);
  }, [defaultSeeded, projectId, projectsState.projects]);

  useEffect(() => {
    persistProject(projectId);
  }, [projectId]);

  const overview = useDashboardOverview(projectId, sprintAnchor, today);

  // useProjects() defaults to the 'active' filter — server returns only non-archived rows.
  const projectList = projectsState.projects;

  const handleKill = async (id: string) => {
    try {
      await onKillInstance(id);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'auto',
        px: 2.75,
        pb: 4,
        pt: 2.5,
      }}
    >
      <DashboardHeader
        projects={projectList}
        projectId={projectId}
        onProjectChange={setProjectId}
        todayDate={today}
      />

      {projectsState.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Nepodařilo se načíst projekty: {projectsState.error}
        </Alert>
      )}

      {overview.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {overview.error}
        </Alert>
      )}

      <Stack spacing={2}>
        {overview.loading && !overview.data ? (
          <>
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="rounded" height={260} />
            <Skeleton variant="rounded" height={160} />
            <Skeleton variant="rounded" height={220} />
          </>
        ) : overview.data ? (
          <>
            <KpiTiles
              todayMinutes={overview.data.today.minutes}
              sprintMinutes={overview.data.sprint.totalMinutes}
              monthMinutes={overview.data.month.minutes}
              todayEarned={overview.data.today.earned}
              sprintEarned={overview.data.sprint.totalEarned}
              monthEarned={overview.data.month.earned}
            />
            <SessionsCard
              instances={instances}
              onActivateInstance={onActivateInstance}
              onKill={handleKill}
              onStartNewInstance={onStartNewInstance}
            />
            <SprintStrip
              sprint={overview.data.sprint}
              todayDate={today}
              onAnchorChange={setSprintAnchor}
            />
            <ActiveContractsCard
              contracts={overview.data.activeContracts}
              onOpenProject={onOpenProject}
            />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Box sx={{ flex: 2, minWidth: 0 }}>
                <LastThirtyDays {...overview.data.heatmap30d} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <TopProjectsCard projects={overview.data.topProjects} />
              </Box>
            </Stack>
          </>
        ) : null}
      </Stack>
    </Box>
  );
}
