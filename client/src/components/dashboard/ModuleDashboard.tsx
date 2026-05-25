import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Skeleton, Stack } from '@mui/material';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { useDashboardOverview } from '../../state/useDashboardOverview.js';
import { useProjects } from '../../state/useProjects.js';
import { useToast } from '../../state/useToast.js';
import type { InstanceView } from '../../state/useInstances.js';
import { DashboardHeader } from './DashboardHeader.js';
import { KpiTiles } from './KpiTiles.js';
import { WeekStrip } from './WeekStrip.js';
import { SessionsCard } from './SessionsCard.js';
import { LastThirtyDays } from './LastThirtyDays.js';
import { TopProjectsCard } from './TopProjectsCard.js';

dayjs.extend(isoWeek);

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
}

export function ModuleDashboard({
  instances,
  onActivateInstance,
  onKillInstance,
  onStartNewInstance,
}: ModuleDashboardProps) {
  const [today, setToday] = useState<string>(todayIso);
  const [weekAnchor, setWeekAnchor] = useState<string>(today);
  const [projectId, setProjectId] = useState<number | null>(readPersistedProject);
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

  useEffect(() => {
    persistProject(projectId);
  }, [projectId]);

  const overview = useDashboardOverview(projectId, weekAnchor, today);

  const projectList = useMemo(
    () => projectsState.projects.filter((p) => !p.archived),
    [projectsState.projects],
  );

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
              weekMinutes={overview.data.week.totalMinutes}
              monthMinutes={overview.data.month.minutes}
            />
            <WeekStrip
              week={overview.data.week}
              todayDate={today}
              onAnchorChange={setWeekAnchor}
            />
            <SessionsCard
              instances={instances}
              onActivateInstance={onActivateInstance}
              onKill={handleKill}
              onStartNewInstance={onStartNewInstance}
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
