import { useEffect, useState } from 'react';
import { Alert, Box, Skeleton, Stack } from '@mui/material';
import dayjs from 'dayjs';
import { useDashboardOverview } from '../../state/useDashboardOverview.js';
import { useProjects } from '../../state/useProjects.js';
import { useTokenUsage } from '../../state/useTokenUsage.js';
import { useToast } from '../../state/useToast.js';
import type { InstanceView } from '../../state/useInstances.js';
import { DashboardHeader } from './DashboardHeader.js';
import { KpiTiles } from './KpiTiles.js';
import { SprintStrip } from './SprintStrip.js';
import { SessionsCard } from './SessionsCard.js';
import { LastThirtyDays } from './LastThirtyDays.js';
import { TopProjectsCard } from './TopProjectsCard.js';
import { ActiveContractsCard } from './ActiveContractsCard.js';
import { TokenUsageCard } from './TokenUsageCard.js';

const FILTER_KEY = 'watchtower.dashboard.projectIds';

function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

function readPersistedProjects(): number[] | null {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (v === null) return null; // never persisted → caller seeds pinned
    const arr = JSON.parse(v) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return null;
  }
}

function persistProjects(ids: number[]) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(ids));
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
  const [projectIds, setProjectIds] = useState<number[]>(() => readPersistedProjects() ?? []);
  const [defaultSeeded, setDefaultSeeded] = useState(false);
  const projectsState = useProjects();
  const tokenUsage = useTokenUsage();
  const { showError } = useToast();

  // Refresh today's date if the page outlives midnight.
  useEffect(() => {
    const t = setInterval(() => {
      const next = todayIso();
      setToday((curr) => (curr === next ? curr : next));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Seed all pinned projects on first load, but only if nothing was ever
  // persisted (so we never override an explicit "All projects" [] the user
  // chose). Wait for projects to load before deciding.
  useEffect(() => {
    if (defaultSeeded) return;
    if (projectsState.projects.length === 0) return;
    let persisted: string | null = null;
    try {
      persisted = localStorage.getItem(FILTER_KEY);
    } catch { /* ignore */ }
    setDefaultSeeded(true);
    if (persisted !== null) return; // explicit choice (including []) preserved
    const pinned = projectsState.projects.filter((p) => p.isPinned).map((p) => p.id);
    if (pinned.length > 0) setProjectIds(pinned);
  }, [defaultSeeded, projectsState.projects]);

  // Persist only AFTER seeding has resolved — otherwise the initial [] would be
  // written before the seed effect reads it, making the seed think the user
  // had explicitly chosen "All projects".
  useEffect(() => {
    if (!defaultSeeded) return;
    persistProjects(projectIds);
  }, [defaultSeeded, projectIds]);

  const overview = useDashboardOverview(projectIds, sprintAnchor, today);

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
        projectIds={projectIds}
        onProjectsChange={setProjectIds}
        todayDate={today}
      />

      {projectsState.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load projects: {projectsState.error}
        </Alert>
      )}

      {overview.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {overview.error}
        </Alert>
      )}

      <Stack spacing={2}>
        <TokenUsageCard usage={tokenUsage} />
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
