import { Box, Typography } from '@mui/material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ColumnSlot } from './ColumnSlot.js';
import { DashboardTab } from '../DashboardTab.js';
import type { TabRecord } from '../../../../shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';

interface Props {
  tab: TabRecord;
  focused: boolean;
  instances: InstanceView[];
  onFocusColumn(instanceId: string): void;
  dashboardOnOpen?(id: string): void;
  dashboardOnKill?(id: string): void;
  dashboardOnRemove?(id: string): void;
  dashboardOnNew?(): void;
}

export function LeafView({
  tab,
  focused,
  instances,
  onFocusColumn,
  dashboardOnOpen,
  dashboardOnKill,
  dashboardOnRemove,
  dashboardOnNew,
}: Props) {
  if (tab.kind === 'dashboard') {
    return (
      <Box
        sx={{
          flex: 1,
          height: '100%',
          position: 'relative',
          outline: focused ? '2px solid' : 'none',
          outlineColor: 'primary.main',
          outlineOffset: -2,
        }}
      >
        <DashboardTab
          instances={instances}
          onOpen={dashboardOnOpen ?? (() => {})}
          onKill={dashboardOnKill ?? (() => {})}
          onRemove={dashboardOnRemove ?? (() => {})}
          onNew={dashboardOnNew ?? (() => {})}
        />
      </Box>
    );
  }

  if (tab.columnOrder.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
          fontSize: 13,
        }}
      >
        <Typography variant="body2">No instances in {tab.label} yet</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, height: '100%' }}>
      <PanelGroup direction="horizontal" autoSaveId={`columns-${tab.id}`}>
        {tab.columnOrder.map((instanceId, idx) => (
          <Panel key={instanceId} defaultSize={100 / tab.columnOrder.length} minSize={10}>
            <ColumnSlot
              instanceId={instanceId}
              focused={focused && tab.focusedInstanceId === instanceId}
              onFocus={() => onFocusColumn(instanceId)}
            />
            {idx < tab.columnOrder.length - 1 && (
              <PanelResizeHandle style={{ width: 4, background: 'rgba(255,255,255,0.06)' }} />
            )}
          </Panel>
        ))}
      </PanelGroup>
    </Box>
  );
}
