import type React from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { useTimeTrackerView } from '../../state/useTimeTrackerView.js';
import { LIST_TABS, type ListTab } from '../../util/timetrackerUrl.js';
import { ListMode } from './ListMode.js';
import { ProjectsPage } from './ProjectsPage.js';

interface Props {
  /** True while the TimeTracker rail icon is the active module. */
  active: boolean;
  /** Switch to Instances and focus the given instance. */
  onActivateInstance(id: string): void;
  /** Switch to Instances and open the New-instance modal pre-filled. */
  onOpenNewInstanceForCwd(cwd: string): void;
}

const TAB_LABELS: Record<ListTab, string> = {
  projects: 'Projects',
  worklogs: 'Worklogs',
  grid: 'Task grid',
  timeoff: 'Time off',
  reports: 'Reports',
  board: 'Board',
};

/**
 * Root of the TimeTracker module. Routes the active tab to either the new
 * master-detail Projects page or the legacy list-mode container that still
 * hosts the other tabs (Worklogs, Task grid, Time off, Reports, Board).
 * The view state is persisted to URL hash + localStorage by the hook so
 * back/forward and deep links work.
 */
export function ModuleTimeTracker({ active, onActivateInstance, onOpenNewInstanceForCwd }: Props) {
  const { view, setTab, selectProject } = useTimeTrackerView(active);

  if (view.tab === 'projects') {
    return (
      <ListModeShell tab={view.tab} onTabChange={setTab}>
        <ProjectsPage
          selectedProjectId={view.projectId}
          onSelectProject={selectProject}
          onActivateInstance={onActivateInstance}
          onOpenNewInstanceForCwd={onOpenNewInstanceForCwd}
        />
      </ListModeShell>
    );
  }

  return (
    <ListMode
      tab={view.tab}
      onTabChange={setTab}
      onActivateInstance={onActivateInstance}
      onOpenNewInstanceForCwd={onOpenNewInstanceForCwd}
    />
  );
}

/**
 * Thin tab-bar wrapper so the new Projects page can render under the same
 * top-of-screen tabs as the other tab views. Kept inline here because it's
 * trivially small and lets ListMode stay focused on its own (non-projects)
 * content.
 */
function ListModeShell({
  tab,
  onTabChange,
  children,
}: {
  tab: ListTab;
  onTabChange(tab: ListTab): void;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, next: ListTab) => onTabChange(next)}
          variant="standard"
          sx={{ minHeight: 44 }}
        >
          {LIST_TABS.map((id) => (
            <Tab
              key={id}
              value={id}
              label={TAB_LABELS[id]}
              sx={{ textTransform: 'none', fontSize: 13, minHeight: 44, fontWeight: 500 }}
            />
          ))}
        </Tabs>
      </Box>
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>{children}</Box>
    </Box>
  );
}
