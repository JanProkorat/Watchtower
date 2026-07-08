import { Box } from '@mui/material';
import type { TimeTrackerView } from '../../util/timetrackerUrl.js';
import { ListMode } from './ListMode.js';
import { ProjectsPage } from './ProjectsPage.js';

interface Props {
  /** Lifted view state — sub-tab + selected project. Owned by `App`. */
  view: TimeTrackerView;
  /** Switch the projects-tab selection. */
  onSelectProject(projectId: number | null): void;
  /** Switch to Instances and spawn a claude session in the given folder. */
  onOpenInstanceForCwd(cwd: string): void;
  /** Switch to Instances and spawn a plain shell in the given folder. */
  onOpenTerminalForCwd?(cwd: string): void;
}

/**
 * Root of the Billing module (formerly TimeTracker). The active sub-tab is
 * driven entirely by the side nav rail — the in-page tab strip that used to
 * live here has moved to the rail as a collapsible sub-section under Billing.
 */
export function ModuleTimeTracker({
  view,
  onSelectProject,
  onOpenInstanceForCwd,
  onOpenTerminalForCwd,
}: Props) {
  // Small top padding applied uniformly to every Billing sub-page so the
  // content doesn't crowd against the chrome at the top of the renderer.
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, pt: 1.5 }}>
      {view.tab === 'projects' ? (
        <ProjectsPage
          selectedProjectId={view.projectId}
          onSelectProject={onSelectProject}
          onOpenInstanceForCwd={onOpenInstanceForCwd}
          onOpenTerminalForCwd={onOpenTerminalForCwd}
        />
      ) : (
        <ListMode tab={view.tab} />
      )}
    </Box>
  );
}
