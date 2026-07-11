import { Box } from '@mui/material';
import { WorkspaceNodeView } from './WorkspaceNodeView.js';
import type { PersistedLayout, TabRecord } from '@watchtower/shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';
import type { WorkspaceLayoutActions } from '../../state/useWorkspaceLayout.js';

interface Props {
  layout: PersistedLayout;
  tabs: TabRecord[];
  instances: InstanceView[];
  actions: WorkspaceLayoutActions;
  dragInProgress: boolean;
  dashboardOnNew(): void;
  onCloseColumn(instanceId: string): void;
  onRestartColumn?(instanceId: string): void;
  onHideSession(instanceId: string): void;
  onUnhideSession(instanceId: string): void;
  onAddSession(tabId: string): void;
  onAddSessionAfter(afterInstanceId: string, cwd: string, kind: 'claude' | 'shell'): void;
  onSetTask?(instanceId: string, taskId: number | null): void;
}

export function WorkspaceRoot({
  layout,
  tabs,
  instances,
  actions,
  dragInProgress,
  dashboardOnNew,
  onCloseColumn,
  onRestartColumn,
  onHideSession,
  onUnhideSession,
  onAddSession,
  onAddSessionAfter,
  onSetTask,
}: Props) {
  return (
    <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <WorkspaceNodeView
        node={layout.root}
        tabs={tabs}
        focusedLeafId={layout.focusedLeafId}
        instances={instances}
        dragInProgress={dragInProgress}
        onFocusColumn={actions.focusColumnInTab}
        onFocusLeaf={actions.focusLeaf}
        onResizeSplit={actions.setSplitSizes}
        onCloseColumn={onCloseColumn}
        onRestartColumn={onRestartColumn}
        onHideSession={onHideSession}
        onUnhideSession={onUnhideSession}
        onAddSession={onAddSession}
        onAddSessionAfter={onAddSessionAfter}
        onSetTask={onSetTask}
        dashboardOnNew={dashboardOnNew}
      />
    </Box>
  );
}
