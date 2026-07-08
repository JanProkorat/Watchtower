import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useProjects } from '../../state/useProjects.js';
import { ProjectsSidebar } from './ProjectsSidebar.js';
import { ProjectDetailPane } from './ProjectDetailPane.js';
import { ProjectDrawer } from './ProjectDrawer.js';
import type { ProjectViewPayload } from '@watchtower/shared/ipcContract.js';

interface Props {
  selectedProjectId: number | null;
  onSelectProject(projectId: number | null): void;
  onOpenInstanceForCwd(cwd: string): void;
  onOpenTerminalForCwd?(cwd: string): void;
}

/**
 * Projects page — master-detail layout. The left sidebar lists every
 * active project; the right pane shows the currently selected project's
 * detail (header + rate history + epics). Switching selection swaps the
 * right pane without leaving the page.
 *
 * Selection rules:
 *   - URL/hook decides what's "selected" (`selectedProjectId`).
 *   - If nothing is selected but the list is non-empty, auto-pick the
 *     user's default project (else the first one) and write that to the
 *     URL so refresh / back-button preserve it.
 *   - On a fresh install (no projects), the right pane shows an empty
 *     hint pointing at "+ New project" in the sidebar.
 */
export function ProjectsPage({
  selectedProjectId,
  onSelectProject,
  onOpenInstanceForCwd,
  onOpenTerminalForCwd,
}: Props) {
  const projectsState = useProjects();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Track the id, not a snapshot — that way the drawer always reads the
  // latest payload from `projectsState.projects` (which refreshes on every
  // mutation). Snapshots go stale after a save and the form re-seeds from
  // pre-edit data on the next open.
  const [editingId, setEditingId] = useState<number | null>(null);
  // Bumped after each edit so ProjectDetailPane re-fetches its independently
  // cached project payload — list-level + per-id caches don't share state.
  const [refreshTick, setRefreshTick] = useState(0);
  const editing = editingId === null
    ? null
    : projectsState.projects.find((p) => p.id === editingId) ?? null;

  // Auto-select once the list loads: prefer default, fall back to first.
  // We only nudge the selection when nothing is set or when the previously
  // selected project no longer exists (e.g. archived / deleted).
  const fallbackId = useMemo(() => {
    if (projectsState.projects.length === 0) return null;
    return (
      projectsState.projects.find((p) => p.isDefault)?.id ??
      projectsState.projects[0]!.id
    );
  }, [projectsState.projects]);

  useEffect(() => {
    if (projectsState.loading) return;
    const stillValid =
      selectedProjectId !== null &&
      projectsState.projects.some((p) => p.id === selectedProjectId);
    if (stillValid) return;
    if (fallbackId !== selectedProjectId) {
      onSelectProject(fallbackId);
    }
  }, [
    projectsState.loading,
    projectsState.projects,
    selectedProjectId,
    fallbackId,
    onSelectProject,
  ]);

  const openCreate = () => {
    setEditingId(null);
    setDrawerOpen(true);
  };

  const openEdit = (project: ProjectViewPayload) => {
    setEditingId(project.id);
    setDrawerOpen(true);
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <ProjectsSidebar
        projects={projectsState.projects}
        selectedId={selectedProjectId}
        search={projectsState.filter.search}
        onSearchChange={projectsState.setSearch}
        onSelect={onSelectProject}
        onCreate={openCreate}
        loading={projectsState.loading}
        error={projectsState.error}
      />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {selectedProjectId !== null ? (
          <ProjectDetailPane
            key={selectedProjectId}
            projectId={selectedProjectId}
            refreshTick={refreshTick}
            onEdit={openEdit}
            onDeleted={async () => {
              onSelectProject(null);
              await projectsState.refresh();
            }}
            onOpenInstanceForCwd={onOpenInstanceForCwd}
            onOpenTerminalForCwd={onOpenTerminalForCwd}
          />
        ) : (
          <EmptyDetail hasProjects={projectsState.projects.length > 0} />
        )}
      </Box>

      <ProjectDrawer
        open={drawerOpen}
        project={editing}
        onClose={() => setDrawerOpen(false)}
        onSubmit={async (input) => {
          if (editing) {
            await projectsState.update(editing.id, input);
            setRefreshTick((v) => v + 1);
          } else {
            const created = await projectsState.create(input);
            onSelectProject(created.id);
          }
        }}
      />
    </Box>
  );
}

function EmptyDetail({ hasProjects }: { hasProjects: boolean }) {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.secondary',
        bgcolor: 'background.default',
      }}
    >
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        {hasProjects ? 'Select a project from the sidebar.' : 'Click + New project to get started.'}
      </Typography>
    </Box>
  );
}
