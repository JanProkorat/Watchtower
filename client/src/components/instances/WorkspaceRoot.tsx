import { Box } from '@mui/material';
import { WorkspaceNodeView } from './WorkspaceNodeView.js';
import type { PersistedLayout, TabRecord } from '../../../../shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';
import type { WorkspaceLayoutActions } from '../../state/useWorkspaceLayout.js';

interface Props {
  layout: PersistedLayout;
  tabs: TabRecord[];
  instances: InstanceView[];
  actions: WorkspaceLayoutActions;
  dragInProgress: boolean;
  dashboardOnOpen(id: string): void;
  dashboardOnKill(id: string): void;
  dashboardOnRemove(id: string): void;
  dashboardOnNew(): void;
  onCloseColumn(instanceId: string): void;
  onRestartColumn?(instanceId: string): void;
  onHideSession(instanceId: string): void;
  onUnhideSession(instanceId: string): void;
  onAddSession(tabId: string): void;
}

export function WorkspaceRoot({
  layout,
  tabs,
  instances,
  actions,
  dragInProgress,
  dashboardOnOpen,
  dashboardOnKill,
  dashboardOnRemove,
  dashboardOnNew,
  onCloseColumn,
  onRestartColumn,
  onHideSession,
  onUnhideSession,
  onAddSession,
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
        dashboardOnOpen={dashboardOnOpen}
        dashboardOnKill={dashboardOnKill}
        dashboardOnRemove={dashboardOnRemove}
        dashboardOnNew={dashboardOnNew}
      />
    </Box>
  );
}
