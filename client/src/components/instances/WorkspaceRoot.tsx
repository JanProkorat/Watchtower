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
  dashboardOnOpen(id: string): void;
  dashboardOnKill(id: string): void;
  dashboardOnRemove(id: string): void;
  dashboardOnNew(): void;
}

export function WorkspaceRoot({
  layout,
  tabs,
  instances,
  actions,
  dashboardOnOpen,
  dashboardOnKill,
  dashboardOnRemove,
  dashboardOnNew,
}: Props) {
  return (
    <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <WorkspaceNodeView
        node={layout.root}
        tabs={tabs}
        focusedLeafId={layout.focusedLeafId}
        instances={instances}
        onFocusColumn={actions.focusColumnInTab}
        onFocusLeaf={actions.focusLeaf}
        onResizeSplit={actions.setSplitSizes}
        dashboardOnOpen={dashboardOnOpen}
        dashboardOnKill={dashboardOnKill}
        dashboardOnRemove={dashboardOnRemove}
        dashboardOnNew={dashboardOnNew}
      />
    </Box>
  );
}
