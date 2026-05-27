import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useProjects } from '../../state/useProjects.js';
import { ProjectsSidebar } from './ProjectsSidebar.js';
import { ProjectDetailPane } from './ProjectDetailPane.js';
import { ProjectDrawer } from './ProjectDrawer.js';
import type { ProjectViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  selectedProjectId: number | null;
  onSelectProject(projectId: number | null): void;
  onActivateInstance(id: string): void;
  onOpenNewInstanceForCwd(cwd: string): void;
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
  onActivateInstance,
  onOpenNewInstanceForCwd,
}: Props) {
  const projectsState = useProjects();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectViewPayload | null>(null);

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
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (project: ProjectViewPayload) => {
    setEditing(project);
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
            onEdit={openEdit}
            onDeleted={async () => {
              onSelectProject(null);
              await projectsState.refresh();
            }}
            onActivateInstance={onActivateInstance}
            onOpenNewInstanceForCwd={onOpenNewInstanceForCwd}
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
