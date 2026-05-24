import { useTimeTrackerView } from '../../state/useTimeTrackerView.js';
import { ListMode } from './ListMode.js';
import { DetailMode } from './DetailMode.js';

interface Props {
  /** True while the TimeTracker rail icon is the active module. */
  active: boolean;
  /** Switch to Instances and focus the given instance. */
  onActivateInstance(id: string): void;
  /** Switch to Instances and open the New-instance modal pre-filled. */
  onOpenNewInstanceForCwd(cwd: string): void;
}

/**
 * Root of the TimeTracker module. Picks between list and detail mode based on
 * the URL-hash–persisted view state and forwards tab-change events back to
 * the hook so the hash, history, and localStorage stay in sync.
 *
 * Each tab body is a placeholder for Phase 13. Phases 14–20 replace them with
 * the real Projects list, Worklogs view, Task grid, Time off calendar, and
 * Reports panels respectively.
 */
export function ModuleTimeTracker({ active, onActivateInstance, onOpenNewInstanceForCwd }: Props) {
  const { view, setListTab, openProject, closeProject, setDetailTab } = useTimeTrackerView(active);

  if (view.mode === 'detail') {
    return (
      <DetailMode
        projectId={view.projectId}
        tab={view.tab}
        onTabChange={setDetailTab}
        onBack={closeProject}
        onActivateInstance={onActivateInstance}
        onOpenNewInstanceForCwd={onOpenNewInstanceForCwd}
      />
    );
  }

  return (
    <ListMode
      tab={view.tab}
      onTabChange={setListTab}
      onOpenProject={(id) => openProject(id, 'epics')}
      onActivateInstance={onActivateInstance}
      onOpenNewInstanceForCwd={onOpenNewInstanceForCwd}
    />
  );
}
